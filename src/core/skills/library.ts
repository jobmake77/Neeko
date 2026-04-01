import { generateObject } from 'ai';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { resolveModel } from '../../config/model.js';
import { SemanticChunk, RawDocument } from '../models/memory.js';
import { Persona } from '../models/persona.js';
import { Soul } from '../models/soul.js';
import { DataSourceRecommender } from '../recommender/sources.js';
import { TwitterAdapter } from '../pipeline/ingestion/twitter.js';
import { ArticleAdapter } from '../pipeline/ingestion/article.js';
import {
  CandidateSkill,
  createEmptySkillLibrary,
  DistilledSkill,
  OriginSkill,
  PersonaSkillLibrary,
  PersonaSkillLibraryV2Schema,
  SkillEvidenceRef,
} from './types.js';

export interface SkillCoverageByOrigin {
  origin_id: string;
  origin_name: string;
  expanded_count: number;
  coverage_score: number;
  missing_slots: number;
}

export interface TriggeredSkillMatch {
  id: string;
  name: string;
  reason: 'manual' | 'automatic';
  trigger_score: number;
}

const OriginExtractionSchema = z.object({
  origins: z.array(
    z.object({
      name: z.string(),
      why: z.string(),
      how: z.string(),
      confidence: z.number().min(0).max(1),
      evidence_quotes: z.array(z.string()).min(1),
    })
  ),
});

const SkillExpandSchema = z.object({
  expanded: z.array(
    z.object({
      name: z.string(),
      similarity: z.number().min(0).max(1),
      source_platform: z.enum(['twitter', 'github', 'youtube', 'blog', 'reddit', 'linkedin', 'unknown']),
      source_ref: z.string(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

const DistillSkillSchema = z.object({
  skill: z.object({
    name: z.string(),
    central_thesis: z.string(),
    why: z.string(),
    how_steps: z.array(z.string()).min(1),
    boundaries: z.array(z.string()).min(1),
    trigger_signals: z.array(z.string()).min(1),
    anti_patterns: z.array(z.string()).default([]),
    contradiction_risk: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    coverage_tags: z.array(z.string()).default([]),
  }),
});

const QUALITY_GATE = {
  minEvidenceCount: 4,
  minSourceDiversity: 2,
  minConfidence: 0.65,
  maxContradictionRisk: 0.15,
  minMethodCompleteness: 0.7,
};

const SKILL_ORIGIN_TIMEOUT_MS = Number(process.env.NEEKO_SKILL_ORIGIN_TIMEOUT_MS ?? 45_000);
const SKILL_DISTILL_TIMEOUT_MS = Number(process.env.NEEKO_SKILL_DISTILL_TIMEOUT_MS ?? 25_000);
const SKILL_EXPAND_TIMEOUT_MS = Number(process.env.NEEKO_SKILL_EXPAND_TIMEOUT_MS ?? 20_000);
const SKILL_STAGE_BUDGET_MS = Number(process.env.NEEKO_SKILL_STAGE_BUDGET_MS ?? 180_000);
const MAX_ORIGINS_FOR_DISTILL = Number(process.env.NEEKO_MAX_ORIGINS_FOR_DISTILL ?? 8);
const MAX_CLUSTERS_FOR_DISTILL = Number(process.env.NEEKO_MAX_CLUSTERS_FOR_DISTILL ?? 4);

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
}

function similarityByTokenOverlap(a: string, b: string): number {
  const aa = new Set(normalizeName(a).split(/\s+/).filter(Boolean));
  const bb = new Set(normalizeName(b).split(/\s+/).filter(Boolean));
  if (aa.size === 0 || bb.size === 0) return 0;
  let hit = 0;
  for (const token of aa) if (bb.has(token)) hit++;
  return hit / Math.max(aa.size, bb.size);
}

function mergeUniqueEvidence(existing: SkillEvidenceRef[], incoming: SkillEvidenceRef[]): SkillEvidenceRef[] {
  return Array.from(
    new Map(
      [...existing, ...incoming].map((item) => [`${item.source_platform}:${item.source}:${item.snippet}`, item])
    ).values()
  ).slice(0, 20);
}

function dedupeOrigins(origins: OriginSkill[]): OriginSkill[] {
  const result: OriginSkill[] = [];
  for (const origin of origins) {
    const existing = result.find((v) => similarityByTokenOverlap(v.name, origin.name) >= 0.7);
    if (!existing) {
      result.push(origin);
      continue;
    }
    if (origin.confidence > existing.confidence) {
      Object.assign(existing, origin);
    }
  }
  return result;
}

function mergeOrigins(previous: OriginSkill[], incoming: OriginSkill[]): OriginSkill[] {
  const merged: OriginSkill[] = [...previous];
  for (const next of incoming) {
    const idx = merged.findIndex((v) => similarityByTokenOverlap(v.name, next.name) >= 0.72);
    if (idx < 0) {
      merged.push(next);
      continue;
    }
    const prev = merged[idx];
    const best = next.confidence >= prev.confidence ? next : prev;
    merged[idx] = {
      ...best,
      evidence: Array.from(
        new Map(
          [...prev.evidence, ...next.evidence].map((item) => [`${item.source}:${item.quote}`, item])
        ).values()
      ).slice(0, 8),
    };
  }
  return merged;
}

function methodCompletenessScore(skill: {
  why: string;
  how_steps: string[];
  boundaries: string[];
  trigger_signals: string[];
}): number {
  let score = 0;
  if (skill.why.trim().length >= 12) score += 0.25;
  if (skill.how_steps.length >= 2) score += 0.3;
  if (skill.boundaries.length >= 1) score += 0.25;
  if (skill.trigger_signals.length >= 1) score += 0.2;
  return Math.max(0, Math.min(1, score));
}

function qualityScore(skill: {
  confidence: number;
  contradiction_risk: number;
  method_completeness: number;
  evidence_count: number;
  source_diversity: number;
}): number {
  const evidenceScore = Math.min(1, skill.evidence_count / 8);
  const diversityScore = Math.min(1, skill.source_diversity / 3);
  const contradictionScore = 1 - skill.contradiction_risk;
  return Math.max(
    0,
    Math.min(
      1,
      skill.confidence * 0.3 + skill.method_completeness * 0.3 + evidenceScore * 0.2 + diversityScore * 0.1 + contradictionScore * 0.1
    )
  );
}

function gateCandidateSkill(
  draft: Omit<DistilledSkill, 'quality_score' | 'id' | 'last_validated_at'>
): { accepted: boolean; reasons: string[]; skill: DistilledSkill } {
  const evidenceCount = draft.evidence_refs.length;
  const sourceDiversity = new Set(draft.evidence_refs.map((item) => item.source_platform)).size;
  const methodCompleteness = draft.method_completeness;
  const reasons: string[] = [];

  if (evidenceCount < QUALITY_GATE.minEvidenceCount) reasons.push(`evidence_count<${QUALITY_GATE.minEvidenceCount}`);
  if (sourceDiversity < QUALITY_GATE.minSourceDiversity) reasons.push(`source_diversity<${QUALITY_GATE.minSourceDiversity}`);
  if (draft.confidence < QUALITY_GATE.minConfidence) reasons.push(`confidence<${QUALITY_GATE.minConfidence}`);
  if (draft.contradiction_risk > QUALITY_GATE.maxContradictionRisk) {
    reasons.push(`contradiction_risk>${QUALITY_GATE.maxContradictionRisk}`);
  }
  if (methodCompleteness < QUALITY_GATE.minMethodCompleteness) {
    reasons.push(`method_completeness<${QUALITY_GATE.minMethodCompleteness}`);
  }

  const scored: DistilledSkill = {
    ...draft,
    id: crypto.randomUUID(),
    quality_score: qualityScore({
      confidence: draft.confidence,
      contradiction_risk: draft.contradiction_risk,
      method_completeness: draft.method_completeness,
      evidence_count: evidenceCount,
      source_diversity: sourceDiversity,
    }),
    last_validated_at: null,
  };

  return {
    accepted: reasons.length === 0,
    reasons,
    skill: scored,
  };
}

function mergeDistilledSkills(previous: DistilledSkill[], incoming: DistilledSkill[]): DistilledSkill[] {
  const merged: DistilledSkill[] = [...previous];
  for (const next of incoming) {
    const idx = merged.findIndex((item) => similarityByTokenOverlap(item.name, next.name) >= 0.75);
    if (idx < 0) {
      merged.push(next);
      continue;
    }
    const prev = merged[idx];
    const better = next.quality_score >= prev.quality_score ? next : prev;
    merged[idx] = {
      ...better,
      evidence_refs: mergeUniqueEvidence(prev.evidence_refs, next.evidence_refs),
      source_origin_ids: Array.from(new Set([...prev.source_origin_ids, ...next.source_origin_ids])),
      coverage_tags: Array.from(new Set([...prev.coverage_tags, ...next.coverage_tags])).slice(0, 12),
      last_validated_at: new Date().toISOString(),
    };
  }

  return merged
    .sort((a, b) => b.quality_score - a.quality_score)
    .slice(0, 6);
}

function selectFinalDistilledSkills(
  accepted: DistilledSkill[],
  candidates: CandidateSkill[]
): { distilled: DistilledSkill[]; candidatePool: CandidateSkill[] } {
  const sortedAccepted = [...accepted].sort((a, b) => b.quality_score - a.quality_score);
  const distilled = sortedAccepted.slice(0, 6);

  if (distilled.length >= 3) {
    return { distilled, candidatePool: candidates };
  }

  const promoted = [...candidates]
    .sort((a, b) => b.quality_score - a.quality_score)
    .slice(0, Math.max(0, 3 - distilled.length))
    .map((item) => ({
      ...item,
      reject_reasons: [...item.reject_reasons, 'promoted_for_minimum_skill_set'],
    }));

  const promotedIds = new Set(promoted.map((item) => item.id));
  return {
    distilled: [...distilled, ...promoted],
    candidatePool: candidates.filter((item) => !promotedIds.has(item.id)),
  };
}

function buildClusterKey(origin: OriginSkill): string {
  return `${origin.name} ${origin.why} ${origin.how}`;
}

function clusterOrigins(origins: OriginSkill[]): Array<{ id: string; thesis: string; origins: OriginSkill[] }> {
  const out: Array<{ id: string; thesis: string; origins: OriginSkill[] }> = [];
  for (const origin of origins) {
    const key = buildClusterKey(origin);
    const cluster = out.find((item) =>
      item.origins.some((existing) => similarityByTokenOverlap(key, buildClusterKey(existing)) >= 0.5)
    );
    if (cluster) {
      cluster.origins.push(origin);
      continue;
    }
    out.push({
      id: crypto.randomUUID(),
      thesis: origin.name,
      origins: [origin],
    });
  }

  for (const cluster of out) {
    cluster.thesis = cluster.origins
      .map((item) => item.name)
      .sort((a, b) => b.length - a.length)[0] ?? cluster.thesis;
  }

  return out.slice(0, 8);
}

async function fetchEvidenceDocs(sourcePlatform: string, sourceRef: string): Promise<RawDocument[]> {
  try {
    if (sourcePlatform === 'twitter') {
      const adapter = new TwitterAdapter();
      return await adapter.fetch(sourceRef.replace(/^@/, ''), { limit: 30 });
    }
    if (/^https?:\/\//.test(sourceRef)) {
      const adapter = new ArticleAdapter();
      return await adapter.fetch(sourceRef);
    }
  } catch {
    return [];
  }
  return [];
}

function docsToEvidenceRefs(
  docs: RawDocument[],
  sourcePlatform: string,
  sourceRef: string,
  similarity: number
): SkillEvidenceRef[] {
  return docs.slice(0, 4).map((doc) => ({
    source: sourceRef,
    source_platform: sourcePlatform,
    snippet: doc.content.slice(0, 220),
    similarity,
  }));
}

async function collectEvidenceForOrigin(origin: OriginSkill): Promise<SkillEvidenceRef[]> {
  const recommender = new DataSourceRecommender();
  const refs: SkillEvidenceRef[] = origin.evidence.map((item) => ({
    source: item.source,
    source_platform: item.source,
    snippet: item.quote,
    similarity: 1,
  }));
  const allowExternalFetch = process.env.NEEKO_ENABLE_EXTERNAL_SKILL_FETCH === '1';
  if (!allowExternalFetch) {
    return refs;
  }

  const { object } = await withTimeout(
    generateObject({
      model: resolveModel(),
      schema: SkillExpandSchema,
      prompt: `Find related evidence sources for this skill origin.
Origin: ${origin.name}
WHY: ${origin.why}
HOW: ${origin.how}
Return 3 candidate sources.`,
    }),
    SKILL_EXPAND_TIMEOUT_MS,
    'skill evidence expansion'
  );

  const candidates = object.expanded
    .filter((item) => item.similarity >= 0.35 && item.confidence >= 0.4)
    .slice(0, 2);

  const startTs = Date.now();
  for (const candidate of candidates) {
    if (Date.now() - startTs > 12_000) break;
    let sourceRef = candidate.source_ref;
    let sourcePlatform: string = candidate.source_platform;
    if (!sourceRef || sourceRef === 'unknown') {
      try {
        const recommendation = await recommender.recommend(candidate.name);
        const best = recommendation.dimensions[0]?.candidates[0];
        if (best) {
          sourceRef = best.handle_or_url;
          sourcePlatform = best.platform;
        }
      } catch {
        // keep candidate source
      }
    }

    if (!sourceRef || sourceRef === 'unknown') continue;
    const docs = await withTimeout(
      fetchEvidenceDocs(sourcePlatform, sourceRef),
      8_000,
      'skill evidence fetch'
    ).catch(() => []);
    refs.push(...docsToEvidenceRefs(docs, sourcePlatform, sourceRef, candidate.similarity));
  }

  return mergeUniqueEvidence([], refs);
}

async function distillSkillFromCluster(
  cluster: { id: string; thesis: string; origins: OriginSkill[] },
  evidenceRefs: SkillEvidenceRef[]
): Promise<Omit<DistilledSkill, 'quality_score' | 'id' | 'last_validated_at'>> {
  const originText = cluster.origins
    .map((item, idx) => `Origin ${idx + 1}\nName: ${item.name}\nWHY: ${item.why}\nHOW: ${item.how}`)
    .join('\n\n');
  const evidenceText = evidenceRefs.slice(0, 12).map((item, idx) => `[${idx + 1}] ${item.snippet}`).join('\n');

  const { object } = await withTimeout(
    generateObject({
      model: resolveModel(),
      schema: DistillSkillSchema,
      prompt: `Distill one high-value transferable skill from clustered persona origins.
Output should be method-oriented and compact.

Cluster thesis: ${cluster.thesis}

Origins:
${originText}

Evidence snippets:
${evidenceText || 'none'}

Rules:
- skill must be actionable
- include clear boundaries and anti-patterns
- trigger_signals should be short cues from user intent
- avoid generic skill names`,
    }),
    SKILL_DISTILL_TIMEOUT_MS,
    'skill distill'
  );

  const methodCompleteness = methodCompletenessScore(object.skill);

  return {
    name: object.skill.name,
    central_thesis: object.skill.central_thesis,
    why: object.skill.why,
    how_steps: object.skill.how_steps.slice(0, 6),
    boundaries: object.skill.boundaries.slice(0, 5),
    trigger_signals: object.skill.trigger_signals.slice(0, 6),
    anti_patterns: object.skill.anti_patterns.slice(0, 5),
    evidence_refs: evidenceRefs.slice(0, 16),
    confidence: object.skill.confidence,
    contradiction_risk: object.skill.contradiction_risk,
    method_completeness: methodCompleteness,
    coverage_tags: Array.from(new Set(object.skill.coverage_tags)).slice(0, 10),
    source_origin_ids: cluster.origins.map((item) => item.id),
  };
}

function buildFallbackSkillFromCluster(
  cluster: { id: string; thesis: string; origins: OriginSkill[] },
  evidenceRefs: SkillEvidenceRef[]
): Omit<DistilledSkill, 'quality_score' | 'id' | 'last_validated_at'> {
  const lead = cluster.origins.slice().sort((a, b) => b.confidence - a.confidence)[0];
  const fallbackName = lead?.name ?? cluster.thesis;
  const why = lead?.why ?? `Derived from clustered persona signals around ${cluster.thesis}.`;
  const how = lead?.how ?? `Apply ${cluster.thesis} with explicit constraints and concrete steps.`;
  const boundaries = [
    'Only apply when user intent matches this domain.',
    'Avoid over-generalizing beyond evidenced context.',
  ];
  const triggerSignals = Array.from(new Set(cluster.origins.map((item) => item.name))).slice(0, 4);
  const howSteps = [how, 'Validate assumptions against evidence before answering.'];

  return {
    name: fallbackName,
    central_thesis: why,
    why,
    how_steps: howSteps,
    boundaries,
    trigger_signals: triggerSignals.length > 0 ? triggerSignals : [cluster.thesis],
    anti_patterns: ['Generic advice without method steps'],
    evidence_refs: evidenceRefs.slice(0, 16),
    confidence: Math.max(0.55, Math.min(0.85, lead?.confidence ?? 0.6)),
    contradiction_risk: 0.12,
    method_completeness: methodCompletenessScore({
      why,
      how_steps: howSteps,
      boundaries,
      trigger_signals: triggerSignals.length > 0 ? triggerSignals : [cluster.thesis],
    }),
    coverage_tags: triggerSignals.slice(0, 8),
    source_origin_ids: cluster.origins.map((item) => item.id),
  };
}

function migrateToV2(raw: unknown, slug: string): PersonaSkillLibrary {
  if (!raw || typeof raw !== 'object') return createEmptySkillLibrary(slug);
  const candidate = raw as {
    schema_version?: number;
    persona_slug?: string;
    version?: number;
    updated_at?: string;
    source_trace?: string[];
    origin_skills?: OriginSkill[];
    expanded_skills?: Array<{
      name?: string;
      source_platform?: string;
      source_ref?: string;
      transferable_summary?: string;
      confidence?: number;
      similarity?: number;
      origin_id?: string;
    }>;
    clusters?: Array<{ origin_id?: string; expanded_ids?: string[] }>;
    pending_candidates?: OriginSkill[];
  };

  const base = createEmptySkillLibrary(slug);
  const origins = Array.isArray(candidate.origin_skills) ? candidate.origin_skills : [];
  const distilledFromLegacy: DistilledSkill[] = origins.slice(0, 6).map((origin) => {
    const legacyEvidence = (Array.isArray(candidate.expanded_skills) ? candidate.expanded_skills : [])
      .filter((item) => item.origin_id === origin.id)
      .slice(0, 4)
      .map((item) => ({
        source: item.source_ref ?? 'legacy',
        source_platform: item.source_platform ?? 'unknown',
        snippet: item.transferable_summary ?? item.name ?? origin.how,
        similarity: item.similarity ?? 0.5,
      }));
    const draft = {
      name: origin.name,
      central_thesis: origin.why,
      why: origin.why,
      how_steps: [origin.how],
      boundaries: ['Use only when user intent aligns with this skill context.'],
      trigger_signals: [origin.name],
      anti_patterns: [],
      evidence_refs: [...legacyEvidence, ...origin.evidence.map((item) => ({
        source: item.source,
        source_platform: item.source,
        snippet: item.quote,
        similarity: 1,
      }))],
      confidence: origin.confidence,
      contradiction_risk: 0.18,
      method_completeness: 0.75,
      coverage_tags: [origin.name],
      source_origin_ids: [origin.id],
    };
    return gateCandidateSkill(draft).skill;
  });

  return {
    ...base,
    schema_version: 2,
    persona_slug: candidate.persona_slug ?? slug,
    version: Math.max(1, Number(candidate.version ?? 1)),
    updated_at: typeof candidate.updated_at === 'string' ? candidate.updated_at : new Date().toISOString(),
    source_trace: Array.isArray(candidate.source_trace) ? candidate.source_trace : [],
    origin_skills: origins,
    distilled_skills: distilledFromLegacy,
    candidate_skill_pool: [],
    clusters: Array.isArray(candidate.clusters)
      ? candidate.clusters.map((item) => ({
        id: crypto.randomUUID(),
        thesis: origins.find((origin) => origin.id === item.origin_id)?.name ?? 'legacy cluster',
        origin_ids: item.origin_id ? [item.origin_id] : [],
        distilled_skill_id: null,
      }))
      : [],
    expanded_skills: Array.isArray(candidate.expanded_skills) ? candidate.expanded_skills as PersonaSkillLibrary['expanded_skills'] : [],
    pending_candidates: Array.isArray(candidate.pending_candidates) ? candidate.pending_candidates : [],
  };
}

export const __skillLibraryTestables = {
  normalizeName,
  similarityByTokenOverlap,
  dedupeOrigins,
  mergeOrigins,
  computeCoverageByOrigin,
  gateCandidateSkill,
  selectFinalDistilledSkills,
  clusterOrigins,
};

export function getSkillLibraryPath(personaDir: string): string {
  return join(personaDir, 'skills.json');
}

export function loadSkillLibrary(personaDir: string, slug: string): PersonaSkillLibrary {
  const path = getSkillLibraryPath(personaDir);
  if (!existsSync(path)) return createEmptySkillLibrary(slug);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed?.schema_version === 2) {
      return PersonaSkillLibraryV2Schema.parse(parsed);
    }
    return migrateToV2(parsed, slug);
  } catch {
    return createEmptySkillLibrary(slug);
  }
}

export function saveSkillLibrary(personaDir: string, library: PersonaSkillLibrary): void {
  mkdirSync(personaDir, { recursive: true });
  writeFileSync(getSkillLibraryPath(personaDir), JSON.stringify(library, null, 2), 'utf-8');
}

function parseManualSkillHint(query: string): { cleanQuery: string; manualTarget: string | null } {
  const match = query.match(/^\s*\/skill\s+([^\n]+)\n?/i);
  if (!match) return { cleanQuery: query, manualTarget: null };
  const target = match[1].trim();
  const clean = query.replace(match[0], '').trim();
  return {
    cleanQuery: clean.length > 0 ? clean : target,
    manualTarget: target,
  };
}

function scoreSkillForQuery(skill: DistilledSkill, query: string): number {
  const q = normalizeName(query);
  if (!q) return 0;
  const semanticScore = Math.max(
    similarityByTokenOverlap(q, skill.name),
    similarityByTokenOverlap(q, skill.central_thesis),
    similarityByTokenOverlap(q, skill.why)
  );
  const intentScore = Math.max(
    ...skill.trigger_signals.map((item) => similarityByTokenOverlap(q, item)),
    0
  );
  const boundaryPenalty = Math.max(
    ...skill.anti_patterns.map((item) => similarityByTokenOverlap(q, item)),
    0
  );

  return Math.max(0, semanticScore * 0.55 + intentScore * 0.45 - boundaryPenalty * 0.25);
}

export function selectTriggeredSkillsForQuery(
  library: PersonaSkillLibrary | null,
  query: string,
  maxItems = 2
): { cleanQuery: string; triggered: TriggeredSkillMatch[]; context: string } {
  if (!library || library.distilled_skills.length === 0) {
    return { cleanQuery: query, triggered: [], context: '' };
  }

  const { cleanQuery, manualTarget } = parseManualSkillHint(query);

  let ranked: Array<{ skill: DistilledSkill; score: number; reason: 'manual' | 'automatic' }> = [];
  if (manualTarget) {
    const manual = [...library.distilled_skills]
      .map((skill) => ({
        skill,
        score: Math.max(
          similarityByTokenOverlap(manualTarget, skill.name),
          similarityByTokenOverlap(manualTarget, skill.central_thesis)
        ),
        reason: 'manual' as const,
      }))
      .filter((item) => item.score >= 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
    ranked = manual;
  } else {
    ranked = [...library.distilled_skills]
      .map((skill) => ({ skill, score: scoreSkillForQuery(skill, cleanQuery), reason: 'automatic' as const }))
      .filter((item) => item.score >= 0.18)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }

  const triggered: TriggeredSkillMatch[] = ranked.map((item) => ({
    id: item.skill.id,
    name: item.skill.name,
    reason: item.reason,
    trigger_score: item.score,
  }));

  if (ranked.length === 0) {
    return { cleanQuery, triggered: [], context: '' };
  }

  const lines = ranked.map((item, idx) => {
    const steps = item.skill.how_steps.slice(0, 4).map((step, i) => `${i + 1}) ${step}`).join(' ; ');
    const boundaries = item.skill.boundaries.slice(0, 3).join(' | ');
    return `${idx + 1}. ${item.skill.name}\nthesis: ${item.skill.central_thesis}\nsteps: ${steps}\nboundaries: ${boundaries}`;
  });

  return {
    cleanQuery,
    triggered,
    context: `Skill context (triggered):\n${lines.join('\n\n')}`,
  };
}

export function buildSkillContextForQuery(
  library: PersonaSkillLibrary | null,
  query: string,
  maxItems = 2
): string {
  return selectTriggeredSkillsForQuery(library, query, maxItems).context;
}

export function computeCoverageByOrigin(
  library: PersonaSkillLibrary | null
): SkillCoverageByOrigin[] {
  if (!library) return [];
  return library.origin_skills
    .map((origin) => {
      const linked = library.distilled_skills.filter((item) => item.source_origin_ids.includes(origin.id));
      const covered = linked.length > 0 ? 1 : 0;
      return {
        origin_id: origin.id,
        origin_name: origin.name,
        expanded_count: linked.length,
        coverage_score: covered,
        missing_slots: covered === 1 ? 0 : 1,
      };
    })
    .sort((a, b) => a.coverage_score - b.coverage_score);
}

export async function buildSkillLibraryFromSources(
  persona: Persona,
  _soul: Soul,
  chunks: SemanticChunk[],
  docs: RawDocument[],
  previous?: PersonaSkillLibrary
): Promise<PersonaSkillLibrary> {
  const seedText = chunks.slice(0, 70).map((c, i) => `[${i + 1}] ${c.content.slice(0, 280)}`).join('\n');
  let extractedOrigins: z.infer<typeof OriginExtractionSchema>['origins'] = [];
  try {
    const { object } = await withTimeout(
      generateObject({
        model: resolveModel(),
        schema: OriginExtractionSchema,
        prompt: `Extract core idea-origin skills from this persona content.
Persona: ${persona.name}
Rules:
- focus on center ideas and reusable methods
- avoid generic topics
- max 12 origins

Content:\n${seedText || 'No content'}`,
      }),
      SKILL_ORIGIN_TIMEOUT_MS,
      'skill origin extraction'
    );
    extractedOrigins = object.origins;
  } catch (error) {
    console.warn(`[SkillLibrary] origin extraction failed, fallback to previous skills: ${String(error)}`);
  }

  const rawOrigins: OriginSkill[] = extractedOrigins.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name,
    why: item.why,
    how: item.how,
    confidence: item.confidence,
    evidence: item.evidence_quotes.slice(0, 6).map((q) => ({ quote: q, source: 'tweet' })),
  }));

  const deduped = dedupeOrigins(rawOrigins);
  const acceptedOrigins = deduped
    .filter((item) => item.evidence.length >= 2 && item.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_ORIGINS_FOR_DISTILL);
  const pendingOrigins = deduped.filter((item) => !acceptedOrigins.includes(item));

  const clusters = clusterOrigins(acceptedOrigins).slice(0, MAX_CLUSTERS_FOR_DISTILL);
  const acceptedDistilled: DistilledSkill[] = [];
  const candidatePool: CandidateSkill[] = [];
  const stageStart = Date.now();

  for (const cluster of clusters) {
    if (Date.now() - stageStart > SKILL_STAGE_BUDGET_MS) {
      console.warn('[SkillLibrary] distill stage budget exceeded, stop further clusters');
      break;
    }
    const clusterEvidence: SkillEvidenceRef[] = [];
    for (const origin of cluster.origins) {
      if (Date.now() - stageStart > SKILL_STAGE_BUDGET_MS) break;
      try {
        const refs = await collectEvidenceForOrigin(origin);
        clusterEvidence.push(...refs);
      } catch (error) {
        console.warn(`[SkillLibrary] collect evidence failed for ${origin.name}: ${String(error)}`);
      }
    }

    const mergedEvidence = mergeUniqueEvidence([], clusterEvidence);
    let draft: Omit<DistilledSkill, 'quality_score' | 'id' | 'last_validated_at'>;
    try {
      draft = await distillSkillFromCluster(cluster, mergedEvidence);
    } catch (error) {
      console.warn(`[SkillLibrary] distill failed for cluster "${cluster.thesis}", fallback used: ${String(error)}`);
      draft = buildFallbackSkillFromCluster(cluster, mergedEvidence);
    }
    const gated = gateCandidateSkill(draft);
    if (gated.accepted) {
      acceptedDistilled.push(gated.skill);
    } else {
      candidatePool.push({
        ...gated.skill,
        reject_reasons: gated.reasons,
      });
    }
  }

  const base = previous ?? createEmptySkillLibrary(persona.slug);
  const mergedOrigins = mergeOrigins(base.origin_skills, acceptedOrigins);
  const mergedDistilled = mergeDistilledSkills(base.distilled_skills, acceptedDistilled);
  const selected = selectFinalDistilledSkills(mergedDistilled, [...base.candidate_skill_pool, ...candidatePool]);

  const clusterOut = clusters.map((cluster) => {
    const linked = selected.distilled.find((item) =>
      item.source_origin_ids.some((originId) => cluster.origins.some((origin) => origin.id === originId))
    );
    return {
      id: cluster.id,
      thesis: cluster.thesis,
      origin_ids: cluster.origins.map((item) => item.id),
      distilled_skill_id: linked?.id ?? null,
    };
  });

  return {
    ...base,
    schema_version: 2,
    persona_slug: persona.slug,
    version: base.version + 1,
    updated_at: new Date().toISOString(),
    source_trace: Array.from(new Set([...base.source_trace, ...docs.slice(0, 30).map((d) => d.source_url ?? d.author)])),
    origin_skills: mergedOrigins,
    distilled_skills: selected.distilled,
    candidate_skill_pool: selected.candidatePool.slice(0, 20),
    clusters: clusterOut,
    pending_candidates: mergeOrigins(base.pending_candidates, pendingOrigins),
    expanded_skills: [],
  };
}

export async function refreshSkillLibraryFromSignals(
  persona: Persona,
  soul: Soul,
  signals: string[],
  previous?: PersonaSkillLibrary
): Promise<PersonaSkillLibrary> {
  const fakeDocs: RawDocument[] = signals.slice(0, 70).map((content) => ({
    id: crypto.randomUUID(),
    source_type: 'custom',
    content,
    author: persona.name,
    fetched_at: new Date().toISOString(),
  }));
  const fakeChunks: SemanticChunk[] = fakeDocs.map((d, i) => ({
    id: crypto.randomUUID(),
    document_id: d.id,
    content: d.content,
    source_type: d.source_type,
    author: d.author,
    chunk_index: i,
    total_chunks: fakeDocs.length,
    token_count: Math.ceil(d.content.length / 4),
  }));

  return buildSkillLibraryFromSources(persona, soul, fakeChunks, fakeDocs, previous);
}

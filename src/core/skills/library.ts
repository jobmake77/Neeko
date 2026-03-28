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
  createEmptySkillLibrary,
  OriginSkill,
  PersonaSkillLibrary,
  PersonaSkillLibrarySchema,
  ExpandedSkill,
} from './types.js';

export interface SkillCoverageByOrigin {
  origin_id: string;
  origin_name: string;
  expanded_count: number;
  coverage_score: number;
  missing_slots: number;
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

const TransferableSummarySchema = z.object({
  summary: z.string(),
});

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

function mergeExpandedSkills(
  previous: ExpandedSkill[],
  incoming: ExpandedSkill[],
  origins: OriginSkill[]
): ExpandedSkill[] {
  const merged: ExpandedSkill[] = [...previous];
  for (const next of incoming) {
    const dupIdx = merged.findIndex(
      (item) =>
        item.origin_id === next.origin_id &&
        (similarityByTokenOverlap(item.name, next.name) >= 0.8 ||
          (item.source_ref && next.source_ref && item.source_ref === next.source_ref))
    );
    if (dupIdx < 0) {
      merged.push(next);
      continue;
    }
    if (next.confidence > merged[dupIdx].confidence) {
      merged[dupIdx] = next;
    }
  }

  const byOrigin = new Map<string, ExpandedSkill[]>();
  for (const item of merged) {
    const list = byOrigin.get(item.origin_id) ?? [];
    list.push(item);
    byOrigin.set(item.origin_id, list);
  }

  const out: ExpandedSkill[] = [];
  for (const origin of origins) {
    const list = (byOrigin.get(origin.id) ?? [])
      .sort((a, b) => b.confidence + b.similarity - (a.confidence + a.similarity))
      .slice(0, 3);
    out.push(...list);
  }
  return out;
}

export const __skillLibraryTestables = {
  normalizeName,
  similarityByTokenOverlap,
  dedupeOrigins,
  mergeOrigins,
  mergeExpandedSkills,
  computeCoverageByOrigin,
};

async function summarizeTransferableCapability(
  origin: OriginSkill,
  expandedName: string,
  docs: RawDocument[]
): Promise<string> {
  const excerpt = docs
    .slice(0, 8)
    .map((d, i) => `[${i + 1}] ${d.content.slice(0, 240)}`)
    .join('\n');
  if (!excerpt) {
    return `${expandedName}: transferable capability inferred from origin skill "${origin.name}"`;
  }
  const { object } = await withTimeout(
    generateObject({
      model: resolveModel(),
      schema: TransferableSummarySchema,
      prompt: `You are building a transferable skill note.
Origin skill: ${origin.name}
Expanded skill: ${expandedName}
Origin WHY: ${origin.why}
Origin HOW: ${origin.how}

Source excerpts:
${excerpt}

Return a concise summary with method steps and boundaries.`,
    }),
    35_000,
    'skill transferable summary'
  );
  return object.summary;
}

async function fetchEvidenceDocs(sourcePlatform: string, sourceRef: string): Promise<RawDocument[]> {
  try {
    if (sourcePlatform === 'twitter') {
      const adapter = new TwitterAdapter();
      return await adapter.fetch(sourceRef.replace(/^@/, ''), { limit: 50 });
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

export function getSkillLibraryPath(personaDir: string): string {
  return join(personaDir, 'skills.json');
}

export function loadSkillLibrary(personaDir: string, slug: string): PersonaSkillLibrary {
  const path = getSkillLibraryPath(personaDir);
  if (!existsSync(path)) return createEmptySkillLibrary(slug);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return PersonaSkillLibrarySchema.parse(parsed);
  } catch {
    return createEmptySkillLibrary(slug);
  }
}

export function saveSkillLibrary(personaDir: string, library: PersonaSkillLibrary): void {
  mkdirSync(personaDir, { recursive: true });
  writeFileSync(getSkillLibraryPath(personaDir), JSON.stringify(library, null, 2), 'utf-8');
}

export function buildSkillContextForQuery(
  library: PersonaSkillLibrary | null,
  query: string,
  maxItems = 4
): string {
  if (!library) return '';
  const q = normalizeName(query);
  const scoredOrigins = library.origin_skills.map((s) => ({
    kind: 'origin' as const,
    score: similarityByTokenOverlap(q, s.name) + similarityByTokenOverlap(q, s.why) * 0.4,
    text: `${s.name} | WHY: ${s.why} | HOW: ${s.how}`,
  }));
  const scoredExpanded = library.expanded_skills.map((s) => ({
    kind: 'expanded' as const,
    score: similarityByTokenOverlap(q, s.name) + similarityByTokenOverlap(q, s.transferable_summary) * 0.4,
    text: `${s.name} | transferable: ${s.transferable_summary}`,
  }));
  const merged = [...scoredOrigins, ...scoredExpanded]
    .filter((v) => v.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems);

  if (merged.length === 0) return '';
  const lines = merged.map((v, i) => `${i + 1}. [${v.kind}] ${v.text}`);
  return `Skill context:\n${lines.join('\n')}`;
}

export function computeCoverageByOrigin(
  library: PersonaSkillLibrary | null
): SkillCoverageByOrigin[] {
  if (!library) return [];
  return library.origin_skills
    .map((origin) => {
      const expandedCount = library.expanded_skills.filter((item) => item.origin_id === origin.id).length;
      const coverageScore = Math.min(1, expandedCount / 3);
      return {
        origin_id: origin.id,
        origin_name: origin.name,
        expanded_count: expandedCount,
        coverage_score: coverageScore,
        missing_slots: Math.max(0, 3 - expandedCount),
      };
    })
    .sort((a, b) => a.coverage_score - b.coverage_score);
}

export async function buildSkillLibraryFromSources(
  persona: Persona,
  soul: Soul,
  chunks: SemanticChunk[],
  docs: RawDocument[],
  previous?: PersonaSkillLibrary
): Promise<PersonaSkillLibrary> {
  const seedText = chunks.slice(0, 50).map((c, i) => `[${i + 1}] ${c.content.slice(0, 280)}`).join('\n');
  const { object } = await withTimeout(
    generateObject({
      model: resolveModel(),
      schema: OriginExtractionSchema,
      prompt: `Extract core skill origins from this persona's content.
Persona: ${soul.target_name}
Goal: identify "idea -> skill origin (why/how)".

Rules:
- Max 8 origins.
- Keep only clearly evidenced skills.
- each origin includes why/how + quotes.

Content:
${seedText || 'No content'}`,
    }),
    45_000,
    'skill origin extraction'
  );

  const rawOrigins: OriginSkill[] = object.origins.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name,
    why: item.why,
    how: item.how,
    confidence: item.confidence,
    evidence: item.evidence_quotes.slice(0, 5).map((q) => ({ quote: q, source: 'tweet' })),
  }));

  const deduped = dedupeOrigins(rawOrigins);
  const accepted = deduped.filter((v) => v.evidence.length >= 2 && v.confidence >= 0.5);
  const pending = deduped.filter((v) => !accepted.includes(v));

  const recommender = new DataSourceRecommender();
  const expandedSkills: ExpandedSkill[] = [];
  for (const origin of accepted) {
    const { object: expandedObject } = await withTimeout(
      generateObject({
        model: resolveModel(),
        schema: SkillExpandSchema,
        prompt: `Given origin skill "${origin.name}" with why/how:
WHY: ${origin.why}
HOW: ${origin.how}

Return 3 similar skills with likely source platform+reference (handle or url).`,
      }),
      35_000,
      'skill expand generation'
    );

    const expanded = expandedObject.expanded
      .filter((item) => item.similarity >= 0.35 && item.confidence >= 0.4)
      .slice(0, 6);
    const sourceSeen = new Set<string>();
    let used = 0;
    for (const candidate of expanded) {
      if (used >= 3) break;
      let sourceRef = candidate.source_ref;
      let sourcePlatform = candidate.source_platform;
      if (!sourceRef || sourceRef === 'unknown') {
        try {
          const recommendation = await recommender.recommend(candidate.name);
          const best = recommendation.dimensions[0]?.candidates[0];
          if (best) {
            sourceRef = best.handle_or_url;
            sourcePlatform = best.platform;
          }
        } catch {
          // keep fallback values
        }
      }
      const sourceKey = `${sourcePlatform}:${sourceRef}`;
      if (!sourceRef || sourceRef === 'unknown' || sourceSeen.has(sourceKey)) {
        continue;
      }
      sourceSeen.add(sourceKey);

      const evidenceDocs = await fetchEvidenceDocs(sourcePlatform, sourceRef);
      const transferableSummary = await summarizeTransferableCapability(origin, candidate.name, evidenceDocs);
      expandedSkills.push({
        id: crypto.randomUUID(),
        origin_id: origin.id,
        name: candidate.name,
        similarity: candidate.similarity,
        source_platform: sourcePlatform,
        source_ref: sourceRef,
        transferable_summary: transferableSummary,
        confidence: candidate.confidence,
      });
      used++;
    }
  }

  const base = previous ?? createEmptySkillLibrary(persona.slug);
  const mergedOrigins = mergeOrigins(base.origin_skills, accepted);
  const mergedExpanded = mergeExpandedSkills(base.expanded_skills, expandedSkills, mergedOrigins)
    .filter((s) => s.similarity >= 0.35 && s.confidence >= 0.4);
  const clusters = mergedOrigins.map((origin) => ({
    origin_id: origin.id,
    expanded_ids: mergedExpanded.filter((s) => s.origin_id === origin.id).map((s) => s.id),
  }));

  return {
    ...base,
    schema_version: 1,
    persona_slug: persona.slug,
    version: base.version + 1,
    updated_at: new Date().toISOString(),
    source_trace: Array.from(new Set([...base.source_trace, ...docs.slice(0, 20).map((d) => d.source_url ?? d.author)])),
    origin_skills: mergedOrigins,
    expanded_skills: mergedExpanded,
    clusters,
    pending_candidates: mergeOrigins(base.pending_candidates, pending),
  };
}

export async function refreshSkillLibraryFromSignals(
  persona: Persona,
  soul: Soul,
  signals: string[],
  previous?: PersonaSkillLibrary
): Promise<PersonaSkillLibrary> {
  const fakeDocs: RawDocument[] = signals.slice(0, 50).map((content) => ({
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

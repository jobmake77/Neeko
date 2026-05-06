import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import {
  buildProviderAttemptChain,
  resolveModelForOverride,
  shouldFailoverProviderError,
  type ModelRuntimeOverride,
} from '../../config/model.js';
import { settings } from '../../config/settings.js';
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

export type SkillBuildStatus = 'not_started' | 'running' | 'ready' | 'pending' | 'failed';

export interface SkillBuildEvidence {
  docs: RawDocument[];
  evidenceRefs?: SkillEvidenceRef[];
  memorySignals?: string[];
  sourceBreakdown?: Record<string, number>;
  generatedAt?: string;
}

export interface SkillBuildReport {
  status: SkillBuildStatus;
  originCount: number;
  distilledCount: number;
  candidateCount: number;
  pendingCount: number;
  qualityScore: number;
  failureReason?: string;
  evidenceSourceCount: number;
  sourceDiversity: number;
}

export interface SkillBuildResult {
  library: PersonaSkillLibrary;
  report: SkillBuildReport;
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

const OriginCandidateExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      name: z.string(),
      why: z.string(),
      how: z.string(),
      confidence: z.number().min(0).max(1),
      evidence_quotes: z.array(z.string()).min(1),
    })
  ),
});

const OriginVerificationSchema = z.object({
  verified: z.array(
    z.object({
      name: z.string(),
      why: z.string(),
      how: z.string(),
      confidence: z.number().min(0).max(1),
      evidence_quotes: z.array(z.string()).min(1),
      evidence_strength: z.number().min(0).max(1),
      method_specificity: z.number().min(0).max(1),
      transferable: z.boolean(),
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

function getSkillOriginTimeoutMs(): number {
  return Number(process.env.NEEKO_SKILL_ORIGIN_TIMEOUT_MS ?? 45_000);
}

function getSkillDistillTimeoutMs(): number {
  return Number(process.env.NEEKO_SKILL_DISTILL_TIMEOUT_MS ?? 25_000);
}

function getSkillExpandTimeoutMs(): number {
  return Number(process.env.NEEKO_SKILL_EXPAND_TIMEOUT_MS ?? 20_000);
}

function getSkillStageBudgetMs(): number {
  return Number(process.env.NEEKO_SKILL_STAGE_BUDGET_MS ?? 180_000);
}
const MAX_ORIGINS_FOR_DISTILL = Number(process.env.NEEKO_MAX_ORIGINS_FOR_DISTILL ?? 8);
const MAX_CLUSTERS_FOR_DISTILL = Number(process.env.NEEKO_MAX_CLUSTERS_FOR_DISTILL ?? 4);

type OriginCandidateDraft = {
  name: string;
  why: string;
  how: string;
  confidence: number;
  evidence_quotes: string[];
  evidence_sources?: string[];
  evidence_strength?: number;
  method_specificity?: number;
  transferable?: boolean;
};

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

async function generateSkillObject<T>({
  schema,
  prompt,
  timeoutMs,
  label,
  attempts = resolveSkillProviderAttempts(),
}: {
  schema: z.ZodSchema<T>;
  prompt: string;
  timeoutMs: number;
  label: string;
  attempts?: ModelRuntimeOverride[];
}): Promise<T> {
  const { generateObject } = await import('ai');
  let lastError: unknown;
  const primaryProvider = attempts[0]?.provider;
  for (const attempt of attempts) {
    try {
      if (attempt.provider && primaryProvider && attempt.provider !== primaryProvider) {
        console.warn(`[SkillLibrary] provider failover ${primaryProvider} -> ${attempt.provider}`);
      }
      if (attempt.provider === 'gemini') {
        const text = await generateGeminiJsonText({
          prompt,
          model: attempt.model,
          timeoutMs,
          label,
        });
        const jsonCandidate = extractFirstJsonValue(text);
        if (!jsonCandidate) {
          throw new Error(`Gemini direct JSON parse failed: ${text.slice(0, 240)}`);
        }
        const parsed = JSON.parse(jsonCandidate);
        return schema.parse(normalizeGeminiSkillPayload(label, parsed));
      }
      const { object } = await withTimeout(
        generateObject({
          model: resolveModelForOverride(attempt, 'training'),
          schema,
          prompt,
        }),
        timeoutMs,
        `${label} ${attempt.provider ?? 'default'}`
      );
      return object;
    } catch (error) {
      lastError = error;
      if (!shouldFailoverProviderError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function resolveSkillProviderAttempts(): ModelRuntimeOverride[] {
  if (process.env.NODE_ENV === 'test' && process.env.NEEKO_TEST_REAL_PROVIDER_FAILOVER !== '1') {
    const primary = buildProviderAttemptChain(undefined, 'training')[0];
    return primary ? [primary] : [];
  }
  return buildProviderAttemptChain(undefined, 'training');
}

function getGeminiApiKey(): string {
  const configured = String(settings.get('geminiApiKey') ?? '').trim();
  if (configured) return configured;
  return String(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '').trim();
}

function extractGeminiText(payload: any): string {
  return (payload?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractFirstJsonValue(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const objectStart = candidate.indexOf('{');
  const arrayStart = candidate.indexOf('[');
  const starts = [objectStart, arrayStart].filter((item) => item >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  if (start === -1) return null;
  const open = candidate[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }
  return null;
}

function normalizeGeminiSkillPayload(label: string, parsed: unknown): unknown {
  const normalizedLabel = label.toLowerCase();
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  if (normalizedLabel.includes('origin extraction')) {
    if (Array.isArray(parsed)) return { origins: parsed };
    if (record?.origins) return parsed;
    if (record?.core_idea_origin_skills) return { origins: normalizeOriginLikeList(record.core_idea_origin_skills) };
    if (record?.candidates) return { origins: record.candidates };
  }
  if (normalizedLabel.includes('candidate extraction')) {
    if (Array.isArray(parsed)) return { candidates: parsed };
    if (record?.candidates) return { candidates: normalizeOriginLikeList(record.candidates) };
    if (record?.origins) return { candidates: normalizeOriginLikeList(record.origins) };
    if (record?.core_idea_origin_skills) return { candidates: normalizeOriginLikeList(record.core_idea_origin_skills) };
  }
  if (normalizedLabel.includes('candidate verification')) {
    if (Array.isArray(parsed)) return { verified: normalizeOriginLikeList(parsed, true) };
    if (record?.verified) return { verified: normalizeOriginLikeList(record.verified, true) };
    if (record?.candidates) return { verified: normalizeOriginLikeList(record.candidates, true) };
    if (record?.origins) return { verified: normalizeOriginLikeList(record.origins, true) };
    if (record?.core_idea_origin_skills) return { verified: normalizeOriginLikeList(record.core_idea_origin_skills, true) };
  }
  if (normalizedLabel.includes('distill')) {
    if (record?.skill) return { skill: normalizeDistilledSkillLike(record.skill) };
    if (record) return { skill: normalizeDistilledSkillLike(record) };
  }
  if (normalizedLabel.includes('evidence expansion')) {
    if (Array.isArray(parsed)) return { expanded: parsed };
    if (record?.expanded) return parsed;
    if (record?.candidates) return { expanded: record.candidates };
  }
  return parsed;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return String(record.description ?? record.text ?? record.quote ?? record.name ?? JSON.stringify(item));
      }
      return String(item ?? '');
    }).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') return [value].filter(Boolean);
  return [];
}

function clampScore(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 10 : numeric));
}

function normalizeOriginLikeList(value: unknown, verified = false): unknown[] {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? record.skill ?? record.skill_name ?? record.title ?? '').trim();
      const why = String(record.why ?? record.reason ?? record.rationale ?? record.description ?? record.central_thesis ?? '').trim();
      const how = asStringArray(record.how ?? record.method ?? record.steps ?? record.how_steps ?? record.process).join('\n')
        || String(record.how ?? record.method ?? record.process ?? '').trim();
      const evidenceQuotes = asStringArray(record.evidence_quotes ?? record.evidence ?? record.quotes ?? record.examples);
      if (!name || !why || !how || evidenceQuotes.length === 0) return null;
      return {
        name,
        why,
        how,
        confidence: clampScore(record.confidence, 0.72),
        evidence_quotes: evidenceQuotes,
        ...(verified
          ? {
              evidence_strength: clampScore(record.evidence_strength, 0.75),
              method_specificity: clampScore(record.method_specificity, 0.75),
              transferable: record.transferable === undefined ? true : Boolean(record.transferable),
            }
          : {}),
      };
    })
    .filter(Boolean) as unknown[];
}

function normalizeDistilledSkillLike(value: unknown): unknown {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const name = String(record.name ?? record.skill_name ?? record.skill ?? record.title ?? 'Distilled Skill').trim();
  const howSteps = asStringArray(record.how_steps ?? record.method ?? record.steps ?? record.process);
  return {
    name,
    central_thesis: String(record.central_thesis ?? record.thesis ?? record.description ?? record.why ?? name).trim(),
    why: String(record.why ?? record.rationale ?? record.description ?? record.central_thesis ?? name).trim(),
    how_steps: howSteps.length > 0 ? howSteps : [String(record.how ?? record.method ?? name)],
    boundaries: asStringArray(record.boundaries ?? record.boundary ?? record.limits).length > 0
      ? asStringArray(record.boundaries ?? record.boundary ?? record.limits)
      : ['Use only when the user intent matches the trigger signals.'],
    trigger_signals: asStringArray(record.trigger_signals ?? record.triggers ?? record.trigger).length > 0
      ? asStringArray(record.trigger_signals ?? record.triggers ?? record.trigger)
      : [name],
    anti_patterns: asStringArray(record.anti_patterns ?? record.antiPatterns ?? record.misuse),
    contradiction_risk: clampScore(record.contradiction_risk ?? record.risk, 0.08),
    confidence: clampScore(record.confidence, 0.72),
    coverage_tags: asStringArray(record.coverage_tags ?? record.tags),
  };
}

async function generateGeminiJsonText(options: {
  prompt: string;
  model?: string;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing.');
  }
  const requestedModel = String(options.model || '').trim();
  const models = requestedModel
    ? [requestedModel, ...(requestedModel === 'gemini-2.5-flash' ? ['gemini-2.5-flash-lite'] : [])]
    : ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  const prompt = `${options.prompt}

JSON contract:
${buildGeminiJsonContract(options.label)}

Return only valid compact JSON. Do not include markdown fences or explanatory text. Keep evidence quotes short.`;
  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await withTimeout(
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
            },
          }),
        }),
        options.timeoutMs,
        `${options.label} gemini-direct`
      );
      const payload: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error?.message || `Gemini generateContent ${response.status}`;
        throw new Error(message);
      }
      const text = extractGeminiText(payload);
      if (!text) throw new Error('Gemini returned empty text.');
      return text;
    } catch (error) {
      lastError = error;
      if (!shouldFailoverProviderError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini prompt generation failed.');
}

function buildGeminiJsonContract(label: string): string {
  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.includes('origin extraction')) {
    return '{"origins":[{"name":"string","why":"string","how":"string","confidence":0.7,"evidence_quotes":["short quote"]}]}';
  }
  if (normalizedLabel.includes('candidate extraction')) {
    return '{"candidates":[{"name":"string","why":"string","how":"string","confidence":0.7,"evidence_quotes":["short quote"]}]}';
  }
  if (normalizedLabel.includes('candidate verification')) {
    return '{"verified":[{"name":"string","why":"string","how":"string","confidence":0.7,"evidence_quotes":["short quote"],"evidence_strength":0.7,"method_specificity":0.7,"transferable":true}]}';
  }
  if (normalizedLabel.includes('distill')) {
    return '{"skill":{"name":"string","central_thesis":"string","why":"string","how_steps":["step"],"boundaries":["boundary"],"trigger_signals":["trigger"],"anti_patterns":["anti-pattern"],"contradiction_risk":0.1,"confidence":0.7,"coverage_tags":["tag"]}}';
  }
  if (normalizedLabel.includes('evidence expansion')) {
    return '{"expanded":[{"name":"string","similarity":0.7,"source_platform":"unknown","source_ref":"string","confidence":0.7}]}';
  }
  return '{"result":{}}';
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

function sourceKeyFromDoc(doc: RawDocument): string {
  return doc.source_url ?? doc.author_handle ?? doc.author ?? doc.source_platform ?? doc.source_type;
}

function dedupeRawDocumentsForSkill(docs: RawDocument[]): RawDocument[] {
  const seen = new Set<string>();
  const out: RawDocument[] = [];
  for (const doc of docs) {
    const content = doc.content.trim();
    if (!content) continue;
    const key = JSON.stringify([doc.source_url ?? '', doc.published_at ?? '', content.slice(0, 240)]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...doc, content });
  }
  return out;
}

function inferSourceBreakdown(docs: RawDocument[]): Record<string, number> {
  return docs.reduce<Record<string, number>>((acc, doc) => {
    const key = doc.source_platform ?? doc.source_type ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function buildSemanticChunksFromDocs(docs: RawDocument[]): SemanticChunk[] {
  return docs.map((doc, i) => ({
    id: crypto.randomUUID(),
    document_id: doc.id,
    content: doc.content,
    source_type: doc.source_type,
    author: doc.author,
    published_at: doc.published_at,
    chunk_index: i,
    total_chunks: docs.length,
    token_count: Math.ceil(doc.content.length / 4),
  }));
}

function docsToLocalEvidenceRefs(docs: RawDocument[], similarity = 0.85): SkillEvidenceRef[] {
  return docs.slice(0, 20).map((doc) => ({
    source: sourceKeyFromDoc(doc),
    source_platform: doc.source_platform ?? doc.source_type,
    snippet: doc.content.slice(0, 260),
    similarity,
  }));
}

function classifySkillEvidenceDimension(text: string): 'writings' | 'conversations' | 'expression' | 'external_views' | 'decisions' | 'timeline' {
  const lower = text.toLowerCase();
  if (/(podcast|interview|ama|访谈|播客|对话|问答|追问)/i.test(text)) return 'conversations';
  if (/(twitter|tweet|x\.com|微博|即刻|thread|表达|语气|写法|风格|句式)/i.test(text)) return 'expression';
  if (/(critique|review|biography|评价|批评|他人|外部|同行|争议)/i.test(text)) return 'external_views';
  if (/(decision|decide|choice|tradeoff|转折|决策|选择|取舍|行动|案例|case)/i.test(text)) return 'decisions';
  if (/(timeline|latest|recent|202[0-9]|时间线|最新|近期|里程碑)/i.test(text)) return 'timeline';
  if (/(essay|book|newsletter|blog|paper|文章|长文|著作|书|论文|博客)/i.test(text)) return 'writings';
  return lower.length > 600 ? 'writings' : 'expression';
}

const SKILL_METHOD_PATTERNS: Array<{
  id: string;
  name: string;
  aliases: string[];
  why: string;
  how: string;
  triggers: string[];
}> = [
  {
    id: 'think',
    name: 'Structured Solution Thinking',
    aliases: ['/think', 'think skill', '思考', '方案设计', 'solution design', 'planning'],
    why: 'Turns ambiguous problems into pressure-tested plans before execution.',
    how: 'Question the problem, list constraints, compare options, stress-test the architecture, then hand execution a concrete plan.',
    triggers: ['plan', 'architecture', 'solution design', 'think through', '方案', '规划'],
  },
  {
    id: 'design',
    name: 'Taste-Driven Product Design',
    aliases: ['/design', 'design skill', '设计', '审美', 'taste', 'product design'],
    why: 'Keeps product output from becoming generic by forcing a clear design direction and audience fit.',
    how: 'Define the user and domain, choose the design direction, make concrete interface decisions, then verify the result against taste and usability.',
    triggers: ['design', 'ui', 'ux', 'taste', 'product', '界面', '设计'],
  },
  {
    id: 'hunt',
    name: 'Root-Cause Debugging',
    aliases: ['/hunt', 'hunt skill', 'debug', 'debugging', '排查', '定位', '根因'],
    why: 'Prevents patch-churn by requiring a precise root cause before editing code.',
    how: 'Reproduce the failure, add observation, test hypotheses, state the root cause in one sentence, then make the smallest fix and verify it.',
    triggers: ['bug', 'debug', 'root cause', '排查', '定位原因', '修复'],
  },
  {
    id: 'check',
    name: 'Evidence-Based Review',
    aliases: ['/check', 'check skill', 'review', 'code review', '检查', '审查'],
    why: 'Treats AI output as untrusted until the diff and evidence show it is actually correct.',
    how: 'Review the diff, separate automatic fixes from judgment calls, validate with tests or evidence, and report residual risk.',
    triggers: ['review', 'check', 'diff', 'quality', '检查', '评审'],
  },
  {
    id: 'read',
    name: 'Primary-Source Reading',
    aliases: ['/read', 'read skill', '阅读', '一手资料', 'primary source', 'url', 'pdf'],
    why: 'Avoids secondhand summaries by converting source material into clean working context.',
    how: 'Read the original source, extract the claims and structure, keep citations, and distinguish facts from interpretation.',
    triggers: ['read', 'url', 'pdf', 'source', 'article', '阅读', '资料'],
  },
  {
    id: 'write',
    name: 'Audience-Shaped Technical Writing',
    aliases: ['/write', 'write skill', '写作', '表达', 'communication'],
    why: 'Makes technical understanding transmissible to the intended audience.',
    how: 'Clarify audience and outcome, outline the argument, draft in the right voice, remove ambiguity, and polish for readability.',
    triggers: ['write', 'draft', 'explain', '文章', '写作', '表达'],
  },
  {
    id: 'learn',
    name: 'Output-Driven Learning',
    aliases: ['/learn', 'learn skill', '学习', '输出驱动', '陌生领域'],
    why: 'Uses public or concrete output to force real understanding of a new field.',
    how: 'Collect sources, digest them into structure, draft an output, test gaps, revise, then publish or archive the learning artifact.',
    triggers: ['learn', 'research', 'study', '学习', '调研', '新领域'],
  },
  {
    id: 'health',
    name: 'Toolchain Health Check',
    aliases: ['/health', 'health skill', '维护', '体检', 'toolchain', 'mcp', 'hooks', 'rules'],
    why: 'Keeps the agent/tooling environment reliable instead of only fixing business code.',
    how: 'Inspect rules, hooks, MCP, runtime configuration, stale state, and failure logs; then summarize concrete fixes and risks.',
    triggers: ['health', 'toolchain', 'mcp', 'rules', 'hooks', '体检', '维护'],
  },
];

function findMethodPatternDrafts(docs: RawDocument[]): OriginCandidateDraft[] {
  const drafts: OriginCandidateDraft[] = [];
  for (const pattern of SKILL_METHOD_PATTERNS) {
    const matches = docs.filter((doc) => {
      const text = doc.content.toLowerCase();
      return pattern.aliases.some((alias) => text.includes(alias.toLowerCase()));
    });
    if (matches.length === 0) continue;
    const sourceKeys = Array.from(new Set(matches.map(sourceKeyFromDoc))).slice(0, 8);
    const dimensions = new Set(matches.map((doc) => classifySkillEvidenceDimension(doc.content)));
    drafts.push({
      name: pattern.name,
      why: pattern.why,
      how: pattern.how,
      confidence: Math.min(0.92, 0.62 + matches.length * 0.035 + dimensions.size * 0.04),
      evidence_quotes: matches.slice(0, 6).map((doc) => doc.content.slice(0, 420)),
      evidence_sources: sourceKeys,
      transferable: true,
      evidence_strength: Math.min(1, Math.max(matches.length / 4, dimensions.size / 3)),
      method_specificity: 0.88,
    });
  }
  return drafts;
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

function selectAcceptedOriginCandidates(
  candidates: OriginCandidateDraft[]
): { accepted: OriginSkill[]; pending: OriginSkill[] } {
  const accepted: OriginSkill[] = [];
  const pending: OriginSkill[] = [];

  for (const item of candidates) {
    const evidenceQuotes = Array.from(new Set(item.evidence_quotes.map((quote) => quote.trim()).filter(Boolean))).slice(0, 6);
    const normalized: OriginSkill = {
      id: crypto.randomUUID(),
      name: item.name.trim(),
      why: item.why.trim(),
      how: item.how.trim(),
      confidence: item.confidence,
      evidence: evidenceQuotes.map((quote, idx) => ({
        quote,
        source: item.evidence_sources?.[idx] ?? item.evidence_sources?.[0] ?? 'persona_corpus',
      })),
    };
    const evidenceStrength = item.evidence_strength ?? Math.min(1, evidenceQuotes.length / 4);
    const methodSpecificity = item.method_specificity ?? (
      normalized.how.length >= 24 && /\b(use|build|compare|decide|map|test|write|frame|split|rank|filter)\b/i.test(normalized.how)
        ? 0.75
        : 0.45
    );
    const transferable = item.transferable ?? true;
    const acceptedByGate =
      transferable &&
      normalized.name.length >= 4 &&
      normalized.why.length >= 12 &&
      normalized.how.length >= 12 &&
      normalized.confidence >= 0.45 &&
      evidenceQuotes.length >= 2 &&
      evidenceStrength >= 0.45 &&
      methodSpecificity >= 0.5;

    if (acceptedByGate) {
      accepted.push(normalized);
    } else {
      pending.push(normalized);
    }
  }

  return {
    accepted: dedupeOrigins(accepted).slice(0, MAX_ORIGINS_FOR_DISTILL),
    pending: dedupeOrigins(pending).slice(0, MAX_ORIGINS_FOR_DISTILL),
  };
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
  return {
    distilled: sortedAccepted.slice(0, 6),
    candidatePool: candidates,
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

  const object = await generateSkillObject({
    schema: SkillExpandSchema,
    timeoutMs: getSkillExpandTimeoutMs(),
    label: 'skill evidence expansion',
    prompt: `Find related evidence sources for this skill origin.
Origin: ${origin.name}
WHY: ${origin.why}
HOW: ${origin.how}
Return 3 candidate sources.`,
  });

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

function collectLocalEvidenceForOrigin(origin: OriginSkill, docs: RawDocument[]): SkillEvidenceRef[] {
  const originText = normalizeName(`${origin.name} ${origin.why} ${origin.how}`);
  const originTokens = originText.split(/\s+/).filter((token) => token.length >= 2);
  const scored = docs
    .map((doc) => {
      const normalized = normalizeName(doc.content);
      const hits = originTokens.filter((token) => normalized.includes(token)).length;
      const aliasBoost = SKILL_METHOD_PATTERNS.some((pattern) =>
        similarityByTokenOverlap(origin.name, pattern.name) >= 0.45 &&
        pattern.aliases.some((alias) => doc.content.toLowerCase().includes(alias.toLowerCase()))
      ) ? 0.35 : 0;
      return {
        doc,
        score: originTokens.length > 0 ? hits / originTokens.length + aliasBoost : aliasBoost,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const refs = scored.map((item) => ({
    source: sourceKeyFromDoc(item.doc),
    source_platform: item.doc.source_platform ?? item.doc.source_type,
    snippet: item.doc.content.slice(0, 260),
    similarity: Math.max(0.45, Math.min(1, item.score)),
  }));
  return mergeUniqueEvidence(docsToLocalEvidenceRefs([], 0.85), [
    ...refs,
    ...origin.evidence.map((item) => ({
      source: item.source,
      source_platform: item.source,
      snippet: item.quote,
      similarity: 1,
    })),
  ]);
}

async function distillSkillFromCluster(
  cluster: { id: string; thesis: string; origins: OriginSkill[] },
  evidenceRefs: SkillEvidenceRef[]
): Promise<Omit<DistilledSkill, 'quality_score' | 'id' | 'last_validated_at'>> {
  const originText = cluster.origins
    .map((item, idx) => `Origin ${idx + 1}\nName: ${item.name}\nWHY: ${item.why}\nHOW: ${item.how}`)
    .join('\n\n');
  const evidenceText = evidenceRefs.slice(0, 12).map((item, idx) => `[${idx + 1}] ${item.snippet}`).join('\n');

  const object = await generateSkillObject({
    schema: DistillSkillSchema,
    timeoutMs: getSkillDistillTimeoutMs(),
    label: 'skill distill',
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
  });

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
  selectAcceptedOriginCandidates,
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

function buildSkillBuildReport(input: {
  library: PersonaSkillLibrary;
  evidenceDocs: RawDocument[];
  failureReason?: string;
}): SkillBuildReport {
  const { library, evidenceDocs, failureReason } = input;
  const evidenceSourceCount = new Set(evidenceDocs.map(sourceKeyFromDoc)).size;
  const sourceDiversity = Object.keys(inferSourceBreakdown(evidenceDocs)).length;
  const qualityScore = Math.max(
    0,
    Math.min(
      1,
      library.distilled_skills.length >= 3
        ? library.distilled_skills.reduce((sum, item) => sum + item.quality_score, 0) / library.distilled_skills.length
        : library.candidate_skill_pool.length > 0 || library.origin_skills.length > 0
          ? 0.45
          : 0
    )
  );
  const status: SkillBuildStatus = failureReason
    ? 'failed'
    : library.distilled_skills.length >= 3
      ? 'ready'
      : library.origin_skills.length > 0 || library.candidate_skill_pool.length > 0 || library.pending_candidates.length > 0
        ? 'pending'
        : 'pending';
  return {
    status,
    originCount: library.origin_skills.length,
    distilledCount: library.distilled_skills.length,
    candidateCount: library.candidate_skill_pool.length,
    pendingCount: library.pending_candidates.length,
    qualityScore,
    failureReason,
    evidenceSourceCount,
    sourceDiversity,
  };
}

export async function buildSkillLibraryFromSourcesWithReport(
  persona: Persona,
  _soul: Soul,
  chunks: SemanticChunk[],
  docs: RawDocument[],
  previous?: PersonaSkillLibrary
): Promise<SkillBuildResult> {
  const evidenceDocs = dedupeRawDocumentsForSkill(docs);
  const effectiveChunks = chunks.length > 0 ? chunks : buildSemanticChunksFromDocs(evidenceDocs);
  const seedText = effectiveChunks.slice(0, 90).map((c, i) => {
    const dimension = classifySkillEvidenceDimension(c.content);
    return `[${i + 1}][${dimension}] ${c.content.slice(0, 360)}`;
  }).join('\n');
  let extractedOrigins: z.infer<typeof OriginExtractionSchema>['origins'] = [];
  let candidateOrigins: OriginCandidateDraft[] = findMethodPatternDrafts(evidenceDocs);
  try {
    const object = await generateSkillObject({
      schema: OriginExtractionSchema,
      timeoutMs: getSkillOriginTimeoutMs(),
      label: 'skill origin extraction',
      prompt: `Extract core idea-origin skills from this persona content.
Persona: ${persona.name}
Rules:
- focus on center ideas and reusable methods
- use the corpus evidence directly; prefer repeated methods, decision procedures, and judgment patterns
- a real skill should pass at least two of: cross-domain recurrence, generative power, distinctiveness
- avoid generic topics
- max 12 origins

Content:\n${seedText || 'No content'}`,
    });
    extractedOrigins = object.origins;
  } catch (error) {
    console.warn(`[SkillLibrary] origin extraction failed, fallback to previous skills: ${String(error)}`);
  }

  if (extractedOrigins.length === 0) {
    try {
      const object = await generateSkillObject({
        schema: OriginCandidateExtractionSchema,
        timeoutMs: getSkillOriginTimeoutMs(),
        label: 'skill candidate extraction',
        prompt: `Extract candidate transferable skills from this persona content.
Persona: ${persona.name}
Rules:
- return method-like candidates, not generic topics
- candidates may be noisy; prioritize recall
- max 16 candidates
- each candidate must include direct evidence quotes
- prefer skills with concrete trigger situations and repeatable steps

Content:\n${seedText || 'No content'}`,
      });
      candidateOrigins = [...candidateOrigins, ...object.candidates];
    } catch (error) {
      console.warn(`[SkillLibrary] candidate extraction failed: ${String(error)}`);
    }
  } else {
    candidateOrigins = [...candidateOrigins, ...extractedOrigins.map((item) => ({
      name: item.name,
      why: item.why,
      how: item.how,
      confidence: item.confidence,
      evidence_quotes: item.evidence_quotes,
      transferable: true,
      evidence_strength: Math.min(1, item.evidence_quotes.length / 4),
      method_specificity: item.how.trim().length >= 24 ? 0.8 : 0.55,
    }))];
  }

  let verifiedOrigins: OriginCandidateDraft[] = [];
  if (candidateOrigins.length > 0) {
    const candidateText = candidateOrigins
      .slice(0, 16)
      .map((item, idx) => `Candidate ${idx + 1}
name: ${item.name}
why: ${item.why}
how: ${item.how}
confidence: ${item.confidence}
evidence:
- ${item.evidence_quotes.slice(0, 4).join('\n- ')}`)
      .join('\n\n');

    try {
      const object = await generateSkillObject({
        schema: OriginVerificationSchema,
        timeoutMs: getSkillOriginTimeoutMs(),
        label: 'skill candidate verification',
        prompt: `Verify which candidate skills are truly transferable for this persona.
Persona: ${persona.name}
Rules:
- keep only skills that reflect reusable methods or judgment patterns
- reject pure topics, biography facts, and vague traits
- require evidence-grounded why/how
- score evidence_strength and method_specificity strictly
- reward cross-domain recurrence, generative power, and distinctive viewpoint

Candidates:
${candidateText}`,
      });
      verifiedOrigins = object.verified.filter((item) => item.transferable);
    } catch (error) {
      console.warn(`[SkillLibrary] origin verification failed, fallback to raw candidates: ${String(error)}`);
    }
  }

  const selectedOrigins = selectAcceptedOriginCandidates(verifiedOrigins.length > 0 ? verifiedOrigins : candidateOrigins);
  const acceptedOrigins = selectedOrigins.accepted;
  const pendingOrigins = selectedOrigins.pending;

  const clusters = clusterOrigins(acceptedOrigins).slice(0, MAX_CLUSTERS_FOR_DISTILL);
  const acceptedDistilled: DistilledSkill[] = [];
  const candidatePool: CandidateSkill[] = [];
  const stageStart = Date.now();

  for (const cluster of clusters) {
    if (Date.now() - stageStart > getSkillStageBudgetMs()) {
      console.warn('[SkillLibrary] distill stage budget exceeded, stop further clusters');
      break;
    }
    const clusterEvidence: SkillEvidenceRef[] = [];
    for (const origin of cluster.origins) {
      if (Date.now() - stageStart > getSkillStageBudgetMs()) break;
      try {
        const refs = mergeUniqueEvidence(
          collectLocalEvidenceForOrigin(origin, evidenceDocs),
          await collectEvidenceForOrigin(origin)
        );
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

  const library: PersonaSkillLibrary = {
    ...base,
    schema_version: 2,
    persona_slug: persona.slug,
    version: base.version + 1,
    updated_at: new Date().toISOString(),
    source_trace: Array.from(new Set([...base.source_trace, ...evidenceDocs.slice(0, 50).map(sourceKeyFromDoc)])),
    origin_skills: mergedOrigins,
    distilled_skills: selected.distilled,
    candidate_skill_pool: selected.candidatePool.slice(0, 20),
    clusters: clusterOut,
    pending_candidates: mergeOrigins(base.pending_candidates, pendingOrigins),
    expanded_skills: [],
  };
  return {
    library,
    report: buildSkillBuildReport({ library, evidenceDocs }),
  };
}

export async function buildSkillLibraryFromSources(
  persona: Persona,
  soul: Soul,
  chunks: SemanticChunk[],
  docs: RawDocument[],
  previous?: PersonaSkillLibrary
): Promise<PersonaSkillLibrary> {
  return (await buildSkillLibraryFromSourcesWithReport(persona, soul, chunks, docs, previous)).library;
}

export async function buildSkillLibraryFromEvidence(
  persona: Persona,
  soul: Soul,
  evidence: SkillBuildEvidence,
  previous?: PersonaSkillLibrary
): Promise<SkillBuildResult> {
  const primaryDocs = dedupeRawDocumentsForSkill(evidence.docs);
  if (primaryDocs.length === 0) {
    const base = previous ?? createEmptySkillLibrary(persona.slug);
    const library = {
      ...base,
      version: base.version + 1,
      updated_at: new Date().toISOString(),
    };
    return {
      library,
      report: buildSkillBuildReport({
        library,
        evidenceDocs: primaryDocs,
        failureReason: 'no_skill_evidence_docs',
      }),
    };
  }
  const supplementalDocs = dedupeRawDocumentsForSkill(
    (evidence.memorySignals ?? []).map((content) => ({
      id: crypto.randomUUID(),
      source_type: 'custom' as const,
      content,
      author: persona.name,
      fetched_at: evidence.generatedAt ?? new Date().toISOString(),
      metadata: { skill_signal_source: 'memory' },
    }))
  );
  const docs = dedupeRawDocumentsForSkill([...primaryDocs, ...supplementalDocs]);
  return buildSkillLibraryFromSourcesWithReport(persona, soul, buildSemanticChunksFromDocs(docs), docs, previous);
}

export async function refreshSkillLibraryFromSignalsWithReport(
  persona: Persona,
  soul: Soul,
  signals: string[],
  previous?: PersonaSkillLibrary
): Promise<SkillBuildResult> {
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

  return buildSkillLibraryFromSourcesWithReport(persona, soul, fakeChunks, fakeDocs, previous);
}

export async function refreshSkillLibraryFromSignals(
  persona: Persona,
  soul: Soul,
  signals: string[],
  previous?: PersonaSkillLibrary
): Promise<PersonaSkillLibrary> {
  return (await refreshSkillLibraryFromSignalsWithReport(persona, soul, signals, previous)).library;
}

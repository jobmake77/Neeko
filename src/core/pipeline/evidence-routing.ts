import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { RawDocument, SemanticChunk } from '../models/memory.js';
import { EvidenceItem, EvidenceRoutingMetadata, EvidenceScene, EvidenceSpeakerRole } from '../models/evidence.js';
import { DataCleaner, SemanticChunker } from './cleaner.js';
import type { TrainingStrategyDecision } from '../training/strategy-resolver.js';
import { convertEvidenceItemsToDocuments } from './evidence-layer.js';

export type InputRoutingStrategy = 'legacy' | 'v2';
export type InputRoute = 'soul' | 'memory' | 'discard';

export interface RoutedDocument {
  doc: RawDocument;
  route: InputRoute;
  score: number;
  decision_reason: string;
  decision_flags: string[];
  score_breakdown: {
    attribution_score: number;
    stability_score: number;
    clarity_score: number;
  };
}

export interface InputRoutingObservability {
  strategy: InputRoutingStrategy;
  raw_docs: number;
  clean_docs: number;
  chunks: number;
  soul_docs: number;
  memory_docs: number;
  discard_docs: number;
  quarantined_docs: number;
  promotion_candidates: number;
  promoted_to_soul_docs: number;
  filtered_low_quality_docs: number;
}

export interface RoutedEvidenceResult {
  strategy: InputRoutingStrategy;
  rawDocs: RawDocument[];
  cleanDocs: RawDocument[];
  soulDocs: RawDocument[];
  memoryDocs: RawDocument[];
  discardDocs: RawDocument[];
  routedDocs: RoutedDocument[];
  chunks: SemanticChunk[];
  soulChunks: SemanticChunk[];
  observability: InputRoutingObservability;
}

export interface InputRoutingReport {
  strategy: InputRoutingStrategy;
  generated_at: string;
  observability: InputRoutingObservability;
  strategy_decision?: TrainingStrategyDecision;
  routed_docs: Array<Pick<RoutedDocument, 'route' | 'score' | 'decision_reason' | 'decision_flags'>>;
}

interface CorpusRoutingHints {
  docCount: number;
  medianLength: number;
  shortDocRatio: number;
  shortFormDominant: boolean;
  largeCorpus: boolean;
}

export function normalizeInputRoutingStrategy(raw?: string, fallback: InputRoutingStrategy = 'legacy'): InputRoutingStrategy {
  const value = String(raw ?? fallback).toLowerCase();
  return value === 'v2' ? 'v2' : 'legacy';
}

export function routeEvidenceDocuments(
  docs: RawDocument[],
  options: {
    strategy?: InputRoutingStrategy;
    targetSignals?: string[];
    cleaner?: DataCleaner;
    chunker?: SemanticChunker;
  } = {}
): RoutedEvidenceResult {
  const strategy = options.strategy ?? 'legacy';
  const cleaner = options.cleaner ?? new DataCleaner();
  const chunker = options.chunker ?? new SemanticChunker();
  const cleanDocs = cleaner.clean(docs);

  if (strategy === 'legacy') {
    const chunks = chunker.chunkAll(cleanDocs);
    return {
      strategy,
      rawDocs: docs,
      cleanDocs,
      soulDocs: cleanDocs,
      memoryDocs: [],
      discardDocs: docs.slice(cleanDocs.length),
      routedDocs: cleanDocs.map((doc) => ({
        doc,
        route: 'soul',
        score: 1,
        decision_reason: 'legacy routing keeps all cleaned documents for soul extraction',
        decision_flags: ['legacy'],
        score_breakdown: {
          attribution_score: 1,
          stability_score: 1,
          clarity_score: 1,
        },
      })),
      chunks,
      soulChunks: chunks,
      observability: {
        strategy,
        raw_docs: docs.length,
        clean_docs: cleanDocs.length,
        chunks: chunks.length,
        soul_docs: cleanDocs.length,
        memory_docs: 0,
        discard_docs: Math.max(0, docs.length - cleanDocs.length),
        quarantined_docs: 0,
        promotion_candidates: 0,
        promoted_to_soul_docs: 0,
        filtered_low_quality_docs: Math.max(0, docs.length - cleanDocs.length),
      },
    };
  }

  const targetSignals = (options.targetSignals ?? []).map(normalizeSignal).filter(Boolean);
  const corpusHints = deriveCorpusRoutingHints(cleanDocs);
  const routedDocs = cleanDocs.map((doc) => scoreDocument(doc, targetSignals, corpusHints));
  const promotedToSoul = promoteSoulCandidates(routedDocs, cleanDocs.length);
  const soulDocs = routedDocs
    .filter((item) => item.route === 'soul')
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc);
  const memoryDocs = routedDocs
    .filter((item) => item.route === 'memory')
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc);
  const discardDocs = routedDocs.filter((item) => item.route === 'discard').map((item) => item.doc);
  const chunks = chunker.chunkAll([...soulDocs, ...memoryDocs]);
  const soulChunks = chunker.chunkAll(soulDocs);

  return {
    strategy,
    rawDocs: docs,
    cleanDocs,
    soulDocs,
    memoryDocs,
    discardDocs,
    routedDocs,
    chunks,
    soulChunks,
    observability: {
      strategy,
      raw_docs: docs.length,
      clean_docs: cleanDocs.length,
      chunks: chunks.length,
      soul_docs: soulDocs.length,
      memory_docs: memoryDocs.length,
      discard_docs: discardDocs.length + Math.max(0, docs.length - cleanDocs.length),
      quarantined_docs: 0,
      promotion_candidates: routedDocs.filter((item) => item.route === 'memory' && item.score >= 0.62).length,
      promoted_to_soul_docs: promotedToSoul,
      filtered_low_quality_docs: Math.max(0, docs.length - cleanDocs.length) + discardDocs.length,
    },
  };
}

export function routeEvidenceItems(
  items: EvidenceItem[],
  options: {
    strategy?: InputRoutingStrategy;
    targetSignals?: string[];
    cleaner?: DataCleaner;
    chunker?: SemanticChunker;
    sourceDocs?: RawDocument[];
  } = {}
): RoutedEvidenceResult {
  const docs = convertEvidenceItemsToDocuments(items, options.sourceDocs ?? []);
  return routeEvidenceDocuments(docs, options);
}

export function writeRawDocsCache(personaDir: string, docs: RawDocument[]): void {
  writeFileSync(join(personaDir, 'raw-docs.json'), JSON.stringify(docs, null, 2), 'utf-8');
}

export function loadRawDocsCache(personaDir: string): RawDocument[] {
  const path = join(personaDir, 'raw-docs.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as RawDocument[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeInputRoutingReport(
  personaDir: string,
  report: InputRoutingReport
): void {
  writeFileSync(join(personaDir, `input-routing-${report.strategy}.json`), JSON.stringify(report, null, 2), 'utf-8');
}

export function loadInputRoutingReport(personaDir: string, strategy: InputRoutingStrategy): InputRoutingReport | null {
  const path = join(personaDir, `input-routing-${strategy}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as InputRoutingReport;
    return parsed && parsed.strategy ? parsed : null;
  } catch {
    return null;
  }
}

function scoreDocument(doc: RawDocument, targetSignals: string[], corpusHints: CorpusRoutingHints): RoutedDocument {
  const normalizedContent = doc.content.trim().replace(/\s+/g, ' ');
  const evidence = readEvidenceMetadata(doc);
  const attribution = scoreAttribution(doc, targetSignals, evidence);
  const stability = scoreStability(doc, normalizedContent, evidence);
  const clarity = scoreClarity(normalizedContent, evidence);
  const score = clamp(attribution * 0.4 + stability * 0.35 + clarity * 0.25);
  const flags: string[] = [];

  if (attribution >= 0.8) flags.push('first_party');
  if (stability >= 0.75) flags.push('stable_signal');
  if (clarity < 0.45) flags.push('low_context');
  if (!doc.published_at) flags.push('time_unknown');
  if ((doc.author ?? '').toLowerCase() === 'unknown') flags.push('author_unknown');
  if (evidence?.speaker_role) flags.push(`speaker_${evidence.speaker_role}`);
  if (evidence?.scene) flags.push(`scene_${evidence.scene}`);
  if (evidence?.stability_hints?.cross_session_stable) flags.push('cross_session_stable');

  if (clarity < 0.35 || normalizedContent.length < 40) {
    return buildRoutedDoc(doc, 'discard', score, 'discarded for low clarity or insufficient context', flags, attribution, stability, clarity);
  }

  if (evidence?.speaker_role && evidence.speaker_role !== 'target') {
    if (score >= 0.42) {
      return buildRoutedDoc(doc, 'memory', score, 'non-target evidence retained for contextual memory only', flags, attribution, stability, clarity);
    }
    return buildRoutedDoc(doc, 'discard', score, 'non-target evidence discarded from cultivation routing', flags, attribution, stability, clarity);
  }

  const blockedByEphemeralNoise = looksEphemeral(normalizedContent, clarity);
  const blockedByCorpusPressure = shouldKeepAsMemoryInLargeCorpus(doc, normalizedContent, score, clarity, corpusHints);

  const canShapeSoul =
    attribution >= 0.58 &&
    stability >= 0.52 &&
    (
      (clarity >= 0.5 && normalizedContent.length >= 100) ||
      qualifiesAsShortFormSoulSignal(doc, normalizedContent, attribution, stability, clarity, corpusHints)
    ) &&
    !blockedByEphemeralNoise &&
    !blockedByCorpusPressure &&
    canSceneShapeSoul(evidence);

  if (canShapeSoul && score >= 0.62) {
    return buildRoutedDoc(doc, 'soul', score, 'high-confidence stable evidence kept for soul extraction', flags, attribution, stability, clarity);
  }

  if (score >= 0.42) {
    return buildRoutedDoc(doc, 'memory', score, 'useful contextual evidence retained for memory-only routing', flags, attribution, stability, clarity);
  }

  return buildRoutedDoc(doc, 'discard', score, 'discarded by v2 evidence routing thresholds', flags, attribution, stability, clarity);
}

function buildRoutedDoc(
  doc: RawDocument,
  route: InputRoute,
  score: number,
  reason: string,
  flags: string[],
  attribution_score: number,
  stability_score: number,
  clarity_score: number
): RoutedDocument {
  return {
    doc,
    route,
    score,
    decision_reason: reason,
    decision_flags: Array.from(new Set(flags)),
    score_breakdown: {
      attribution_score,
      stability_score,
      clarity_score,
    },
  };
}

function scoreAttribution(doc: RawDocument, targetSignals: string[], evidence?: EvidenceRoutingMetadata): number {
  if (evidence?.speaker_role === 'target') {
    return clamp(Math.max(0.78, 0.7 + (evidence.target_confidence ?? 0.6) * 0.28));
  }
  if (evidence?.speaker_role === 'self' || evidence?.speaker_role === 'other') {
    return 0.22;
  }
  if (evidence?.speaker_role === 'unknown') {
    return 0.36;
  }

  const authorSignals = [
    doc.author,
    doc.author_handle,
    doc.source_url,
    doc.source_platform,
  ]
    .map(normalizeSignal)
    .filter(Boolean);

  if (authorSignals.some((signal) => targetSignals.includes(signal))) return 0.92;
  if ((doc.author ?? '').toLowerCase() !== 'unknown' || doc.author_handle) return 0.72;
  if (doc.source_type === 'article' && doc.source_url) return 0.58;
  return 0.4;
}

function scoreStability(doc: RawDocument, content: string, evidence?: EvidenceRoutingMetadata): number {
  let score = 0.35;
  if (doc.published_at) score += 0.2;
  if (content.length >= 280) score += 0.2;
  if (doc.source_type === 'article' || doc.source_type === 'twitter') score += 0.15;
  if (/\b(always|never|believe|value|principle|because|should)\b/i.test(content)) score += 0.1;
  score += scoreEngagement(doc);
  if (evidence?.stability_hints?.cross_session_stable) score += 0.18;
  if ((evidence?.stability_hints?.repeated_in_sessions ?? 0) >= 2) score += 0.08;
  if (evidence?.evidence_kind === 'decision' || evidence?.evidence_kind === 'behavior_signal') score += 0.06;
  if (evidence?.scene === 'work' || evidence?.scene === 'public') score += 0.08;
  if (evidence?.scene === 'private') score -= 0.02;
  if (evidence?.scene === 'intimate' || evidence?.scene === 'conflict') score -= 0.16;
  return clamp(score);
}

function scoreClarity(content: string, evidence?: EvidenceRoutingMetadata): number {
  const weirdCharPenalty = (content.match(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu) ?? []).length / Math.max(1, content.length);
  let score = content.length >= 120 ? 0.7 : content.length >= 60 ? 0.55 : 0.35;
  if (/[.?!。！？]/.test(content)) score += 0.1;
  if (content.split(/\s+/).length >= 12) score += 0.1;
  if ((evidence?.context_before?.length ?? 0) > 0 || (evidence?.context_after?.length ?? 0) > 0) score += 0.06;
  score -= weirdCharPenalty * 3;
  return clamp(score);
}

function looksEphemeral(content: string, clarity = scoreClarity(content)): boolean {
  if (/\b(lol|lmao|omg|just now)\b/i.test(content)) return true;

  const hasTemporalAnchor = /\b(today|tonight|this week|yesterday|this morning|last night|weekend)\b/i.test(content);
  if (!hasTemporalAnchor) return false;

  // Long, clear posts can mention a time anchor while still expressing a durable belief
  // or pattern. We only block temporal language when the evidence is still lightweight.
  return content.length < 220 || clarity < 0.52;
}

function looksLinkOnly(content: string): boolean {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const withoutUrls = normalized.replace(/https?:\/\/\S+/gi, '').trim();
  return withoutUrls.length < 18;
}

function deriveCorpusRoutingHints(docs: RawDocument[]): CorpusRoutingHints {
  if (docs.length === 0) {
    return {
      docCount: 0,
      medianLength: 0,
      shortDocRatio: 0,
      shortFormDominant: false,
      largeCorpus: false,
    };
  }

  const lengths = docs.map((doc) => doc.content.length).sort((a, b) => a - b);
  const medianLength = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const shortDocRatio = docs.filter((doc) => doc.content.length < 100).length / docs.length;

  return {
    docCount: docs.length,
    medianLength,
    shortDocRatio,
    shortFormDominant: medianLength < 80 || shortDocRatio >= 0.55,
    largeCorpus: docs.length >= 300,
  };
}

function normalizeSignal(value: string | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9\u4e00-\u9fff./_-]+/g, ' ')
    .trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function canSceneShapeSoul(evidence?: EvidenceRoutingMetadata): boolean {
  const scene = evidence?.scene;
  if (scene === 'intimate' || scene === 'conflict') return false;
  if (scene === 'private') {
    return Boolean(
      evidence?.stability_hints?.cross_session_stable &&
      (evidence?.stability_hints?.repeated_in_sessions ?? 0) >= 3
    );
  }
  return true;
}

function shouldKeepAsMemoryInLargeCorpus(
  doc: RawDocument,
  content: string,
  score: number,
  clarity: number,
  corpusHints: CorpusRoutingHints
): boolean {
  if (!corpusHints.largeCorpus || doc.source_type !== 'twitter') return false;

  const trimmed = content.trim();
  const replyStyle = trimmed.startsWith('@');
  if (!replyStyle) return false;

  const engagement = scoreEngagement(doc);
  const isLongEnough = trimmed.length >= 160;
  const hasStrongEngagement = engagement >= 0.05;
  const hasReasoningCue = /\b(because|should|need to|important|interesting|exactly|agree|disagree|love|think|believe)\b/i.test(trimmed);

  if (!isLongEnough && !hasStrongEngagement) return true;
  if (trimmed.length < 120 && !hasReasoningCue) return true;
  if (clarity < 0.58 && score < 0.84) return true;
  return false;
}

function qualifiesAsShortFormSoulSignal(
  doc: RawDocument,
  content: string,
  attribution: number,
  stability: number,
  clarity: number,
  corpusHints: CorpusRoutingHints
): boolean {
  if (doc.source_type !== 'twitter') return false;
  if (!corpusHints.shortFormDominant) return false;
  if (attribution < 0.85 || stability < 0.58 || clarity < 0.35) return false;
  if (looksLinkOnly(content)) return false;

  const replyStyle = content.trim().startsWith('@');
  const minLength = replyStyle ? 42 : 28;
  if (content.length < minLength) return false;

  const engagement = scoreEngagement(doc);
  const statementLike =
    /\b(i think|i believe|we should|should|must|need to|this is|these are|makes sense|right policy|false|wonderful|fun|enables|will|would)\b/i.test(content) ||
    /[.!?]$/.test(content);

  if (!statementLike) return false;

  // For short-form tweets, we can accept lower textual clarity when the post is
  // clearly first-party, statement-like, and the audience signal is strong.
  const requiredEngagement = replyStyle
    ? (clarity < 0.45 ? 0.08 : 0.06)
    : (clarity < 0.45 ? 0.05 : 0.02);

  if (clarity < 0.45 && content.split(/\s+/).length < 6) return false;
  return engagement >= requiredEngagement;
}

function scoreEngagement(doc: RawDocument): number {
  const likes = numericMeta(doc.metadata?.likes);
  const views = numericMeta(doc.metadata?.views);
  if (likes <= 0 && views <= 0) return 0;

  const likeScore = likes > 0 ? Math.min(0.06, Math.log10(likes + 1) * 0.012) : 0;
  const viewScore = views > 0 ? Math.min(0.06, Math.log10(views + 1) * 0.01) : 0;
  return likeScore + viewScore;
}

function numericMeta(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readEvidenceMetadata(doc: RawDocument): EvidenceRoutingMetadata | undefined {
  const candidate = doc.metadata && typeof doc.metadata === 'object'
    ? (doc.metadata as Record<string, unknown>).evidence
    : undefined;
  if (!candidate || typeof candidate !== 'object') return undefined;
  return candidate as EvidenceRoutingMetadata;
}

function promoteSoulCandidates(routedDocs: RoutedDocument[], cleanDocCount: number): number {
  const targetSoulDocs = desiredSoulDocCount(cleanDocCount);
  const currentSoulDocs = routedDocs.filter((item) => item.route === 'soul').length;
  if (currentSoulDocs >= targetSoulDocs) return 0;

  const promotable = routedDocs
    .filter((item) =>
      item.route === 'memory' &&
      item.score >= 0.42 &&
      item.score_breakdown.attribution_score >= 0.5 &&
      item.score_breakdown.clarity_score >= 0.4 &&
      canSceneShapeSoul(readEvidenceMetadata(item.doc))
    )
    .sort((a, b) => b.score - a.score);

  let promoted = 0;
  for (const item of promotable) {
    if (currentSoulDocs + promoted >= targetSoulDocs) break;
    item.route = 'soul';
    item.decision_reason = 'promoted from memory to soul to preserve minimum soul coverage for training';
    item.decision_flags = Array.from(new Set([...item.decision_flags, 'promoted_to_soul']));
    promoted++;
  }
  return promoted;
}

function desiredSoulDocCount(cleanDocCount: number): number {
  if (cleanDocCount <= 4) return Math.min(cleanDocCount, 2);
  if (cleanDocCount <= 12) return Math.min(cleanDocCount, 3);
  if (cleanDocCount <= 40) return Math.min(cleanDocCount, Math.max(4, Math.ceil(cleanDocCount * 0.18)));
  return Math.min(cleanDocCount, Math.max(6, Math.ceil(cleanDocCount * 0.12)));
}

export const __evidenceRoutingTestables = {
  deriveCorpusRoutingHints,
  scoreAttribution,
  scoreStability,
  scoreClarity,
  looksEphemeral,
  shouldKeepAsMemoryInLargeCorpus,
  qualifiesAsShortFormSoulSignal,
  desiredSoulDocCount,
};

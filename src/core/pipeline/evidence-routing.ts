import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { RawDocument, SemanticChunk } from '../models/memory.js';
import { DataCleaner, SemanticChunker } from './cleaner.js';

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
        filtered_low_quality_docs: Math.max(0, docs.length - cleanDocs.length),
      },
    };
  }

  const targetSignals = (options.targetSignals ?? []).map(normalizeSignal).filter(Boolean);
  const routedDocs = cleanDocs.map((doc) => scoreDocument(doc, targetSignals));
  const soulDocs = routedDocs.filter((item) => item.route === 'soul').map((item) => item.doc);
  const memoryDocs = routedDocs.filter((item) => item.route === 'memory').map((item) => item.doc);
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
      filtered_low_quality_docs: Math.max(0, docs.length - cleanDocs.length) + discardDocs.length,
    },
  };
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
  report: {
    strategy: InputRoutingStrategy;
    generated_at: string;
    observability: InputRoutingObservability;
    routed_docs: Array<Pick<RoutedDocument, 'route' | 'score' | 'decision_reason' | 'decision_flags'>>;
  }
): void {
  writeFileSync(join(personaDir, `input-routing-${report.strategy}.json`), JSON.stringify(report, null, 2), 'utf-8');
}

function scoreDocument(doc: RawDocument, targetSignals: string[]): RoutedDocument {
  const normalizedContent = doc.content.trim().replace(/\s+/g, ' ');
  const attribution = scoreAttribution(doc, targetSignals);
  const stability = scoreStability(doc, normalizedContent);
  const clarity = scoreClarity(normalizedContent);
  const score = clamp(attribution * 0.4 + stability * 0.35 + clarity * 0.25);
  const flags: string[] = [];

  if (attribution >= 0.8) flags.push('first_party');
  if (stability >= 0.75) flags.push('stable_signal');
  if (clarity < 0.45) flags.push('low_context');
  if (!doc.published_at) flags.push('time_unknown');
  if ((doc.author ?? '').toLowerCase() === 'unknown') flags.push('author_unknown');

  if (clarity < 0.35 || normalizedContent.length < 40) {
    return buildRoutedDoc(doc, 'discard', score, 'discarded for low clarity or insufficient context', flags, attribution, stability, clarity);
  }

  const canShapeSoul =
    attribution >= 0.62 &&
    stability >= 0.6 &&
    clarity >= 0.55 &&
    normalizedContent.length >= 140 &&
    !looksEphemeral(normalizedContent);

  if (canShapeSoul && score >= 0.68) {
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

function scoreAttribution(doc: RawDocument, targetSignals: string[]): number {
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

function scoreStability(doc: RawDocument, content: string): number {
  let score = 0.35;
  if (doc.published_at) score += 0.2;
  if (content.length >= 280) score += 0.2;
  if (doc.source_type === 'article' || doc.source_type === 'twitter') score += 0.15;
  if (/\b(always|never|believe|value|principle|because|should)\b/i.test(content)) score += 0.1;
  return clamp(score);
}

function scoreClarity(content: string): number {
  const weirdCharPenalty = (content.match(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu) ?? []).length / Math.max(1, content.length);
  let score = content.length >= 120 ? 0.7 : content.length >= 60 ? 0.55 : 0.35;
  if (/[.?!。！？]/.test(content)) score += 0.1;
  if (content.split(/\s+/).length >= 12) score += 0.1;
  score -= weirdCharPenalty * 3;
  return clamp(score);
}

function looksEphemeral(content: string): boolean {
  return /\b(today|tonight|this week|just now|lol|lmao|omg)\b/i.test(content);
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

export const __evidenceRoutingTestables = {
  scoreAttribution,
  scoreStability,
  scoreClarity,
  looksEphemeral,
};

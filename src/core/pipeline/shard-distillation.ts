import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RawDocument, SemanticChunk } from '../models/memory.js';
import {
  InputRoutingObservability,
  InputRoutingStrategy,
  RoutedEvidenceResult,
  routeEvidenceDocuments,
} from './evidence-routing.js';
import { CorpusShardPlan, CorpusShardPlanItem, materializeShardDocs } from './corpus-plan.js';
import { selectSoulChunksForStrategy, TrainingStrategyDecision } from '../training/strategy-resolver.js';

export interface ShardSoulSignal {
  document_id: string;
  chunk_id: string;
  score: number;
  excerpt: string;
  keywords: string[];
  phrases: string[];
}

export interface ShardSoulSummary {
  schema_version: 1;
  generated_at: string;
  shard_id: string;
  strategy: InputRoutingStrategy;
  raw_doc_count: number;
  clean_doc_count: number;
  chunk_count: number;
  selected_soul_chunk_count: number;
  doc_ids: string[];
  top_keywords: string[];
  top_phrases: string[];
  top_signals: ShardSoulSignal[];
}

export interface ShardMemorySummary {
  schema_version: 1;
  generated_at: string;
  shard_id: string;
  strategy: InputRoutingStrategy;
  memory_doc_count: number;
  discard_doc_count: number;
  memory_doc_ids: string[];
  top_keywords: string[];
  context_examples: Array<{
    document_id: string;
    score: number;
    excerpt: string;
    keywords: string[];
  }>;
}

export interface ShardObservabilityReport {
  schema_version: 1;
  generated_at: string;
  shard_id: string;
  strategy: InputRoutingStrategy;
  observability: InputRoutingObservability;
}

export interface ShardDistillationResult {
  shard: CorpusShardPlanItem;
  routing: RoutedEvidenceResult;
  soulSummary: ShardSoulSummary;
  memorySummary: ShardMemorySummary;
  observabilityReport: ShardObservabilityReport;
}

export function distillShardDocs(
  shard: CorpusShardPlanItem,
  docs: RawDocument[],
  options: {
    strategy?: InputRoutingStrategy;
    targetSignals?: string[];
    strategyDecision?: Pick<TrainingStrategyDecision, 'optimizationMode' | 'prioritizeTopSoulChunks' | 'maxSoulChunks'>;
  } = {}
): ShardDistillationResult {
  const strategy = options.strategy ?? 'legacy';
  const routing = routeEvidenceDocuments(docs, {
    strategy,
    targetSignals: options.targetSignals,
  });

  const selectionDecision = options.strategyDecision ?? {
    optimizationMode: 'combined',
    prioritizeTopSoulChunks: true,
    maxSoulChunks: 12,
  };
  const boundedMaxSoulChunks = Math.max(1, Math.min(selectionDecision.maxSoulChunks, 12));
  const selectedSoulChunks = selectSoulChunksForStrategy(
    routing.soulChunks,
    routing.routedDocs.map((item) => ({ document_id: item.doc.id, score: item.score })),
    selectionDecision,
    boundedMaxSoulChunks
  );

  return {
    shard,
    routing,
    soulSummary: buildShardSoulSummary(shard, strategy, routing, selectedSoulChunks),
    memorySummary: buildShardMemorySummary(shard, strategy, routing),
    observabilityReport: {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      shard_id: shard.shard_id,
      strategy,
      observability: routing.observability,
    },
  };
}

export function distillCorpusShards(
  docs: RawDocument[],
  shardPlan: CorpusShardPlan,
  options: {
    strategy?: InputRoutingStrategy;
    targetSignals?: string[];
    strategyDecision?: Pick<TrainingStrategyDecision, 'optimizationMode' | 'prioritizeTopSoulChunks' | 'maxSoulChunks'>;
  } = {}
): ShardDistillationResult[] {
  const materialized = materializeShardDocs(docs, shardPlan);
  return materialized.map((item) =>
    distillShardDocs(item.shard, item.docs, {
      strategy: options.strategy,
      targetSignals: options.targetSignals,
      strategyDecision: options.strategyDecision,
    })
  );
}

export function writeShardDistillationAssets(
  personaDir: string,
  results: ShardDistillationResult[]
): void {
  const shardsDir = join(personaDir, 'shards');
  mkdirSync(shardsDir, { recursive: true });

  for (const result of results) {
    const dir = join(shardsDir, result.shard.shard_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'shard-soul-summary.json'), JSON.stringify(result.soulSummary, null, 2), 'utf-8');
    writeFileSync(join(dir, 'shard-memory-summary.json'), JSON.stringify(result.memorySummary, null, 2), 'utf-8');
    writeFileSync(join(dir, 'shard-observability.json'), JSON.stringify(result.observabilityReport, null, 2), 'utf-8');
  }
}

function buildShardSoulSummary(
  shard: CorpusShardPlanItem,
  strategy: InputRoutingStrategy,
  routing: RoutedEvidenceResult,
  selectedSoulChunks: SemanticChunk[]
): ShardSoulSummary {
  const scoreMap = new Map(routing.routedDocs.map((item) => [item.doc.id, item.score]));
  const topSignals = selectedSoulChunks.map((chunk) => ({
    document_id: chunk.document_id,
    chunk_id: chunk.id,
    score: scoreMap.get(chunk.document_id) ?? 0,
    excerpt: clipText(chunk.content, 220),
    keywords: extractKeywords(chunk.content, 5),
    phrases: extractPhrases(chunk.content, 4),
  }));

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    shard_id: shard.shard_id,
    strategy,
    raw_doc_count: shard.raw_doc_count,
    clean_doc_count: routing.cleanDocs.length,
    chunk_count: routing.chunks.length,
    selected_soul_chunk_count: selectedSoulChunks.length,
    doc_ids: routing.soulDocs.map((doc) => doc.id),
    top_keywords: collectTopKeywords(selectedSoulChunks.map((chunk) => chunk.content), 12),
    top_phrases: collectTopPhrases(selectedSoulChunks.map((chunk) => chunk.content), 12),
    top_signals: topSignals,
  };
}

function buildShardMemorySummary(
  shard: CorpusShardPlanItem,
  strategy: InputRoutingStrategy,
  routing: RoutedEvidenceResult
): ShardMemorySummary {
  const memoryScored = routing.routedDocs
    .filter((item) => item.route === 'memory')
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    shard_id: shard.shard_id,
    strategy,
    memory_doc_count: routing.memoryDocs.length,
    discard_doc_count: routing.discardDocs.length,
    memory_doc_ids: routing.memoryDocs.map((doc) => doc.id),
    top_keywords: collectTopKeywords(routing.memoryDocs.map((doc) => doc.content), 10),
    context_examples: memoryScored.map((item) => ({
      document_id: item.doc.id,
      score: item.score,
      excerpt: clipText(item.doc.content, 200),
      keywords: extractKeywords(item.doc.content, 5),
    })),
  };
}

function collectTopKeywords(texts: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const keyword of extractKeywords(text, limit * 2)) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

function collectTopPhrases(texts: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const phrase of extractPhrases(text, limit * 2)) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([phrase]) => phrase);
}

function extractKeywords(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const normalized of tokenizeTerms(text)) {
    if (!normalized || shouldSkipKeyword(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function extractPhrases(text: string, limit: number): string[] {
  const terms = tokenizeTerms(text).filter((term) => !shouldSkipKeyword(term));
  const counts = new Map<string, number>();

  for (let start = 0; start < terms.length; start++) {
    for (let size = 2; size <= 4; size++) {
      const slice = terms.slice(start, start + size);
      if (slice.length !== size) continue;
      if (slice.some((term) => shouldSkipKeyword(term))) continue;
      const phrase = slice.join(' ');
      if (phrase.length < 9) continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => {
      const scoreA = phraseScore(a[0], a[1]);
      const scoreB = phraseScore(b[0], b[1]);
      return scoreB - scoreA || a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([phrase]) => phrase);
}

function clipText(text: string, maxLength: number): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function shouldSkipKeyword(token: string): boolean {
  if (STOPWORDS.has(token)) return true;
  if (/^\d+$/.test(token)) return true;
  if (/^\d{4}$/.test(token)) return true;
  if (/^[a-z]+$/.test(token) && token.length < 4 && !SHORT_DOMAIN_TERMS.has(token)) return true;
  return false;
}

function tokenizeTerms(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .match(/[\p{Script=Han}]{2,}|[\p{Letter}\p{Number}_-]{3,}/gu) ?? [];

  return tokens
    .map((token) => normalizeTerm(token.trim()))
    .filter(Boolean);
}

function normalizeTerm(token: string): string {
  if (!token) return '';
  if (/^\d+$/.test(token)) return token;
  if (SHORT_DOMAIN_TERMS.has(token)) return token;
  if (/^[a-z]+s$/i.test(token) && token.length > 4 && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

function phraseScore(phrase: string, count: number): number {
  const tokens = phrase.split(' ');
  let score = count * 3 + tokens.length;
  if (tokens.some((token) => SHORT_DOMAIN_TERMS.has(token))) score += 2;
  if (tokens.some((token) => DOMAIN_TERMS.has(token))) score += 1.5;
  return score;
}

const STOPWORDS = new Set([
  'able',
  'about',
  'across',
  'afterward',
  'again',
  'against',
  'almost',
  'after',
  'also',
  'always',
  'among',
  'around',
  'because',
  'been',
  'before',
  'being',
  'between',
  'both',
  'came',
  'come',
  'could',
  'does',
  'doing',
  'done',
  'dont',
  'down',
  'each',
  'else',
  'ever',
  'every',
  'from',
  'good',
  'great',
  'from',
  'have',
  'into',
  'just',
  'keep',
  'kind',
  'less',
  'lets',
  'like',
  'look',
  'lot',
  'made',
  'make',
  'many',
  'maybe',
  'more',
  'most',
  'much',
  'must',
  'need',
  'only',
  'other',
  'ours',
  'over',
  'part',
  'really',
  'same',
  'should',
  'since',
  'some',
  'still',
  'such',
  'take',
  'into',
  'that',
  'than',
  'their',
  'them',
  'then',
  'there',
  'they',
  'this',
  'those',
  'through',
  'today',
  'under',
  'very',
  'want',
  'well',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'would',
  'yeah',
  'year',
  'years',
  'your',
  'youre',
  'youve',
  'yourself',
  'the',
  'and',
  'for',
  'but',
  'all',
  'you',
  'are',
  'can',
  'has',
  'had',
  'her',
  'his',
  'its',
  'our',
  'out',
  'too',
  'use',
  'using',
  'bit',
  'actually',
  'back',
  'here',
  'http',
  'https',
]);

const SHORT_DOMAIN_TERMS = new Set([
  'agi',
  'api',
  'cpu',
  'gpu',
  'gui',
  'llm',
  'rag',
  'sdk',
  'sql',
  'ui',
  'ux',
]);

const DOMAIN_TERMS = new Set([
  'agent',
  'attention',
  'benchmark',
  'chatgpt',
  'conversation',
  'data',
  'engineering',
  'evaluation',
  'feedback',
  'human',
  'intelligence',
  'iteration',
  'library',
  'model',
  'post-train',
  'practical',
  'privacy',
  'prompt',
  'reasoning',
  'research',
  'runtime',
  'supervision',
  'system',
  'team',
  'tooling',
  'training',
]);

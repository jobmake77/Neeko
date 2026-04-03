import type { InputRoutingObservability, InputRoutingStrategy } from '../pipeline/evidence-routing.js';
import { TrainingRuntimePreset, resolveTrainingRuntimePreset } from './runtime-tuning.js';
import type { ProviderName } from '../../config/model.js';

export type TrainingOptimizationMode = 'baseline' | 'evaluator' | 'extractor' | 'combined';
export type TrainingOptimizationModeInput = TrainingOptimizationMode | 'auto';
export type TrainingCorpusSegment = 'unknown' | 'small' | 'medium' | 'large';

export interface TrainingStrategyDecision {
  runtimePreset: TrainingRuntimePreset;
  optimizationMode: TrainingOptimizationMode;
  evaluatorLayered: boolean;
  extractorCacheEnabled: boolean;
  prioritizeTopSoulChunks: boolean;
  maxSoulChunks: number;
  extractionConcurrency: number;
  extractionTimeoutMs: number;
  extractionRetries: number;
  corpusSegment: TrainingCorpusSegment;
  corpusScale: number;
  reason: string;
}

const SMALL_CORPUS_MAX = 120;
const MEDIUM_CORPUS_MAX = 400;

export function normalizeOptimizationMode(raw?: string, fallback: TrainingOptimizationModeInput = 'auto'): TrainingOptimizationModeInput {
  const value = String(raw ?? fallback).toLowerCase();
  if (value === 'baseline' || value === 'evaluator' || value === 'extractor' || value === 'combined') return value;
  return 'auto';
}

export function resolveTrainingStrategy(options: {
  inputRoutingStrategy?: InputRoutingStrategy;
  observability?: Partial<InputRoutingObservability> | null;
  rawDocCount?: number;
  explicitRuntimePreset?: string;
  explicitOptimizationMode?: string;
  providerName?: ProviderName | string;
} = {}): TrainingStrategyDecision {
  const corpusScale = resolveCorpusScale(options.observability, options.rawDocCount);
  const corpusSegment = classifyCorpusSegment(corpusScale);
  const inputRoutingStrategy = options.inputRoutingStrategy ?? 'legacy';
  const providerName = normalizeProviderName(options.providerName);
  const manualPreset = options.explicitRuntimePreset
    ? resolveTrainingRuntimePreset(options.explicitRuntimePreset)
    : null;
  const requestedMode = normalizeOptimizationMode(options.explicitOptimizationMode, 'auto');

  if (manualPreset || requestedMode !== 'auto') {
    return buildDecision(
      manualPreset ?? inferRuntimePreset(inputRoutingStrategy, corpusSegment),
      requestedMode === 'auto' ? inferOptimizationMode(inputRoutingStrategy, corpusSegment) : requestedMode,
      corpusSegment,
      corpusScale,
      'manual override applied on top of corpus-aware strategy resolution',
      providerName
    );
  }

  const preset = inferRuntimePreset(inputRoutingStrategy, corpusSegment);
  const optimizationMode = inferOptimizationMode(inputRoutingStrategy, corpusSegment);
  const reason = buildReason(inputRoutingStrategy, corpusSegment, corpusScale, optimizationMode);
  return buildDecision(preset, optimizationMode, corpusSegment, corpusScale, reason, providerName);
}

export function selectSoulChunksForStrategy<T extends { document_id: string }>(
  soulChunks: T[],
  docScores: Array<{ document_id: string; score: number }>,
  decision: Pick<TrainingStrategyDecision, 'optimizationMode' | 'prioritizeTopSoulChunks'>,
  limit: number
): T[] {
  const boundedLimit = Math.max(0, Math.min(limit, soulChunks.length));
  if (boundedLimit === 0) return [];
  if (!decision.prioritizeTopSoulChunks) {
    return soulChunks.slice(0, boundedLimit);
  }

  const scoreMap = new Map(docScores.map((item) => [item.document_id, item.score]));
  return soulChunks
    .map((chunk, index) => ({
      chunk,
      index,
      score: scoreMap.get(chunk.document_id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, boundedLimit)
    .map((item) => item.chunk);
}

function resolveCorpusScale(
  observability?: Partial<InputRoutingObservability> | null,
  rawDocCount?: number
): number {
  if (typeof observability?.clean_docs === 'number' && observability.clean_docs > 0) return observability.clean_docs;
  if (typeof observability?.raw_docs === 'number' && observability.raw_docs > 0) return observability.raw_docs;
  return Math.max(0, rawDocCount ?? 0);
}

function classifyCorpusSegment(corpusScale: number): TrainingCorpusSegment {
  if (corpusScale <= 0) return 'unknown';
  if (corpusScale <= SMALL_CORPUS_MAX) return 'small';
  if (corpusScale <= MEDIUM_CORPUS_MAX) return 'medium';
  return 'large';
}

function inferRuntimePreset(
  inputRoutingStrategy: InputRoutingStrategy,
  corpusSegment: TrainingCorpusSegment
): TrainingRuntimePreset {
  if (inputRoutingStrategy === 'legacy' && corpusSegment === 'unknown') return 'balanced';
  return 'robust';
}

function inferOptimizationMode(
  inputRoutingStrategy: InputRoutingStrategy,
  corpusSegment: TrainingCorpusSegment
): TrainingOptimizationMode {
  if (inputRoutingStrategy !== 'v2') return 'baseline';
  if (corpusSegment === 'large') return 'combined';
  return 'baseline';
}

function buildReason(
  inputRoutingStrategy: InputRoutingStrategy,
  corpusSegment: TrainingCorpusSegment,
  corpusScale: number,
  optimizationMode: TrainingOptimizationMode
): string {
  if (inputRoutingStrategy !== 'v2') {
    return `legacy routing keeps the conservative baseline optimization path for ${corpusSegment} corpus (${corpusScale} docs)`;
  }
  if (corpusSegment === 'large') {
    return `v2 routing detected a large corpus (${corpusScale} docs), so it enables combined optimization to stabilize extraction and evaluation at scale`;
  }
  return `v2 routing detected a ${corpusSegment} corpus (${corpusScale} docs), so it keeps the baseline optimization path to avoid over-optimizing medium/small runs`;
}

function buildDecision(
  runtimePreset: TrainingRuntimePreset,
  optimizationMode: TrainingOptimizationMode,
  corpusSegment: TrainingCorpusSegment,
  corpusScale: number,
  reason: string,
  providerName?: ProviderName
): TrainingStrategyDecision {
  const kimiTightMode = providerName === 'kimi' && (corpusSegment === 'medium' || corpusSegment === 'large');
  const extractionConcurrency = kimiTightMode
    ? 1
    : optimizationMode === 'combined' || corpusSegment === 'large'
      ? 1
      : 2;
  const extractionRetries = kimiTightMode
    ? 0
    : optimizationMode === 'combined' || runtimePreset === 'robust'
      ? 2
      : 0;
  const extractionTimeoutMs = kimiTightMode
    ? 20_000
    : optimizationMode === 'combined' || corpusSegment === 'large' || runtimePreset === 'robust'
      ? 28_000
      : 24_000;
  const prioritizeTopSoulChunks =
    kimiTightMode ||
    optimizationMode === 'extractor' ||
    optimizationMode === 'combined';
  const maxSoulChunks = kimiTightMode
    ? corpusSegment === 'large' ? 6 : 8
    : corpusSegment === 'large'
      ? 18
      : 30;
  return {
    runtimePreset,
    optimizationMode,
    evaluatorLayered: optimizationMode === 'evaluator' || optimizationMode === 'combined',
    extractorCacheEnabled: true,
    prioritizeTopSoulChunks,
    maxSoulChunks,
    extractionConcurrency,
    extractionTimeoutMs,
    extractionRetries,
    corpusSegment,
    corpusScale,
    reason,
  };
}

export function estimateExtractionStageTimeoutMs(
  decision: Pick<TrainingStrategyDecision, 'extractionConcurrency' | 'extractionRetries' | 'extractionTimeoutMs'>,
  chunkCount: number,
  ceilingMs: number
): number {
  const safeChunkCount = Math.max(0, chunkCount);
  const safeConcurrency = Math.max(1, decision.extractionConcurrency);
  const batches = Math.max(1, Math.ceil(safeChunkCount / safeConcurrency));
  const attemptsPerChunk = Math.max(1, decision.extractionRetries + 1);
  const retryBackoffBudget = Math.max(0, decision.extractionRetries) * 1_200;
  const estimated =
    batches * (decision.extractionTimeoutMs * attemptsPerChunk + retryBackoffBudget) +
    Math.max(8_000, safeChunkCount * 1_000);
  return Math.max(30_000, Math.min(ceilingMs, estimated));
}

function normalizeProviderName(raw?: string): ProviderName | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'claude' || value === 'openai' || value === 'kimi' || value === 'gemini' || value === 'deepseek') {
    return value;
  }
  return undefined;
}

export const __trainingStrategyTestables = {
  SMALL_CORPUS_MAX,
  MEDIUM_CORPUS_MAX,
  classifyCorpusSegment,
  normalizeProviderName,
};

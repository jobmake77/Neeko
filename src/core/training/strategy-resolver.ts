import type { InputRoutingObservability, InputRoutingStrategy } from '../pipeline/evidence-routing.js';
import {
  TrainingRuntimeOverrides,
  TrainingRuntimePreset,
  resolveTrainingRuntimePreset,
} from './runtime-tuning.js';
import type { ProviderName } from '../../config/model.js';

export type TrainingOptimizationMode = 'baseline' | 'evaluator' | 'extractor' | 'combined';
export type TrainingOptimizationModeInput = TrainingOptimizationMode | 'auto';
export type TrainingCorpusSegment = 'unknown' | 'small' | 'medium' | 'large';
export type KimiStabilityMode = 'standard' | 'tight_runtime' | 'sparse_director' | 'hybrid';
export type KimiStabilityModeInput = KimiStabilityMode | 'auto';
export type CorpusShape = 'unknown' | 'dense_noisy_stream' | 'high_signal_archive' | 'balanced_mixed';

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

export interface KimiStabilityDecision {
  mode: KimiStabilityMode;
  runtimePreset: TrainingRuntimePreset;
  runtimeOverrides?: TrainingRuntimeOverrides;
  evaluatorLayered?: boolean;
  evaluatorDualReview?: boolean;
  directorReviewInterval: number;
  directorAlwaysOnFinalRound: boolean;
  reason: string;
}

export interface TrainingExecutionSettings {
  runtimePreset: TrainingRuntimePreset;
  runtimeOverrides?: TrainingRuntimeOverrides;
  evaluatorLayered: boolean;
  evaluatorDualReview?: boolean;
  directorReviewInterval: number;
  directorAlwaysOnFinalRound: boolean;
  kimiStabilityMode: KimiStabilityMode;
  kimiStabilityReason: string;
}

export interface InputRoutingRecommendation {
  recommendedStrategy: InputRoutingStrategy;
  shape: CorpusShape;
  confidence: number;
  reason: string;
  metrics: {
    legacyChunkLoad: number;
    v2ChunkLoad: number;
    v2SoulRetention: number;
    v2MemoryRetention: number;
    v2DiscardRatio: number;
    v2ChunkCompression: number;
  };
}

const SMALL_CORPUS_MAX = 120;
const MEDIUM_CORPUS_MAX = 400;

export function normalizeOptimizationMode(raw?: string, fallback: TrainingOptimizationModeInput = 'auto'): TrainingOptimizationModeInput {
  const value = String(raw ?? fallback).toLowerCase();
  if (value === 'baseline' || value === 'evaluator' || value === 'extractor' || value === 'combined') return value;
  return 'auto';
}

export function normalizeKimiStabilityMode(
  raw?: string,
  fallback: KimiStabilityModeInput = 'auto'
): KimiStabilityModeInput {
  const value = String(raw ?? fallback).toLowerCase();
  if (value === 'standard' || value === 'tight_runtime' || value === 'sparse_director' || value === 'hybrid') {
    return value;
  }
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

export function resolveKimiStabilityDecision(options: {
  baseDecision: Pick<TrainingStrategyDecision, 'runtimePreset' | 'evaluatorLayered' | 'corpusSegment'>;
  providerName?: ProviderName | string;
  rounds?: number;
  explicitMode?: string;
}): KimiStabilityDecision {
  const providerName = normalizeProviderName(options.providerName);
  const requestedMode = normalizeKimiStabilityMode(options.explicitMode, 'auto');
  const mode =
    requestedMode === 'auto'
      ? 'standard'
      : requestedMode;

  if (providerName !== 'kimi') {
    return {
      mode: 'standard',
      runtimePreset: options.baseDecision.runtimePreset,
      evaluatorLayered: options.baseDecision.evaluatorLayered,
      directorReviewInterval: 1,
      directorAlwaysOnFinalRound: true,
      reason: 'non-kimi provider keeps standard training cadence',
    };
  }

  const tightRuntimeOverrides = buildTightRuntimeOverrides(options.baseDecision.runtimePreset);

  if (mode === 'tight_runtime') {
    return {
      mode,
      runtimePreset: options.baseDecision.runtimePreset,
      runtimeOverrides: tightRuntimeOverrides,
      evaluatorLayered: true,
      evaluatorDualReview: false,
      directorReviewInterval: 1,
      directorAlwaysOnFinalRound: true,
      reason: 'tight_runtime trims prompt budgets and disables evaluator dual-review to reduce Kimi second-round latency',
    };
  }

  if (mode === 'sparse_director') {
    return {
      mode,
      runtimePreset: options.baseDecision.runtimePreset,
      runtimeOverrides: {
        directorCompactPrompt: true,
        directorTimeoutMs: Math.min(20_000, getSafeTimeout(tightRuntimeOverrides.directorTimeoutMs)),
      },
      evaluatorLayered: options.baseDecision.evaluatorLayered,
      directorReviewInterval: Math.max(2, options.rounds ?? 2),
      directorAlwaysOnFinalRound: true,
      reason: 'sparse_director keeps normal training quality but only runs a full director review on the final round',
    };
  }

  if (mode === 'hybrid') {
    return {
      mode,
      runtimePreset: options.baseDecision.runtimePreset,
      runtimeOverrides: tightRuntimeOverrides,
      evaluatorLayered: true,
      evaluatorDualReview: false,
      directorReviewInterval: Math.max(2, options.rounds ?? 2),
      directorAlwaysOnFinalRound: true,
      reason: 'hybrid combines tighter runtime budgets with sparse director cadence for Kimi-heavy second-round runs',
    };
  }

  return {
    mode: 'standard',
    runtimePreset: options.baseDecision.runtimePreset,
    evaluatorLayered: options.baseDecision.evaluatorLayered,
    directorReviewInterval: 1,
    directorAlwaysOnFinalRound: true,
    reason: 'standard keeps the existing Kimi training cadence for comparison',
  };
}

export function resolveTrainingExecutionSettings(options: {
  strategyDecision?: Pick<TrainingStrategyDecision, 'runtimePreset' | 'evaluatorLayered' | 'corpusSegment'>;
  providerName?: ProviderName | string;
  rounds?: number;
  explicitKimiStabilityMode?: string;
} = {}): TrainingExecutionSettings {
  const stability = resolveKimiStabilityDecision({
    baseDecision: options.strategyDecision ?? {
      runtimePreset: 'balanced',
      evaluatorLayered: false,
      corpusSegment: 'unknown',
    },
    providerName: options.providerName,
    rounds: options.rounds,
    explicitMode: options.explicitKimiStabilityMode,
  });

  return {
    runtimePreset: stability.runtimePreset,
    runtimeOverrides: stability.runtimeOverrides,
    evaluatorLayered: stability.evaluatorLayered ?? options.strategyDecision?.evaluatorLayered ?? false,
    evaluatorDualReview: stability.evaluatorDualReview,
    directorReviewInterval: stability.directorReviewInterval,
    directorAlwaysOnFinalRound: stability.directorAlwaysOnFinalRound,
    kimiStabilityMode: stability.mode,
    kimiStabilityReason: stability.reason,
  };
}

export function recommendInputRoutingStrategy(options: {
  legacyObservability?: Partial<InputRoutingObservability> | null;
  v2Observability?: Partial<InputRoutingObservability> | null;
}): InputRoutingRecommendation {
  const corpusScale = Math.max(
    0,
    options.v2Observability?.clean_docs ??
      options.v2Observability?.raw_docs ??
      options.legacyObservability?.clean_docs ??
      0
  );
  const legacyCleanDocs = Math.max(0, options.legacyObservability?.clean_docs ?? options.v2Observability?.clean_docs ?? 0);
  const legacyChunkLoad = safeRatio(options.legacyObservability?.chunks, legacyCleanDocs);
  const v2CleanDocs = Math.max(0, options.v2Observability?.clean_docs ?? legacyCleanDocs);
  const v2ChunkLoad = safeRatio(options.v2Observability?.chunks, v2CleanDocs);
  const v2SoulRetention = safeRatio(options.v2Observability?.soul_docs, v2CleanDocs);
  const v2MemoryRetention = safeRatio(options.v2Observability?.memory_docs, v2CleanDocs);
  const v2DiscardRatio = safeRatio(options.v2Observability?.discard_docs, options.v2Observability?.raw_docs ?? v2CleanDocs);
  const v2ChunkCompression = safeRatio(v2ChunkLoad, legacyChunkLoad || 1);

  if (v2CleanDocs === 0 || legacyCleanDocs === 0) {
    return {
      recommendedStrategy: 'legacy',
      shape: 'unknown',
      confidence: 0.25,
      reason: 'insufficient routing observability, keeping the conservative legacy default',
      metrics: {
        legacyChunkLoad,
        v2ChunkLoad,
        v2SoulRetention,
        v2MemoryRetention,
        v2DiscardRatio,
        v2ChunkCompression,
      },
    };
  }

  if (v2SoulRetention <= 0.35 && v2DiscardRatio >= 0.5 && v2ChunkCompression <= 0.7) {
    return {
      recommendedStrategy: 'v2',
      shape: 'dense_noisy_stream',
      confidence: 0.86,
      reason: 'v2 is filtering a large amount of noisy material and sharply reducing chunk load, which matches a dense short-form stream',
      metrics: {
        legacyChunkLoad,
        v2ChunkLoad,
        v2SoulRetention,
        v2MemoryRetention,
        v2DiscardRatio,
        v2ChunkCompression,
      },
    };
  }

  if (v2SoulRetention >= 0.55 && v2DiscardRatio <= 0.25 && v2ChunkCompression >= 0.8) {
    const largeCorpusMixedLift =
      corpusScale >= 400 &&
      v2MemoryRetention >= 0.18 &&
      v2DiscardRatio >= 0.06 &&
      v2ChunkCompression <= 0.96;
    if (largeCorpusMixedLift) {
      return {
        recommendedStrategy: 'v2',
        shape: 'balanced_mixed',
        confidence: 0.74,
        reason: 'the corpus is large and still preserves a meaningful memory/discard layer under v2, so the extra routing structure is worth keeping at scale',
        metrics: {
          legacyChunkLoad,
          v2ChunkLoad,
          v2SoulRetention,
          v2MemoryRetention,
          v2DiscardRatio,
          v2ChunkCompression,
        },
      };
    }
    return {
      recommendedStrategy: 'legacy',
      shape: 'high_signal_archive',
      confidence: 0.8,
      reason: 'v2 is keeping most material anyway, so the corpus already looks high-signal and legacy is less likely to over-filter nuance',
      metrics: {
        legacyChunkLoad,
        v2ChunkLoad,
        v2SoulRetention,
        v2MemoryRetention,
        v2DiscardRatio,
        v2ChunkCompression,
      },
    };
  }

  const v2AdvantageScore =
    clamp((1 - v2SoulRetention) * 0.45 + v2DiscardRatio * 0.35 + (1 - v2ChunkCompression) * 0.2);
  const recommendV2 = v2AdvantageScore >= 0.5;
  return {
    recommendedStrategy: recommendV2 ? 'v2' : 'legacy',
    shape: 'balanced_mixed',
    confidence: Math.max(0.52, Math.abs(v2AdvantageScore - 0.5) + 0.5),
    reason: recommendV2
      ? 'the corpus looks mixed, but v2 still removes enough low-signal load to be worth keeping'
      : 'the corpus looks mixed, but the remaining signal does not justify the extra routing selectivity of v2',
    metrics: {
      legacyChunkLoad,
      v2ChunkLoad,
      v2SoulRetention,
      v2MemoryRetention,
      v2DiscardRatio,
      v2ChunkCompression,
    },
  };
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
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

function buildTightRuntimeOverrides(runtimePreset: TrainingRuntimePreset): TrainingRuntimeOverrides {
  if (runtimePreset === 'fast') return {};
  return {
    trainerTimeoutMs: 22_000,
    trainerRetries: 0,
    trainerCompactPrompt: true,
    personaMaxTokens: 280,
    personaTimeoutMs: 28_000,
    personaRetries: 1,
    personaCompactPrompt: true,
    personaMemoryLimit: 3,
    personaMemoryMaxChars: 700,
    directorTimeoutMs: 18_000,
    directorRetries: 0,
    directorCompactPrompt: true,
    evaluatorTimeoutMs: 22_000,
    evaluatorRetries: 1,
    evaluatorMaxResponseChars: 850,
    evaluatorCompactPrompt: true,
    evaluatorLayered: true,
  };
}

function getSafeTimeout(value?: number): number {
  return Math.max(1, value ?? 0);
}

function safeRatio(numerator?: number | null, denominator?: number | null): number {
  const top = Math.max(0, numerator ?? 0);
  const bottom = Math.max(0, denominator ?? 0);
  if (bottom <= 0) return 0;
  return top / bottom;
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
  buildTightRuntimeOverrides,
  normalizeProviderName,
  safeRatio,
};

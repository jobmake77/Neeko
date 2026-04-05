import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __trainingStrategyTestables,
  estimateExtractionStageTimeoutMs,
  normalizeKimiStabilityMode,
  normalizeOptimizationMode,
  recommendInputRoutingStrategy,
  resolveTrainingExecutionSettings,
  resolveKimiStabilityDecision,
  resolveTrainingStrategy,
  selectSoulChunksForStrategy,
} from '../dist/testing/training-strategy-test-entry.js';

test('normalizeOptimizationMode defaults to auto', () => {
  assert.equal(normalizeOptimizationMode(undefined), 'auto');
  assert.equal(normalizeOptimizationMode('combined'), 'combined');
  assert.equal(normalizeOptimizationMode('weird'), 'auto');
});

test('normalizeKimiStabilityMode defaults to auto', () => {
  assert.equal(normalizeKimiStabilityMode(undefined), 'auto');
  assert.equal(normalizeKimiStabilityMode('hybrid'), 'hybrid');
  assert.equal(normalizeKimiStabilityMode('weird'), 'auto');
});

test('resolver keeps legacy on baseline optimization path', () => {
  const decision = resolveTrainingStrategy({
    inputRoutingStrategy: 'legacy',
    observability: { raw_docs: 300, clean_docs: 280 },
  });
  assert.equal(decision.runtimePreset, 'robust');
  assert.equal(decision.optimizationMode, 'baseline');
  assert.equal(decision.corpusSegment, 'medium');
});

test('resolver applies segmented v2 strategy by corpus scale', () => {
  const medium = resolveTrainingStrategy({
    inputRoutingStrategy: 'v2',
    observability: { raw_docs: 317, clean_docs: 317 },
  });
  const large = resolveTrainingStrategy({
    inputRoutingStrategy: 'v2',
    observability: { raw_docs: 898, clean_docs: 898 },
  });

  assert.equal(medium.optimizationMode, 'baseline');
  assert.equal(medium.corpusSegment, 'medium');
  assert.equal(large.optimizationMode, 'combined');
  assert.equal(large.corpusSegment, 'large');
  assert.equal(__trainingStrategyTestables.classifyCorpusSegment(401), 'large');
});

test('resolver tightens extraction settings for kimi on medium corpora', () => {
  const decision = resolveTrainingStrategy({
    inputRoutingStrategy: 'v2',
    observability: { raw_docs: 122, clean_docs: 122 },
    providerName: 'kimi',
  });
  assert.equal(decision.corpusSegment, 'medium');
  assert.equal(decision.extractionConcurrency, 1);
  assert.equal(decision.extractionRetries, 0);
  assert.equal(decision.extractionTimeoutMs, 20000);
  assert.equal(decision.prioritizeTopSoulChunks, true);
  assert.equal(decision.maxSoulChunks, 8);
});

test('kimi stability resolver exposes multiple governance modes', () => {
  const baseDecision = {
    runtimePreset: 'robust',
    evaluatorLayered: true,
    corpusSegment: 'medium',
  };

  const tight = resolveKimiStabilityDecision({
    baseDecision,
    providerName: 'kimi',
    rounds: 2,
    explicitMode: 'tight_runtime',
  });
  const sparse = resolveKimiStabilityDecision({
    baseDecision,
    providerName: 'kimi',
    rounds: 2,
    explicitMode: 'sparse_director',
  });
  const hybrid = resolveKimiStabilityDecision({
    baseDecision,
    providerName: 'kimi',
    rounds: 2,
    explicitMode: 'hybrid',
  });

  assert.equal(tight.mode, 'tight_runtime');
  assert.equal(tight.evaluatorDualReview, false);
  assert.equal(tight.runtimeOverrides.evaluatorCompactPrompt, true);
  assert.equal(sparse.mode, 'sparse_director');
  assert.equal(sparse.directorReviewInterval, 2);
  assert.equal(hybrid.mode, 'hybrid');
  assert.equal(hybrid.evaluatorDualReview, false);
  assert.equal(hybrid.directorReviewInterval, 2);
});

test('non-kimi provider stays on standard stability mode', () => {
  const decision = resolveKimiStabilityDecision({
    baseDecision: {
      runtimePreset: 'robust',
      evaluatorLayered: true,
      corpusSegment: 'medium',
    },
    providerName: 'deepseek',
    rounds: 2,
    explicitMode: 'hybrid',
  });

  assert.equal(decision.mode, 'standard');
  assert.equal(decision.directorReviewInterval, 1);
});

test('training execution settings inherit hybrid governance for kimi', () => {
  const settings = resolveTrainingExecutionSettings({
    strategyDecision: {
      runtimePreset: 'robust',
      evaluatorLayered: true,
      corpusSegment: 'medium',
    },
    providerName: 'kimi',
    rounds: 2,
    explicitKimiStabilityMode: 'hybrid',
  });

  assert.equal(settings.kimiStabilityMode, 'hybrid');
  assert.equal(settings.runtimePreset, 'robust');
  assert.equal(settings.evaluatorLayered, true);
  assert.equal(settings.evaluatorDualReview, false);
  assert.equal(settings.directorReviewInterval, 2);
});

test('routing recommendation prefers v2 for dense noisy streams', () => {
  const recommendation = recommendInputRoutingStrategy({
    legacyObservability: {
      clean_docs: 223,
      chunks: 224,
    },
    v2Observability: {
      raw_docs: 337,
      clean_docs: 223,
      chunks: 119,
      soul_docs: 59,
      memory_docs: 59,
      discard_docs: 219,
    },
  });

  assert.equal(recommendation.recommendedStrategy, 'v2');
  assert.equal(recommendation.shape, 'dense_noisy_stream');
});

test('routing recommendation prefers legacy for high-signal archives', () => {
  const recommendation = recommendInputRoutingStrategy({
    legacyObservability: {
      clean_docs: 305,
      chunks: 318,
    },
    v2Observability: {
      raw_docs: 325,
      clean_docs: 305,
      chunks: 274,
      soul_docs: 193,
      memory_docs: 68,
      discard_docs: 64,
    },
  });

  assert.equal(recommendation.recommendedStrategy, 'legacy');
  assert.equal(recommendation.shape, 'high_signal_archive');
});

test('routing recommendation keeps v2 for large mixed corpora with meaningful memory layering', () => {
  const recommendation = recommendInputRoutingStrategy({
    legacyObservability: {
      clean_docs: 427,
      chunks: 430,
    },
    v2Observability: {
      raw_docs: 427,
      clean_docs: 427,
      chunks: 360,
      soul_docs: 296,
      memory_docs: 99,
      discard_docs: 32,
    },
  });

  assert.equal(recommendation.recommendedStrategy, 'v2');
  assert.equal(recommendation.shape, 'balanced_mixed');
});

test('routing recommendation keeps v2 for large corpora even when chunk compression is only modestly better', () => {
  const recommendation = recommendInputRoutingStrategy({
    legacyObservability: {
      clean_docs: 420,
      chunks: 445,
    },
    v2Observability: {
      raw_docs: 427,
      clean_docs: 420,
      chunks: 420,
      soul_docs: 296,
      memory_docs: 99,
      discard_docs: 32,
    },
  });

  assert.equal(recommendation.recommendedStrategy, 'v2');
  assert.equal(recommendation.shape, 'balanced_mixed');
});

test('manual overrides still win over auto resolution', () => {
  const decision = resolveTrainingStrategy({
    inputRoutingStrategy: 'v2',
    observability: { raw_docs: 50, clean_docs: 50 },
    explicitRuntimePreset: 'compact',
    explicitOptimizationMode: 'extractor',
  });
  assert.equal(decision.runtimePreset, 'compact');
  assert.equal(decision.optimizationMode, 'extractor');
  assert.equal(decision.extractorCacheEnabled, true);
  assert.equal(decision.prioritizeTopSoulChunks, true);
  assert.equal(decision.extractionConcurrency, 2);
  assert.equal(decision.extractionRetries, 0);
});

test('selectSoulChunksForStrategy prefers top scored chunks when enabled', () => {
  const chunks = [
    { document_id: 'a', content: 'a' },
    { document_id: 'b', content: 'b' },
    { document_id: 'c', content: 'c' },
  ];
  const selected = selectSoulChunksForStrategy(
    chunks,
    [
      { document_id: 'a', score: 0.2 },
      { document_id: 'b', score: 0.9 },
      { document_id: 'c', score: 0.6 },
    ],
    {
      optimizationMode: 'combined',
      prioritizeTopSoulChunks: true,
    },
    2
  );
  assert.deepEqual(selected.map((item) => item.document_id), ['b', 'c']);
});

test('estimateExtractionStageTimeoutMs scales with extraction workload', () => {
  const timeout = estimateExtractionStageTimeoutMs(
    {
      extractionConcurrency: 1,
      extractionRetries: 0,
      extractionTimeoutMs: 20000,
    },
    4,
    240000
  );
  assert.equal(timeout >= 88000, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __trainingStrategyTestables,
  estimateExtractionStageTimeoutMs,
  normalizeOptimizationMode,
  resolveTrainingStrategy,
  selectSoulChunksForStrategy,
} from '../dist/testing/training-strategy-test-entry.js';

test('normalizeOptimizationMode defaults to auto', () => {
  assert.equal(normalizeOptimizationMode(undefined), 'auto');
  assert.equal(normalizeOptimizationMode('combined'), 'combined');
  assert.equal(normalizeOptimizationMode('weird'), 'auto');
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

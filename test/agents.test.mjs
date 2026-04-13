import test from 'node:test';
import assert from 'node:assert/strict';
import { __agentsTestables } from '../dist/testing/agents-test-entry.js';

const {
  computeDirectorFallbackShouldContinue,
  estimateCoverageScore,
  stabilizeCoverageScore,
} = __agentsTestables;

test('estimateCoverageScore rewards question utilization and low-confidence coverage', () => {
  const score = estimateCoverageScore(
    { coverage_score: 0.1 },
    {
      questions_asked: 2,
      nodes_written: 1,
      nodes_reinforced: 1,
      avg_quality_score: 0.9,
      observability: {
        lowConfidenceCoverage: 1,
        contradictionRate: 0,
      },
    }
  );

  assert.equal(score > 0.5, true);
});

test('stabilizeCoverageScore limits single-round swings', () => {
  assert.equal(stabilizeCoverageScore(0.05, 0.2, 0.86), 0.25);
  assert.ok(Math.abs(stabilizeCoverageScore(0.4, 0.35, 0) - 0.245) < 1e-9);
});

test('shouldRetryProviderError identifies transient provider failures', () => {
  assert.equal(__agentsTestables.shouldRetryProviderError(new Error('503 Service Unavailable')), true);
  assert.equal(__agentsTestables.shouldRetryProviderError(new Error('rate limit exceeded')), true);
  assert.equal(__agentsTestables.shouldRetryProviderError(new Error('Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests')), true);
  assert.equal(__agentsTestables.shouldRetryProviderError(new Error('resource exhausted while generating transcript')), true);
  assert.equal(__agentsTestables.shouldRetryProviderError(new Error('schema mismatch')), false);
});

test('director fallback stays conservative before enough rounds accumulate', () => {
  assert.equal(computeDirectorFallbackShouldContinue(1, 0.92, 0), true);
  assert.equal(computeDirectorFallbackShouldContinue(2, 0.85, 0.01), true);
  assert.equal(computeDirectorFallbackShouldContinue(3, 0.92, 0), false);
  assert.equal(computeDirectorFallbackShouldContinue(3, 0.65, 0), true);
  assert.equal(computeDirectorFallbackShouldContinue(3, 0.92, 0.2), true);
});

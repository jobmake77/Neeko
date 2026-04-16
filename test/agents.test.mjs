import test from 'node:test';
import assert from 'node:assert/strict';
import { __agentsTestables } from '../dist/testing/agents-test-entry.js';

const {
  computeDirectorFallbackShouldContinue,
  extractFirstJsonObject,
  estimateCoverageScore,
  normalizeEvaluationCandidate,
  parseRelaxedEvaluationText,
  shouldAttemptRelaxedStructuredFallback,
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
  assert.equal(__agentsTestables.shouldRetryProviderError(new Error("You've reached your usage limit for this period.")), true);
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

test('relaxed evaluator parser extracts JSON payload from fenced output', () => {
  const raw = '```json\n{\"consistency_score\":0.81,\"authenticity_score\":0.72,\"depth_score\":0.65,\"overall_score\":0.74,\"verdict\":\"write\",\"insights\":[\"specific and grounded\"],\"new_memory_candidates\":[{\"summary\":\"Prefers shipping quickly\",\"category\":\"behavior\",\"soul_dimension\":\"behavioral_traits\",\"confidence\":0.7}]}\n```';
  const extracted = extractFirstJsonObject(raw);
  assert.equal(typeof extracted, 'string');
  const evaluation = parseRelaxedEvaluationText(raw, 'I ship fast when needed.', 'scenario');
  assert.equal(evaluation?.verdict, 'write');
  assert.equal(evaluation?.new_memory_candidates.length, 1);
});

test('normalizeEvaluationCandidate clamps loose values into evaluation schema', () => {
  const normalized = normalizeEvaluationCandidate({
    consistency_score: 1.4,
    authenticity_score: '0.62',
    depth_score: 0.58,
    verdict: 'reinforce',
    insights: ['Keeps focus on execution'],
    new_memory_candidates: [],
  }, 'I prefer execution over ceremony.', 'consistency');
  assert.equal(normalized?.consistency_score, 1);
  assert.equal(normalized?.verdict, 'reinforce');
});

test('relaxed structured fallback only triggers for schema-like failures', () => {
  assert.equal(shouldAttemptRelaxedStructuredFallback(new Error('AI_NoObjectGeneratedError: No object generated: response did not match schema.')), true);
  assert.equal(shouldAttemptRelaxedStructuredFallback(new Error('JSON mode failed to parse response')), true);
  assert.equal(shouldAttemptRelaxedStructuredFallback(new Error('503 Service Unavailable')), false);
});

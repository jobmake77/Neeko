import test from 'node:test';
import assert from 'node:assert/strict';
import { __agentsTestables } from '../dist/testing/agents-test-entry.js';

const { estimateCoverageScore, stabilizeCoverageScore } = __agentsTestables;

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

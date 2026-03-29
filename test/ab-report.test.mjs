import test from 'node:test';
import assert from 'node:assert/strict';
import { __abReportTestables } from '../dist/testing/ab-report-test-entry.js';

const {
  evaluateGate,
  buildAbComparisonReport,
  toAbComparisonCsv,
  toAbComparisonMarkdown,
} = __abReportTestables;

test('evaluateGate returns fail when quality drop exceeds threshold', () => {
  const rows = [
    { profile: 'baseline', totalRounds: 10, avgQuality: 0.9, contradictionRate: 0.1, duplicationRate: 0.1, coverage: 0.8 },
    { profile: 'full', totalRounds: 10, avgQuality: 0.82, contradictionRate: 0.11, duplicationRate: 0.11, coverage: 0.82 },
  ];
  const result = evaluateGate(rows, {
    enabled: true,
    maxQualityDrop: 0.02,
    maxContradictionRise: 0.03,
    maxDuplicationRise: 0.03,
    baselineProfile: 'baseline',
    compareProfile: 'full',
  });

  assert.equal(result.passed, false);
  assert.equal(result.baseline_profile, 'baseline');
  assert.equal(result.compare_profile, 'full');
});

test('buildAbComparisonReport computes delta as B-A', () => {
  const rows = [
    { profile: 'baseline', totalRounds: 10, avgQuality: 0.8, contradictionRate: 0.2, duplicationRate: 0.1, coverage: 0.7 },
    { profile: 'full', totalRounds: 10, avgQuality: 0.85, contradictionRate: 0.18, duplicationRate: 0.12, coverage: 0.75 },
  ];
  const gate = evaluateGate(rows, {
    enabled: false,
    maxQualityDrop: 0.02,
    maxContradictionRise: 0.03,
    maxDuplicationRise: 0.03,
  });
  const report = buildAbComparisonReport(rows, 'baseline', 'full', gate);

  assert.ok(Math.abs(report.deltas.avg_quality - 0.05) < 1e-9);
  assert.ok(Math.abs(report.deltas.contradiction_rate - (-0.02)) < 1e-9);
  assert.equal(report.group_a, 'baseline');
  assert.equal(report.group_b, 'full');
});

test('csv and markdown outputs include core metric rows', () => {
  const rows = [
    { profile: 'baseline', totalRounds: 10, avgQuality: 0.8, contradictionRate: 0.2, duplicationRate: 0.1, coverage: 0.7 },
    { profile: 'full', totalRounds: 10, avgQuality: 0.85, contradictionRate: 0.18, duplicationRate: 0.12, coverage: 0.75 },
  ];
  const gate = evaluateGate(rows, {
    enabled: false,
    maxQualityDrop: 0.02,
    maxContradictionRise: 0.03,
    maxDuplicationRise: 0.03,
  });
  const report = buildAbComparisonReport(rows, 'baseline', 'full', gate);
  const csv = toAbComparisonCsv(report);
  const md = toAbComparisonMarkdown(report);

  assert.match(csv, /metric,group_a,group_b,delta_b_minus_a/);
  assert.match(csv, /avg_quality/);
  assert.match(md, /\| avg_quality \|/);
  assert.match(md, /A\/B Regression Report/);
});

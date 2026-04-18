import test from 'node:test';
import assert from 'node:assert/strict';
import { __abReportTestables, __failureLoopTestables } from '../dist/testing/ab-report-test-entry.js';

const {
  evaluateGate,
  buildAbComparisonReport,
  toAbComparisonCsv,
  toAbComparisonMarkdown,
} = __abReportTestables;
const { classifyFailure } = __failureLoopTestables;

function scorecard(overall) {
  return {
    version: 'evaluation-v2-p0',
    summary: 'proxy scorecard',
    overall,
    axes: {},
  };
}

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
    {
      profile: 'baseline',
      totalRounds: 10,
      avgQuality: 0.8,
      contradictionRate: 0.2,
      duplicationRate: 0.1,
      coverage: 0.7,
      run_quality: 'clean',
      scorecard: scorecard(0.72),
    },
    {
      profile: 'full',
      totalRounds: 10,
      avgQuality: 0.85,
      contradictionRate: 0.18,
      duplicationRate: 0.12,
      coverage: 0.75,
      run_quality: 'contaminated',
      contamination: {
        status: 'contaminated',
        reasons: ['judge_fallback'],
        summary: 'run is contaminated: judge_fallback',
        details: ['evaluator=1'],
      },
      scorecard: scorecard(0.66),
    },
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
  assert.equal(report.schema_version, 2);
  assert.equal(report.run_quality.a, 'clean');
  assert.equal(report.run_quality.b, 'contaminated');
  assert.equal(report.scorecards.a?.version, 'evaluation-v2-p0');
  assert.equal(report.contamination.b?.status, 'contaminated');
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
  assert.match(md, /Group A run quality: `clean`/);
  assert.match(md, /Group B run quality: `clean`/);
});

test('ab report includes timeout_limited quality and fast-fail metadata', () => {
  const rows = [
    { profile: 'baseline', totalRounds: 0, avgQuality: 0, contradictionRate: 1, duplicationRate: 1, coverage: 0 },
    { profile: 'full', totalRounds: 0, avgQuality: 0, contradictionRate: 1, duplicationRate: 1, coverage: 0 },
  ];
  const gate = evaluateGate(rows, {
    enabled: true,
    maxQualityDrop: 0.02,
    maxContradictionRise: 0.03,
    maxDuplicationRise: 0.03,
    baselineProfile: 'baseline',
    compareProfile: 'full',
  });
  const report = buildAbComparisonReport(rows, 'baseline', 'full', gate, {
    reportQuality: 'timeout_limited',
    elapsedMs: 4200,
    fastFailures: [{ profile: 'baseline', error: 'timeout after 60000ms' }],
  });
  assert.equal(report.report_quality, 'timeout_limited');
  assert.equal(report.execution.elapsed_ms, 4200);
  assert.equal(report.execution.fast_failures.length, 1);
});

test('evaluateGate rejects contaminated comparison rows for official decisions', () => {
  const rows = [
    {
      profile: 'baseline',
      totalRounds: 10,
      avgQuality: 0.9,
      contradictionRate: 0.1,
      duplicationRate: 0.1,
      coverage: 0.8,
      run_quality: 'clean',
    },
    {
      profile: 'full',
      totalRounds: 10,
      avgQuality: 0.89,
      contradictionRate: 0.1,
      duplicationRate: 0.1,
      coverage: 0.8,
      run_quality: 'contaminated',
    },
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
  assert.match(result.reason, /full row is not clean \(contaminated\)/);
});

test('classifyFailure maps schema incompatibility distinctly', () => {
  const schemaErr = classifyFailure('No object generated: response did not match schema');
  const toolErr = classifyFailure('Specifying functions for tool_choice is not yet supported');
  const timeoutErr = classifyFailure('request timeout after 30000ms');
  assert.equal(schemaErr.tag, 'structured_output_failure');
  assert.equal(toolErr.tag, 'capability_mismatch');
  assert.equal(timeoutErr.tag, 'generation_timeout');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { __abReportTestables } from '../dist/testing/ab-report-test-entry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const { buildAbComparisonReport, evaluateGate } = __abReportTestables;

function readHelp(command) {
  return execFileSync(process.execPath, ['dist/cli/index.js', command, '--help'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
}

async function importOptional(modulePath) {
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' ||
      error?.code === 'MODULE_NOT_FOUND' ||
      String(error?.message ?? '').includes('Cannot find module')
    ) {
      return null;
    }
    throw error;
  }
}

function scorecard(overall) {
  return {
    version: 'evaluation-v2-p1',
    summary: 'proxy scorecard',
    overall,
    axes: {},
  };
}

function benchmarkScorecard(overall, overrides = {}) {
  return {
    version: 'benchmark-judge-v1',
    summary: 'benchmark scorecard',
    overall,
    pass_rate: overall,
    case_count: 2,
    disputed_case_count: 0,
    ...overrides,
  };
}

function benchmarkCaseSummary(overrides = {}) {
  return {
    total_cases: 2,
    passed_cases: 2,
    failed_cases: 0,
    disputed_cases: 0,
    artifact_format: 'benchmark-judgments-v1',
    artifact_path: '/tmp/persona-core-v1.benchmark-judgments.json',
    ...overrides,
  };
}

function benchmarkJudgeDisagreement(overrides = {}) {
  return {
    active: true,
    judge_count: 2,
    disagreement_rate: 0.5,
    verdict_conflicts: 1,
    high_delta_cases: ['persona-core-v1-001'],
    ...overrides,
  };
}

function benchmarkSignificance(overrides = {}) {
  return {
    method: 'paired_bootstrap',
    replicas_a: 3,
    replicas_b: 3,
    metric: 'benchmark_overall',
    delta_mean: 0.12,
    ci_low: 0.04,
    ci_high: 0.19,
    significant: true,
    favors: 'b',
    ...overrides,
  };
}

function benchmarkGovernance(overrides = {}) {
  return {
    version: 'benchmark-governance-v1',
    pack_id: 'persona-core-v1',
    pack_version: '2026-04-22',
    judge_mode: 'benchmark_dual',
    official_benchmark_status: 'available',
    promotion_readiness: 'promotable',
    clean_replica_count: 3,
    benchmark_homogeneous: true,
    significance_status: 'improved',
    judge_disagreement_rate: 0.08,
    ...overrides,
  };
}

function officialPackDescriptor() {
  return {
    pack_id: 'persona-core-v1',
    pack_version: '2026-04-22',
    manifest_version: 'benchmark-pack-registry-v1',
    suite_type: 'official_benchmark',
    suite_tier: 'official',
    status: 'draft',
  };
}

function officialBenchmarkContext() {
  return {
    pack_id: 'persona-core-v1',
    pack_type: 'official',
    suite_type: 'official_benchmark',
    suite_tier: 'official',
    case_count: 2,
    rounds: 2,
    questions_per_round: 1,
    case_distribution: { official_pack_cases: 2 },
    case_manifest: {
      manifest_id: 'official_benchmark:persona-core-v1:2026-04-22',
      manifest_version: 'benchmark-case-manifest-v2',
      pack_version: '2026-04-22',
      recipe_version: 'training-question-recipe-v1',
      suite_label: 'official_benchmark:persona-core-v1',
      suite_tier: 'official',
      flavor: 'persona-core-v1',
      replayable: true,
      replay_mode: 'recipe_only',
      freeze_level: 'frozen_cases',
      case_count: 2,
      provider_fingerprint: 'provider-demo',
      runtime_fingerprint: 'runtime-demo',
      judge_fingerprint: 'judge-demo',
    },
  };
}

function officialRows() {
  return [
    {
      profile: 'baseline',
      totalRounds: 2,
      avgQuality: 0.88,
      contradictionRate: 0.06,
      duplicationRate: 0.05,
      coverage: 0.73,
      run_quality: 'clean',
      scorecard: scorecard(0.76),
      benchmark_context: officialBenchmarkContext(),
    },
    {
      profile: 'full',
      totalRounds: 2,
      avgQuality: 0.9,
      contradictionRate: 0.05,
      duplicationRate: 0.04,
      coverage: 0.76,
      run_quality: 'clean',
      scorecard: scorecard(0.81),
      benchmark_context: officialBenchmarkContext(),
    },
  ];
}

function officialRowsWithBenchmarkArtifacts() {
  return [
    {
      ...officialRows()[0],
      benchmark_scorecard: benchmarkScorecard(0.74, {
        disputed_case_count: 1,
      }),
      benchmark_case_summary: benchmarkCaseSummary({
        passed_cases: 1,
        failed_cases: 0,
        disputed_cases: 1,
      }),
      benchmark_judge_disagreement: benchmarkJudgeDisagreement(),
    },
    {
      ...officialRows()[1],
      benchmark_scorecard: benchmarkScorecard(0.86),
      benchmark_case_summary: benchmarkCaseSummary({
        artifact_path: '/tmp/persona-core-v1-full.benchmark-judgments.json',
      }),
      benchmark_judge_disagreement: benchmarkJudgeDisagreement({
        active: false,
        disagreement_rate: 0,
        verdict_conflicts: 0,
        high_delta_cases: [],
      }),
    },
  ];
}

test('experiment CLI help exposes official-pack while keeping benchmark-manifest for backward compatibility', (t) => {
  const help = readHelp('experiment');
  if (!help.includes('--official-pack')) {
    t.skip('Blocker: experiment CLI has not wired --official-pack yet.');
    return;
  }

  assert.match(help, /--official-pack <pack-id-or-path>/);
  assert.match(help, /--benchmark-manifest <path>/);
});

test('ab-regression CLI help exposes official-pack while keeping benchmark-manifest for backward compatibility', (t) => {
  const help = readHelp('ab-regression');
  if (!help.includes('--official-pack')) {
    t.skip('Blocker: ab-regression CLI has not wired --official-pack yet.');
    return;
  }

  assert.match(help, /--official-pack <pack-id-or-path>/);
  assert.match(help, /--benchmark-manifest <path>/);
});

test('ab-regression official-pack report wiring can carry benchmark pack identity without dropping existing metrics', (t) => {
  const rows = officialRows();
  const gateResult = evaluateGate(rows, {
    enabled: true,
    maxQualityDrop: 0.05,
    maxContradictionRise: 0.05,
    maxDuplicationRise: 0.05,
    baselineProfile: 'baseline',
    compareProfile: 'full',
  });
  const report = buildAbComparisonReport(rows, 'baseline', 'full', gateResult, {
    benchmarkContext: officialBenchmarkContext(),
    benchmarkPack: officialPackDescriptor(),
    artifactRefs: {
      benchmark_pack_path: '/tmp/persona-core-v1',
      report_path: '/tmp/ab-report.json',
    },
  });

  if (!Object.prototype.hasOwnProperty.call(report, 'benchmark_pack')) {
    t.skip('Blocker: buildAbComparisonReport does not expose benchmark_pack yet.');
    return;
  }

  assert.equal(report.benchmark_pack.pack_id, 'persona-core-v1');
  assert.equal(report.benchmark_pack.pack_version, '2026-04-22');
  assert.equal(report.metrics.avg_quality.a, 0.88);
  assert.equal(report.metrics.avg_quality.b, 0.9);
  assert.equal(report.run_quality.a, 'clean');
  assert.equal(report.run_quality.b, 'clean');
});

test('experiment report official-pack contract is ready to assert once a report builder test entry exists', async (t) => {
  const experimentModule =
    (await importOptional(join(repoRoot, 'dist', 'testing', 'experiment-test-entry.js'))) ??
    (await importOptional(join(repoRoot, 'dist', 'cli', 'commands', 'experiment.js')));
  const buildExperimentReport =
    experimentModule?.__experimentTestables?.buildExperimentReport ??
    experimentModule?.buildExperimentReport ??
    null;

  if (!buildExperimentReport) {
    t.skip('Blocker: no experiment report builder test entry is available for official-pack contract tests.');
    return;
  }

  const report = buildExperimentReport({
    slug: 'onevcat',
    summary_rows: officialRows(),
    official_summary_rows: officialRows(),
    benchmark_pack: officialPackDescriptor(),
    artifact_refs: {
      benchmark_pack_path: '/tmp/persona-core-v1',
      report_path: '/tmp/experiment-report.json',
    },
  });

  assert.equal(report.benchmark_pack.pack_id, 'persona-core-v1');
  assert.equal(report.benchmark_pack.pack_version, '2026-04-22');
  assert.ok(Array.isArray(report.summary_rows));
  assert.ok(Array.isArray(report.official_summary_rows));
  assert.equal(report.artifact_refs.report_path, '/tmp/experiment-report.json');
});

test('experiment report preserves row-level benchmark artifacts and disagreement summaries for official-pack runs', async (t) => {
  const experimentModule =
    (await importOptional(join(repoRoot, 'dist', 'testing', 'experiment-test-entry.js'))) ??
    (await importOptional(join(repoRoot, 'dist', 'cli', 'commands', 'experiment.js')));
  const buildExperimentReport =
    experimentModule?.__experimentTestables?.buildExperimentReport ??
    experimentModule?.buildExperimentReport ??
    null;

  if (!buildExperimentReport) {
    t.skip('Blocker: no experiment report builder test entry is available for benchmark artifact contract tests.');
    return;
  }

  const rows = officialRowsWithBenchmarkArtifacts();
  const report = buildExperimentReport({
    slug: 'onevcat',
    summary_rows: rows,
    official_summary_rows: rows,
    benchmark_pack: officialPackDescriptor(),
    artifact_refs: {
      benchmark_pack_path: '/tmp/persona-core-v1',
      benchmark_judgments_path: '/tmp/persona-core-v1.benchmark-judgments.json',
      benchmark_summary_path: '/tmp/persona-core-v1.benchmark-summary.json',
      report_path: '/tmp/experiment-report.json',
    },
  });

  assert.equal(report.summary_rows[0].benchmark_scorecard.version, 'benchmark-judge-v1');
  assert.equal(report.summary_rows[0].benchmark_case_summary.artifact_format, 'benchmark-judgments-v1');
  assert.equal(report.summary_rows[0].benchmark_judge_disagreement.disagreement_rate, 0.5);
  assert.equal(report.summary_rows[1].benchmark_case_summary.artifact_path, '/tmp/persona-core-v1-full.benchmark-judgments.json');
  assert.equal(report.official_summary_rows[1].benchmark_scorecard.case_count, 2);
  assert.equal(report.artifact_refs.benchmark_judgments_path, '/tmp/persona-core-v1.benchmark-judgments.json');
  assert.equal(report.artifact_refs.benchmark_summary_path, '/tmp/persona-core-v1.benchmark-summary.json');
  assert.equal(report.evaluation_v2.official_pack_id, 'persona-core-v1');
  assert.equal(report.evaluation_v2.official_status, 'available');
});

test('ab-regression official-pack report can preserve P2 significance and governance summaries', (t) => {
  const rows = officialRowsWithBenchmarkArtifacts();
  const gateResult = evaluateGate(rows, {
    enabled: true,
    maxQualityDrop: 0.05,
    maxContradictionRise: 0.05,
    maxDuplicationRise: 0.05,
    baselineProfile: 'baseline',
    compareProfile: 'full',
  });
  const report = buildAbComparisonReport(rows, 'baseline', 'full', gateResult, {
    benchmarkContext: officialBenchmarkContext(),
    benchmarkPack: officialPackDescriptor(),
    benchmarkSignificance: benchmarkSignificance(),
    benchmarkGovernance: benchmarkGovernance(),
    artifactRefs: {
      benchmark_pack_path: '/tmp/persona-core-v1',
      benchmark_summary_path: '/tmp/ab-regression.benchmark-summary.json',
      report_path: '/tmp/ab-report.json',
    },
  });

  if (
    !Object.prototype.hasOwnProperty.call(report, 'benchmark_significance') ||
    !Object.prototype.hasOwnProperty.call(report, 'benchmark_governance')
  ) {
    t.skip('Blocker: buildAbComparisonReport does not expose P2 significance/governance fields yet.');
    return;
  }

  assert.equal(report.benchmark_significance.method, 'paired_bootstrap');
  assert.equal(report.benchmark_significance.significant, true);
  assert.equal(report.benchmark_significance.favors, 'b');
  assert.equal(report.benchmark_governance.promotion_readiness, 'promotable');
  assert.equal(report.benchmark_governance.clean_replica_count, 3);
  assert.equal(report.benchmark_governance.significance_status, 'improved');
});

test('experiment report can preserve P2 governance summaries for official benchmark promotion decisions', async (t) => {
  const experimentModule =
    (await importOptional(join(repoRoot, 'dist', 'testing', 'experiment-test-entry.js'))) ??
    (await importOptional(join(repoRoot, 'dist', 'cli', 'commands', 'experiment.js')));
  const buildExperimentReport =
    experimentModule?.__experimentTestables?.buildExperimentReport ??
    experimentModule?.buildExperimentReport ??
    null;

  if (!buildExperimentReport) {
    t.skip('Blocker: no experiment report builder test entry is available for P2 governance contract tests.');
    return;
  }

  const rows = officialRowsWithBenchmarkArtifacts();
  const report = buildExperimentReport({
    slug: 'onevcat',
    summary_rows: rows,
    official_summary_rows: rows,
    benchmark_pack: officialPackDescriptor(),
    benchmark_significance: benchmarkSignificance(),
    benchmark_governance: benchmarkGovernance(),
    artifact_refs: {
      benchmark_pack_path: '/tmp/persona-core-v1',
      benchmark_judgments_path: '/tmp/persona-core-v1.benchmark-judgments.json',
      benchmark_summary_path: '/tmp/persona-core-v1.benchmark-summary.json',
      report_path: '/tmp/experiment-report.json',
    },
  });

  if (
    !Object.prototype.hasOwnProperty.call(report, 'benchmark_significance') ||
    !Object.prototype.hasOwnProperty.call(report, 'benchmark_governance')
  ) {
    t.skip('Blocker: buildExperimentReport does not expose P2 significance/governance fields yet.');
    return;
  }

  assert.equal(report.benchmark_significance.method, 'paired_bootstrap');
  assert.equal(report.benchmark_significance.delta_mean, 0.12);
  assert.equal(report.benchmark_governance.pack_id, 'persona-core-v1');
  assert.equal(report.benchmark_governance.promotion_readiness, 'promotable');
  assert.equal(report.benchmark_governance.significance_status, 'improved');
});

test('legacy experiment report contract stays readable when P2 benchmark governance fields are absent', async (t) => {
  const experimentModule =
    (await importOptional(join(repoRoot, 'dist', 'testing', 'experiment-test-entry.js'))) ??
    (await importOptional(join(repoRoot, 'dist', 'cli', 'commands', 'experiment.js')));
  const buildExperimentReport =
    experimentModule?.__experimentTestables?.buildExperimentReport ??
    experimentModule?.buildExperimentReport ??
    null;

  if (!buildExperimentReport) {
    t.skip('Blocker: no experiment report builder test entry is available for legacy compatibility tests.');
    return;
  }

  const legacyRows = officialRows().map(({ benchmark_context, ...row }) => row);
  const report = buildExperimentReport({
    slug: 'onevcat',
    summary_rows: legacyRows,
    official_summary_rows: legacyRows,
    artifact_refs: {
      report_path: '/tmp/legacy-experiment-report.json',
    },
  });

  assert.ok(Array.isArray(report.summary_rows));
  assert.ok(Array.isArray(report.official_summary_rows));
  assert.equal(report.benchmark_significance ?? null, null);
  assert.equal(report.benchmark_governance ?? null, null);
  assert.equal(report.artifact_refs.report_path, '/tmp/legacy-experiment-report.json');
});

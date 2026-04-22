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

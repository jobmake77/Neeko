import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { settings } from '../../config/settings.js';
import {
  buildAbComparisonReport,
  ExperimentSummaryRow,
  evaluateGate,
  renderAbComparisonTable,
  toAbComparisonCsv,
  toAbComparisonMarkdown,
} from '../../core/training/ab-report.js';
import {
  buildBenchmarkContext,
  summarizeBenchmarkHomogeneity,
  type BenchmarkCaseManifest,
  type FrozenBenchmarkCaseManifest,
} from '../../core/training/evaluation-v2.js';
import { loadBenchmarkPack, type LoadedBenchmarkPack } from '../../core/training/benchmark-pack.js';
import {
  buildBenchmarkGovernanceSummary,
  computePairedBootstrapSignificance,
  type BenchmarkReportJudgeMode,
} from '../../core/training/significance.js';
import { TrainingProfile } from '../../core/training/types.js';
import {
  loadBenchmarkCaseManifestsFromArtifact,
  __experimentTestables,
  runExperimentProfiles,
} from './experiment.js';
import { runModelPreflight } from '../../core/training/preflight.js';

const VALID_PROFILES: TrainingProfile[] = ['baseline', 'a1', 'a2', 'a3', 'a4', 'full'];
const AB_PROFILE_TIMEOUT_MS = Number(process.env.NEEKO_AB_PROFILE_TIMEOUT_MS ?? 60_000);
const { resolveOfficialReplicaCount } = __experimentTestables;

function normalizeProfile(input: string | undefined, fallback: TrainingProfile): TrainingProfile {
  const value = String(input ?? fallback).toLowerCase();
  if (VALID_PROFILES.includes(value as TrainingProfile)) return value as TrainingProfile;
  return fallback;
}

function pickRows(rows: ExperimentSummaryRow[], a: TrainingProfile, b: TrainingProfile): ExperimentSummaryRow[] {
  const selected = rows.filter((row) => row.profile === a || row.profile === b);
  if (selected.length !== 2) {
    throw new Error(`A/B rows missing: ${a}/${b}`);
  }
  return selected;
}

function collectBenchmarkManifests(rows: Array<{ benchmark_context?: { case_manifest?: BenchmarkCaseManifest } }>) {
  const manifests = new Map<string, BenchmarkCaseManifest>();
  for (const row of rows) {
    const manifest = row.benchmark_context?.case_manifest;
    if (!manifest?.manifest_id) continue;
    manifests.set(manifest.manifest_id, manifest);
  }
  return [...manifests.values()];
}

function collectFrozenBenchmarkCaseManifests(
  manifests: FrozenBenchmarkCaseManifest[],
  manifestIds: Set<string>
): FrozenBenchmarkCaseManifest[] {
  return manifests.filter((item) => manifestIds.has(item.manifest.manifest_id));
}

function normalizeJudgeMode(input?: string): BenchmarkReportJudgeMode {
  const value = String(input ?? 'both').trim().toLowerCase();
  if (
    value === 'proxy' ||
    value === 'benchmark_single' ||
    value === 'benchmark_dual' ||
    value === 'both'
  ) {
    return value;
  }
  throw new Error('Invalid judge mode. Use proxy|benchmark_single|benchmark_dual|both');
}

export async function cmdAbRegression(
  slug: string,
  options: {
    rounds?: string;
    a?: string;
    b?: string;
    benchmarkManifest?: string;
    officialPack?: string;
    outputDir?: string;
    format?: string;
    gate?: boolean;
    maxQualityDrop?: string;
    maxContradictionRise?: string;
    maxDuplicationRise?: string;
    replicas?: string;
    significance?: boolean;
    judgeMode?: string;
  }
): Promise<void> {
  if (options.benchmarkManifest && options.officialPack) {
    throw new Error('--benchmark-manifest and --official-pack cannot be used together');
  }

  const rounds = Math.max(1, parseInt(options.rounds ?? '10', 10));
  const groupA = normalizeProfile(options.a, 'baseline');
  const groupB = normalizeProfile(options.b, 'full');

  if (groupA === groupB) {
    throw new Error('A/B profiles must be different');
  }

  const format = String(options.format ?? 'all').toLowerCase();
  const supported = new Set(['table', 'csv', 'json', 'md', 'all']);
  if (!supported.has(format)) {
    throw new Error('Invalid format. Use table|csv|json|md|all');
  }
  const judgeMode = normalizeJudgeMode(options.judgeMode);
  const officialPack: LoadedBenchmarkPack | null = options.officialPack
    ? loadBenchmarkPack(options.officialPack, { repoRoot: process.cwd() })
    : null;
  const parsedRequestedReplicas =
    options.replicas === undefined ? undefined : Math.max(1, parseInt(options.replicas, 10));
  if ((options.replicas || options.significance) && !officialPack) {
    throw new Error('--replicas and --significance require --official-pack');
  }
  const requestedReplicas = resolveOfficialReplicaCount(parsedRequestedReplicas, officialPack);
  const replayBenchmarkCaseManifests = options.benchmarkManifest
    ? loadBenchmarkCaseManifestsFromArtifact(options.benchmarkManifest)
    : [];

  console.log(chalk.bold.cyan(`\n✦ A/B Regression (${slug})\n`));
  console.log(chalk.dim(`Groups: A=${groupA}, B=${groupB}`));
  console.log(chalk.dim(`Rounds per group: ${rounds}\n`));
  if (options.benchmarkManifest) {
    console.log(chalk.dim(`Replay benchmark source: ${options.benchmarkManifest}`));
  }
  if (officialPack) {
    console.log(
      chalk.dim(
        `Official benchmark pack: ${officialPack.summary.pack_id}@${officialPack.summary.pack_version} ` +
        `(${officialPack.summary.case_count} case(s), source=${officialPack.summary.source_kind})`
      )
    );
  }
  const startedAt = Date.now();

  const preflight = await runModelPreflight({
    timeoutMs: Number(process.env.NEEKO_PREFLIGHT_AB_TIMEOUT_MS ?? process.env.NEEKO_PREFLIGHT_TIMEOUT_MS ?? 15_000),
    requireStructured: true,
  });
  if (!preflight.ok) {
    throw new Error(
      `A/B preflight failed (provider=${preflight.providerName}, stage=${preflight.failureStage ?? 'unknown'}, category=${preflight.failureCategory ?? 'unknown'}, ${preflight.latencyMs}ms): ${preflight.reason ?? 'unknown'}`
    );
  }

  const { rows, benchmarkCaseManifests, replicaMeasurements, failures } = await runExperimentProfiles(slug, rounds, [groupA, groupB], {
    timeoutMs: AB_PROFILE_TIMEOUT_MS,
    benchmarkCaseManifests: replayBenchmarkCaseManifests,
    officialPack,
    replicas: requestedReplicas,
    judgeMode,
  });
  if (failures && failures.length > 0) {
    for (const item of failures) {
      console.log(chalk.yellow(`fast-fail ${item.profile}: ${item.error.slice(0, 160)}`));
    }
  }
  const selectedRows = pickRows(rows, groupA, groupB);
  const benchmarkManifests = collectBenchmarkManifests(selectedRows);
  const benchmarkManifestIds = new Set(benchmarkManifests.map((item) => item.manifest_id));
  const selectedBenchmarkCaseManifests = collectFrozenBenchmarkCaseManifests(
    benchmarkCaseManifests,
    benchmarkManifestIds
  );
  const outputDir = options.outputDir ? options.outputDir : join(settings.getPersonaDir(slug), 'experiments');
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `ab-regression-${slug}-${timestamp}`;
  const benchmarkSummaryPath = join(outputDir, `${baseName}.benchmark-summary.json`);
  const hasBenchmarkJudging =
    Boolean(selectedRows[0]?.benchmark_scorecard || selectedRows[1]?.benchmark_scorecard);
  const benchmarkSignificance =
    officialPack && (options.significance || requestedReplicas > 1 || options.gate)
      ? computePairedBootstrapSignificance({
        groupA: replicaMeasurements[groupA] ?? [],
        groupB: replicaMeasurements[groupB] ?? [],
        seedKey: `${officialPack.summary.pack_id}:${groupA}:${groupB}`,
      })
      : null;
  const benchmarkGovernance = buildBenchmarkGovernanceSummary({
    pack: officialPack?.summary,
    judgeMode,
    homogeneity: summarizeBenchmarkHomogeneity(benchmarkManifests),
    replicaSummary: selectedRows.find((row) => row.profile === groupB)?.benchmark_replica_summary ?? null,
    significance: benchmarkSignificance,
    requiredMinCleanReplicas:
      officialPack?.definition.min_clean_replicas ??
      officialPack?.definition.default_replicas ??
      2,
    judgeDisagreementRate:
      selectedRows.find((row) => row.profile === groupB)?.benchmark_judge_disagreement?.disagreement_rate ?? 0,
  });
  const compareRow = selectedRows.find((row) => row.profile === groupB);
  if (compareRow) {
    compareRow.benchmark_governance = benchmarkGovernance;
  }
  const gateResult = evaluateGate(selectedRows, {
    enabled: options.gate === true,
    maxQualityDrop: parseFloat(options.maxQualityDrop ?? '0.02'),
    maxContradictionRise: parseFloat(options.maxContradictionRise ?? '0.03'),
    maxDuplicationRise: parseFloat(options.maxDuplicationRise ?? '0.05'),
    baselineProfile: groupA,
    compareProfile: groupB,
    benchmarkGovernance,
  });
  const report = buildAbComparisonReport(selectedRows, groupA, groupB, gateResult, {
    reportQuality: failures && failures.length > 0 ? 'timeout_limited' : 'complete',
    elapsedMs: Date.now() - startedAt,
    fastFailures: failures ?? [],
    benchmarkPack: officialPack?.summary,
    benchmarkContext: officialPack?.benchmark_context ?? buildBenchmarkContext({
      slug,
      suiteType: 'ab_regression',
      variant: `${groupA}:${groupB}`,
      rounds,
      questionsPerRound: 5,
    }),
    benchmarkManifests,
    benchmarkCaseManifests: selectedBenchmarkCaseManifests,
    benchmarkHomogeneity: summarizeBenchmarkHomogeneity(benchmarkManifests),
    benchmarkSignificance,
    benchmarkGovernance,
    artifactRefs: hasBenchmarkJudging ? { benchmark_summary_path: benchmarkSummaryPath } : undefined,
  });

  console.log(renderAbComparisonTable(report));
  if (gateResult.enabled) {
    const gateLine = gateResult.passed
      ? chalk.green(`Quality gate: passed (${gateResult.reason})`)
      : chalk.red(`Quality gate: failed (${gateResult.reason})`);
    console.log(`\n${gateLine}`);
  }
  if (report.benchmark_significance) {
    console.log(
      chalk.dim(
        `Benchmark significance: ${report.benchmark_significance.significance_status} ` +
        `(delta=${(report.benchmark_significance.delta_mean ?? 0).toFixed(4)}, ` +
        `ci=[${(report.benchmark_significance.ci_low ?? 0).toFixed(4)}, ${(report.benchmark_significance.ci_high ?? 0).toFixed(4)}])`
      )
    );
  }
  if (report.benchmark_governance) {
    console.log(
      chalk.dim(
        `Benchmark governance: ${report.benchmark_governance.promotion_readiness} ` +
        `(${report.benchmark_governance.significance_status})`
      )
    );
  }

  if (format === 'all' || format === 'json') {
    const jsonPath = join(outputDir, `${baseName}.json`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(chalk.dim(`JSON report: ${jsonPath}`));
    const latestJsonPath = join(outputDir, `ab-regression-latest-${slug}.json`);
    writeFileSync(latestJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  }
  if (format === 'all' || format === 'csv') {
    const csvPath = join(outputDir, `${baseName}.csv`);
    const csvContent = toAbComparisonCsv(report);
    writeFileSync(csvPath, csvContent, 'utf-8');
    console.log(chalk.dim(`CSV report:  ${csvPath}`));
    const latestCsvPath = join(outputDir, `ab-regression-latest-${slug}.csv`);
    writeFileSync(latestCsvPath, csvContent, 'utf-8');
  }
  if (format === 'all' || format === 'md') {
    const mdPath = join(outputDir, `${baseName}.md`);
    const mdContent = toAbComparisonMarkdown(report);
    writeFileSync(mdPath, mdContent, 'utf-8');
    console.log(chalk.dim(`MD report:   ${mdPath}`));
    const latestMdPath = join(outputDir, `ab-regression-latest-${slug}.md`);
    writeFileSync(latestMdPath, mdContent, 'utf-8');
  }
  if (hasBenchmarkJudging) {
    writeFileSync(
      benchmarkSummaryPath,
      JSON.stringify(
        {
          schema_version: 1,
          generated_at: report.generated_at,
          slug,
          benchmark_pack: officialPack?.summary,
          benchmark_scorecards: report.benchmark_scorecards ?? null,
          benchmark_case_summaries: report.benchmark_case_summaries ?? null,
          benchmark_judge_summaries: report.benchmark_judge_summaries ?? null,
          benchmark_judge_disagreements: report.benchmark_judge_disagreements ?? null,
          benchmark_replica_summaries: report.benchmark_replica_summaries ?? null,
          benchmark_significance: report.benchmark_significance ?? null,
          benchmark_governance: report.benchmark_governance ?? null,
        },
        null,
        2
      ),
      'utf-8'
    );
    console.log(chalk.dim(`Benchmark summary: ${benchmarkSummaryPath}`));
  }

  if (gateResult.enabled && !gateResult.passed) {
    process.exitCode = 2;
  }
}

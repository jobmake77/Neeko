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
import { buildBenchmarkContext } from '../../core/training/evaluation-v2.js';
import { TrainingProfile } from '../../core/training/types.js';
import { runExperimentProfiles } from './experiment.js';
import { runModelPreflight } from '../../core/training/preflight.js';

const VALID_PROFILES: TrainingProfile[] = ['baseline', 'a1', 'a2', 'a3', 'a4', 'full'];
const AB_PROFILE_TIMEOUT_MS = Number(process.env.NEEKO_AB_PROFILE_TIMEOUT_MS ?? 60_000);

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

export async function cmdAbRegression(
  slug: string,
  options: {
    rounds?: string;
    a?: string;
    b?: string;
    outputDir?: string;
    format?: string;
    gate?: boolean;
    maxQualityDrop?: string;
    maxContradictionRise?: string;
    maxDuplicationRise?: string;
  }
): Promise<void> {
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

  console.log(chalk.bold.cyan(`\n✦ A/B Regression (${slug})\n`));
  console.log(chalk.dim(`Groups: A=${groupA}, B=${groupB}`));
  console.log(chalk.dim(`Rounds per group: ${rounds}\n`));
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

  const { rows, failures } = await runExperimentProfiles(slug, rounds, [groupA, groupB], {
    timeoutMs: AB_PROFILE_TIMEOUT_MS,
  });
  if (failures && failures.length > 0) {
    for (const item of failures) {
      console.log(chalk.yellow(`fast-fail ${item.profile}: ${item.error.slice(0, 160)}`));
    }
  }
  const selectedRows = pickRows(rows, groupA, groupB);
  const gateResult = evaluateGate(selectedRows, {
    enabled: options.gate === true,
    maxQualityDrop: parseFloat(options.maxQualityDrop ?? '0.02'),
    maxContradictionRise: parseFloat(options.maxContradictionRise ?? '0.03'),
    maxDuplicationRise: parseFloat(options.maxDuplicationRise ?? '0.05'),
    baselineProfile: groupA,
    compareProfile: groupB,
  });
  const report = buildAbComparisonReport(selectedRows, groupA, groupB, gateResult, {
    reportQuality: failures && failures.length > 0 ? 'timeout_limited' : 'complete',
    elapsedMs: Date.now() - startedAt,
    fastFailures: failures ?? [],
    benchmarkContext: buildBenchmarkContext({
      slug,
      suiteType: 'ab_regression',
      variant: `${groupA}:${groupB}`,
      rounds,
      questionsPerRound: 5,
    }),
  });

  console.log(renderAbComparisonTable(report));
  if (gateResult.enabled) {
    const gateLine = gateResult.passed
      ? chalk.green(`Quality gate: passed (${gateResult.reason})`)
      : chalk.red(`Quality gate: failed (${gateResult.reason})`);
    console.log(`\n${gateLine}`);
  }

  const outputDir = options.outputDir ? options.outputDir : join(settings.getPersonaDir(slug), 'experiments');
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `ab-regression-${slug}-${timestamp}`;

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

  if (gateResult.enabled && !gateResult.passed) {
    process.exitCode = 2;
  }
}

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
import { TrainingProfile } from '../../core/training/types.js';
import { runExperimentProfiles } from './experiment.js';

const VALID_PROFILES: TrainingProfile[] = ['baseline', 'a1', 'a2', 'a3', 'a4', 'full'];

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

  const { rows } = await runExperimentProfiles(slug, rounds, [groupA, groupB]);
  const selectedRows = pickRows(rows, groupA, groupB);
  const gateResult = evaluateGate(selectedRows, {
    enabled: options.gate === true,
    maxQualityDrop: parseFloat(options.maxQualityDrop ?? '0.02'),
    maxContradictionRise: parseFloat(options.maxContradictionRise ?? '0.03'),
    maxDuplicationRise: parseFloat(options.maxDuplicationRise ?? '0.05'),
    baselineProfile: groupA,
    compareProfile: groupB,
  });
  const report = buildAbComparisonReport(selectedRows, groupA, groupB, gateResult);

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
  }
  if (format === 'all' || format === 'csv') {
    const csvPath = join(outputDir, `${baseName}.csv`);
    writeFileSync(csvPath, toAbComparisonCsv(report), 'utf-8');
    console.log(chalk.dim(`CSV report:  ${csvPath}`));
  }
  if (format === 'all' || format === 'md') {
    const mdPath = join(outputDir, `${baseName}.md`);
    writeFileSync(mdPath, toAbComparisonMarkdown(report), 'utf-8');
    console.log(chalk.dim(`MD report:   ${mdPath}`));
  }

  if (gateResult.enabled && !gateResult.passed) {
    process.exitCode = 2;
  }
}

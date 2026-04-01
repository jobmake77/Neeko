import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

const DUAL_PIPELINE_ACCOUNTS = ['turingou', 'HiTw93'] as const;
const TRAIN_TIMEOUT_MS = Number(process.env.NEEKO_DUAL_TRAIN_TIMEOUT_MS ?? 20 * 60_000);
const AB_TIMEOUT_MS = Number(process.env.NEEKO_DUAL_AB_TIMEOUT_MS ?? 5 * 60_000);

type StepState = 'ok' | 'failed' | 'timeout';

interface StepResult {
  state: StepState;
  exitCode: number | null;
  elapsedMs: number;
  error?: string;
}

interface PipelineSummaryItem {
  slug: string;
  train: StepResult;
  ab: StepResult;
}

function runCliStep(args: string[], timeoutMs: number): Promise<StepResult> {
  return new Promise((resolve) => {
    const script = process.argv[1];
    const startedAt = Date.now();
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NEEKO_NO_SPINNER: '1',
        NEEKO_CLI_FORCE_EXIT: '1',
        NEEKO_PREFLIGHT_TRAIN_TIMEOUT_MS: process.env.NEEKO_PREFLIGHT_TRAIN_TIMEOUT_MS ?? '20000',
        NEEKO_PREFLIGHT_AB_TIMEOUT_MS: process.env.NEEKO_PREFLIGHT_AB_TIMEOUT_MS ?? '15000',
      },
    });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
      resolve({
        state: 'timeout',
        exitCode: null,
        elapsedMs: Date.now() - startedAt,
        error: `step timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        state: 'failed',
        exitCode: null,
        elapsedMs: Date.now() - startedAt,
        error: error.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ state: 'ok', exitCode: 0, elapsedMs: Date.now() - startedAt });
      } else {
        resolve({
          state: 'failed',
          exitCode: code,
          elapsedMs: Date.now() - startedAt,
          error: `exit code ${String(code)}`,
        });
      }
    });
  });
}

export async function cmdDualPipeline(options: {
  rounds?: string;
  mode?: 'quick' | 'full';
  trainingProfile?: string;
  outputDir?: string;
  gate?: boolean;
} = {}): Promise<void> {
  const rounds = String(options.rounds ?? '1');
  const mode = options.mode ?? 'quick';
  const trainingProfile = options.trainingProfile ?? 'full';
  const outputDir = options.outputDir ?? join(process.cwd(), 'artifacts', `dual-pipeline-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(outputDir, { recursive: true });

  const summary: PipelineSummaryItem[] = [];

  for (const slug of DUAL_PIPELINE_ACCOUNTS) {
    const accountOutputDir = join(outputDir, slug);
    mkdirSync(accountOutputDir, { recursive: true });
    console.log(chalk.bold.cyan(`\n[dual-pipeline] ${slug} train -> ab-regression`));
    const train = await runCliStep(
      [
        'train',
        slug,
        '--rounds',
        rounds,
        '--mode',
        mode,
        '--training-profile',
        trainingProfile,
        '--track',
        'full_serial',
        '--retries',
        '1',
      ],
      TRAIN_TIMEOUT_MS
    );
    if (train.state !== 'ok') {
      console.log(chalk.yellow(`[dual-pipeline] train ${train.state} for ${slug}: ${train.error ?? 'unknown'}`));
    }

    const ab = await runCliStep(
      [
        'ab-regression',
        slug,
        '--rounds',
        rounds,
        '--a',
        'baseline',
        '--b',
        'full',
        '--format',
        'all',
        '--output-dir',
        accountOutputDir,
        ...(options.gate ?? true ? ['--gate'] : []),
      ],
      AB_TIMEOUT_MS
    );
    if (ab.state !== 'ok') {
      console.log(chalk.yellow(`[dual-pipeline] ab ${ab.state} for ${slug}: ${ab.error ?? 'unknown'}`));
    }
    summary.push({ slug, train, ab });
  }

  console.log(chalk.bold('\nDual pipeline summary'));
  for (const item of summary) {
    const trainState = item.train.state === 'ok' ? chalk.green('ok') : chalk.red(item.train.state);
    const abState = item.ab.state === 'ok' ? chalk.green('ok') : chalk.red(item.ab.state);
    console.log(`- ${item.slug}: train=${trainState}(${item.train.elapsedMs}ms), ab=${abState}(${item.ab.elapsedMs}ms)`);
  }
  const summaryPath = join(outputDir, 'dual-pipeline-summary.json');
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        train_timeout_ms: TRAIN_TIMEOUT_MS,
        ab_timeout_ms: AB_TIMEOUT_MS,
        summary,
      },
      null,
      2
    ),
    'utf-8'
  );
  console.log(chalk.dim(`summary: ${summaryPath}`));
}

import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { estimateEtaRangeMinutes, patchRuntimeTaskState, recordEtaSample, writeRuntimeProgress } from './runtime-progress';

interface TrainJob {
  slug: string;
  rounds: number;
  profile: string;
  retries: number;
  source: 'api' | 'recovery';
}

interface EnqueueResult {
  accepted: boolean;
  reason?: string;
  queuedAhead?: number;
}

const queue: TrainJob[] = [];
const pendingSlugs = new Set<string>();
let workerRunning = false;

function getRepoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'dist', 'index.js'))) return cwd;
  const parent = join(cwd, '..');
  if (existsSync(join(parent, 'dist', 'index.js'))) return parent;
  return cwd;
}

function lockDir(): string {
  const dir = join(homedir(), '.neeko', 'runtime', 'locks');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function lockPath(slug: string): string {
  return join(lockDir(), `train-${slug}.lock`);
}

function tryAcquireSlugLock(slug: string): (() => void) | null {
  const path = lockPath(slug);
  try {
    const fd = openSync(path, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return () => {
      try {
        rmSync(path, { force: true });
      } catch {
        // ignore
      }
    };
  } catch {
    return null;
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

function updateProgressByLine(job: TrainJob, line: string, startTs: number): void {
  const roundMatch = line.match(/Round\s+(\d+)\/(\d+)/i);
  let currentRound = 0;
  let totalRounds = job.rounds;
  let stage = 'training';
  let stageLabel = '培养循环';
  let percent = 10;

  if (roundMatch) {
    currentRound = parseInt(roundMatch[1], 10);
    totalRounds = Math.max(1, parseInt(roundMatch[2], 10));
    percent = 10 + (currentRound / totalRounds) * 85;
  } else if (line.includes('培养完成') || line.startsWith('✓')) {
    stage = 'finalize';
    stageLabel = '收尾与保存';
    percent = 98;
  }

  const elapsedSec = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
  const { etaMin, etaMax } = estimateEtaRangeMinutes('train', totalRounds, elapsedSec);
  writeRuntimeProgress(job.slug, {
    stage,
    stageLabel,
    percent,
    currentRound,
    totalRounds,
    elapsedSec,
    etaMin,
    etaMax,
  });
}

async function runTrainJob(job: TrainJob): Promise<void> {
  const releaseLock = tryAcquireSlugLock(job.slug);
  if (!releaseLock) {
    patchRuntimeTaskState(job.slug, {
      state: 'failed',
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      taskType: 'train',
      rounds: job.rounds,
      profile: job.profile,
      lastError: 'lock already exists for this slug',
    });
    return;
  }

  const startTs = Date.now();
  patchRuntimeTaskState(job.slug, {
    state: 'running',
    taskType: 'train',
    rounds: job.rounds,
    profile: job.profile,
    retries: job.retries,
    startedAt: new Date(startTs).toISOString(),
    finishedAt: undefined,
    lastError: undefined,
  });
  writeRuntimeProgress(job.slug, {
    stage: 'training',
    stageLabel: '培养循环',
    percent: 8,
    currentRound: 0,
    totalRounds: job.rounds,
    elapsedSec: 0,
    etaMin: job.rounds <= 3 ? 15 : 30,
    etaMax: job.rounds <= 3 ? 30 : 90,
  });

  try {
    const args = [
      'dist/index.js',
      'train',
      job.slug,
      '--rounds',
      String(job.rounds),
      '--training-profile',
      job.profile,
      '--retries',
      String(job.retries),
    ];
    const child = spawn(process.execPath, args, {
      cwd: getRepoRoot(),
      env: { ...process.env },
    });
    patchRuntimeTaskState(job.slug, { pid: child.pid ?? null, state: 'running' });

    child.stdout.on('data', (buf: Buffer) => {
      const lines = stripAnsi(buf.toString()).split('\n').map((v) => v.trim()).filter(Boolean);
      for (const line of lines) updateProgressByLine(job, line, startTs);
    });
    child.stderr.on('data', (buf: Buffer) => {
      const lines = stripAnsi(buf.toString()).split('\n').map((v) => v.trim()).filter(Boolean);
      for (const line of lines) updateProgressByLine(job, line, startTs);
    });

    const code = await new Promise<number>((resolve) => {
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });

    if (code === 0) {
      const durationSec = Math.max(1, Math.floor((Date.now() - startTs) / 1000));
      writeRuntimeProgress(job.slug, {
        stage: 'done',
        stageLabel: '培养完成',
        percent: 100,
        currentRound: job.rounds,
        totalRounds: job.rounds,
        elapsedSec: durationSec,
        etaMin: 0,
        etaMax: 0,
      });
      patchRuntimeTaskState(job.slug, {
        state: 'done',
        pid: child.pid ?? null,
        finishedAt: new Date().toISOString(),
        lastError: undefined,
      });
      recordEtaSample('train', job.rounds, durationSec);
    } else {
      patchRuntimeTaskState(job.slug, {
        state: 'failed',
        pid: child.pid ?? null,
        finishedAt: new Date().toISOString(),
        lastError: `exit code ${code}`,
      });
    }
  } finally {
    releaseLock();
  }
}

async function ensureWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) continue;
      try {
        await runTrainJob(job);
      } finally {
        pendingSlugs.delete(job.slug);
      }
    }
  } finally {
    workerRunning = false;
  }
}

export function enqueueTrainJob(job: TrainJob): EnqueueResult {
  if (pendingSlugs.has(job.slug)) {
    return { accepted: false, reason: 'already_queued_or_running' };
  }
  const queuedAhead = queue.length + (workerRunning ? 1 : 0);
  pendingSlugs.add(job.slug);
  patchRuntimeTaskState(job.slug, {
    state: 'queued',
    taskType: 'train',
    rounds: job.rounds,
    profile: job.profile,
    retries: job.retries,
    startedAt: new Date().toISOString(),
    lastError: undefined,
    pid: null,
  });
  writeRuntimeProgress(job.slug, {
    stage: 'queued',
    stageLabel: '排队中',
    percent: 2,
    currentRound: 0,
    totalRounds: job.rounds,
    elapsedSec: 0,
    etaMin: job.rounds <= 3 ? 15 : 30,
    etaMax: job.rounds <= 3 ? 30 : 90,
  });
  queue.push(job);
  void ensureWorker();
  return { accepted: true, queuedAhead };
}

export function isTrainQueuedOrRunning(slug: string): boolean {
  return pendingSlugs.has(slug);
}

export function readLockHolder(slug: string): string | null {
  const path = lockPath(slug);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return 'unknown';
  }
}

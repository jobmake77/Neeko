import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { estimateEtaRangeMinutes, patchRuntimeTaskState, readRuntimeProgress, recordEtaSample, writeRuntimeProgress } from './runtime-progress';
import { resolveCliEntry } from './cli-entry';

interface BaseJob {
  slug: string;
  source: 'api' | 'recovery';
}

interface TrainJob extends BaseJob {
  kind: 'train';
  rounds: number;
  profile: string;
  retries: number;
}

interface SkillRefreshJob extends BaseJob {
  kind: 'skills_refresh';
  mode: 'quick' | 'full';
}

type QueueJob = TrainJob | SkillRefreshJob;

interface EnqueueResult {
  accepted: boolean;
  reason?: string;
  queuedAhead?: number;
}

interface LeaseLockRecord {
  slug: string;
  owner_id: string;
  pid: number;
  fencing_token: number;
  job_id: string;
  acquired_at: string;
  last_heartbeat_at: string;
  expires_at: string;
}

interface LeaseHandle {
  ownerId: string;
  token: number;
  release: () => void;
  renew: () => boolean;
  isCurrent: () => boolean;
}

const queue: QueueJob[] = [];
const pendingSlugs = new Set<string>();
let workerRunning = false;
const LOCK_LEASE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 10_000;

function lockDir(): string {
  const dir = join(homedir(), '.neeko', 'runtime', 'locks');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function lockPath(slug: string): string {
  return join(lockDir(), `train-${slug}.lock`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLeaseLock(slug: string): LeaseLockRecord | null {
  const path = lockPath(slug);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as LeaseLockRecord;
      if (!parsed?.owner_id || !Number.isFinite(parsed?.fencing_token)) return null;
      return parsed;
    }
    const pid = parseInt(raw, 10);
    if (!Number.isFinite(pid)) return null;
    return {
      slug,
      owner_id: `legacy-${pid}`,
      pid,
      fencing_token: 1,
      job_id: 'legacy',
      acquired_at: nowIso(),
      last_heartbeat_at: nowIso(),
      expires_at: new Date(Date.now() + LOCK_LEASE_MS).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeLeaseLock(path: string, record: LeaseLockRecord): void {
  const fd = openSync(path, 'wx');
  writeFileSync(fd, JSON.stringify(record, null, 2));
  closeSync(fd);
}

function isLeaseExpired(lock: LeaseLockRecord): boolean {
  const expiry = new Date(lock.expires_at).getTime();
  if (!Number.isFinite(expiry)) return true;
  return Date.now() > expiry;
}

function tryAcquireSlugLock(slug: string, jobId: string): LeaseHandle | null {
  const path = lockPath(slug);
  const ownerId = `${process.pid}-${crypto.randomUUID()}`;
  const attemptAcquire = (token: number): LeaseHandle | null => {
    const ts = nowIso();
    const record: LeaseLockRecord = {
      slug,
      owner_id: ownerId,
      pid: process.pid,
      fencing_token: token,
      job_id: jobId,
      acquired_at: ts,
      last_heartbeat_at: ts,
      expires_at: new Date(Date.now() + LOCK_LEASE_MS).toISOString(),
    };
    try {
      writeLeaseLock(path, record);
    } catch {
      return null;
    }
    const release = () => {
      const current = readLeaseLock(slug);
      if (!current) return;
      if (current.owner_id !== ownerId || current.fencing_token !== token) return;
      try {
        try {
          rmSync(path, { force: true });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    };
    const renew = (): boolean => {
      const current = readLeaseLock(slug);
      if (!current) return false;
      if (current.owner_id !== ownerId || current.fencing_token !== token) return false;
      const next: LeaseLockRecord = {
        ...current,
        last_heartbeat_at: nowIso(),
        expires_at: new Date(Date.now() + LOCK_LEASE_MS).toISOString(),
      };
      try {
        writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8');
        return true;
      } catch {
        return false;
      }
    };
    const isCurrent = (): boolean => {
      const current = readLeaseLock(slug);
      if (!current) return false;
      return current.owner_id === ownerId && current.fencing_token === token;
    };
    return { ownerId, token, release, renew, isCurrent };
  };

  // Fast path: no lock file
  const quick = attemptAcquire(Date.now());
  if (quick) return quick;

  const existing = readLeaseLock(slug);
  if (!existing) {
    // lock file unreadable/corrupt: force cleanup and retry once
    try {
      rmSync(path, { force: true });
    } catch {
      // ignore
    }
    return attemptAcquire(Date.now() + 1);
  }

  // Active holder: reject
  if (!isLeaseExpired(existing) && isPidAlive(existing.pid)) {
    return null;
  }

  // Expired or dead holder: steal with fencing token increment
  const nextToken = Math.max(1, Math.floor(existing.fencing_token || 0) + 1);
  try {
    rmSync(path, { force: true });
  } catch {
    // ignore
  }
  return attemptAcquire(nextToken);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

function updateTrainProgressByLine(lock: LeaseHandle, job: TrainJob, line: string, startTs: number): void {
  const roundMatch = line.match(/Round\s+(\d+)\/(\d+)/i);
  let currentRound = 0;
  let totalRounds = job.rounds;
  let stage = 'training';
  let stageLabel = '培养循环';
  let percent = 10;

  if (line.includes('[SKILL_STAGE] skill_origin_extract')) {
    stage = 'skill_origin_extract';
    stageLabel = 'Skill 原点提炼';
    percent = 14;
  } else if (line.includes('[SKILL_STAGE] skill_expand')) {
    stage = 'skill_expand';
    stageLabel = 'Skill 证据融合';
    percent = 22;
  } else if (line.includes('[SKILL_STAGE] skill_merge')) {
    stage = 'skill_merge';
    stageLabel = 'Skill 蒸馏入库';
    percent = 30;
  } else if (roundMatch) {
    currentRound = parseInt(roundMatch[1], 10);
    totalRounds = Math.max(1, parseInt(roundMatch[2], 10));
    percent = 30 + (currentRound / totalRounds) * 65;
  } else if (line.includes('培养完成') || line.startsWith('✓')) {
    stage = 'finalize';
    stageLabel = '收尾与保存';
    percent = 98;
  }

  const elapsedSec = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
  const { etaMin, etaMax } = estimateEtaRangeMinutes('train', totalRounds, elapsedSec);
  safeWriteRuntimeProgress(lock, job.slug, {
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
  const lock = tryAcquireSlugLock(job.slug, `train:${job.slug}:${Date.now()}`);
  if (!lock) {
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
    lastError: '',
  });
  safeWriteRuntimeProgress(lock, job.slug, {
    stage: 'queued',
    stageLabel: '训练执行中',
    percent: 6,
    currentRound: 0,
    totalRounds: job.rounds,
    elapsedSec: 0,
    etaMin: job.rounds <= 3 ? 15 : 30,
    etaMax: job.rounds <= 3 ? 30 : 90,
  });

  try {
    const { repoRoot, cliEntry } = resolveCliEntry(process.cwd());
    const args = [
      cliEntry,
      'train',
      job.slug,
      '--rounds',
      String(job.rounds),
      '--training-profile',
      job.profile,
      '--retries',
      String(job.retries),
    ];
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: { ...process.env } });
    safePatchRuntimeTaskState(lock, job.slug, { pid: child.pid ?? null, state: 'running' });

    let lockLost = false;
    const heartbeat = setInterval(() => {
      if (!lock.renew()) {
        lockLost = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
        return;
      }
      const current = readRuntimeProgress(job.slug);
      if (!current) return;
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
      safeWriteRuntimeProgress(lock, job.slug, {
        ...current,
        elapsedSec,
      });
    }, LOCK_HEARTBEAT_MS);

    child.stdout.on('data', (buf: Buffer) => {
      const lines = stripAnsi(buf.toString()).split('\n').map((v) => v.trim()).filter(Boolean);
      for (const line of lines) updateTrainProgressByLine(lock, job, line, startTs);
    });
    child.stderr.on('data', (buf: Buffer) => {
      const lines = stripAnsi(buf.toString()).split('\n').map((v) => v.trim()).filter(Boolean);
      for (const line of lines) updateTrainProgressByLine(lock, job, line, startTs);
    });

    const code = await new Promise<number>((resolve) => {
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    clearInterval(heartbeat);

    if (code === 0 && !lockLost && lock.isCurrent()) {
      const durationSec = Math.max(1, Math.floor((Date.now() - startTs) / 1000));
      safeWriteRuntimeProgress(lock, job.slug, {
        stage: 'done',
        stageLabel: '培养完成',
        percent: 100,
        currentRound: job.rounds,
        totalRounds: job.rounds,
        elapsedSec: durationSec,
        etaMin: 0,
        etaMax: 0,
      });
      safePatchRuntimeTaskState(lock, job.slug, {
        state: 'done',
        pid: child.pid ?? null,
        finishedAt: new Date().toISOString(),
        lastError: '',
      });
      recordEtaSample('train', job.rounds, durationSec);
    } else {
      safePatchRuntimeTaskState(lock, job.slug, {
        state: 'failed',
        pid: child.pid ?? null,
        finishedAt: new Date().toISOString(),
        lastError: lockLost ? 'lease lock lost while running job' : `exit code ${code}`,
      });
    }
  } finally {
    lock.release();
  }
}

async function runSkillRefreshJob(job: SkillRefreshJob): Promise<void> {
  const lock = tryAcquireSlugLock(job.slug, `skills_refresh:${job.slug}:${Date.now()}`);
  if (!lock) {
    patchRuntimeTaskState(job.slug, {
      state: 'failed',
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      taskType: 'train',
      rounds: 0,
      profile: 'full',
      lastError: 'lock already exists for this slug',
    });
    return;
  }

  const startTs = Date.now();
  patchRuntimeTaskState(job.slug, {
    state: 'running',
    taskType: 'train',
    rounds: 0,
    profile: 'full',
    retries: 0,
    startedAt: new Date(startTs).toISOString(),
    finishedAt: undefined,
    lastError: '',
  });
  safeWriteRuntimeProgress(lock, job.slug, {
    stage: 'skill_origin_extract',
    stageLabel: 'Skill 原点提炼',
    percent: 10,
    currentRound: 0,
    totalRounds: 0,
    elapsedSec: 0,
    etaMin: 2,
    etaMax: 8,
  });

  try {
    const { repoRoot, cliEntry } = resolveCliEntry(process.cwd());
    const child = spawn(process.execPath, [cliEntry, 'skills-refresh', job.slug, '--mode', job.mode], {
      cwd: repoRoot,
      env: { ...process.env },
    });
    safePatchRuntimeTaskState(lock, job.slug, { pid: child.pid ?? null, state: 'running' });
    let lockLost = false;
    const heartbeat = setInterval(() => {
      if (!lock.renew()) {
        lockLost = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
        return;
      }
      const current = readRuntimeProgress(job.slug);
      if (!current) return;
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
      safeWriteRuntimeProgress(lock, job.slug, {
        ...current,
        elapsedSec,
      });
    }, LOCK_HEARTBEAT_MS);
    child.stdout.on('data', (buf: Buffer) => {
      const lines = stripAnsi(buf.toString()).split('\n').map((v) => v.trim()).filter(Boolean);
      for (const line of lines) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
        if (line.includes('[SKILL_STAGE] skill_origin_extract')) {
          safeWriteRuntimeProgress(lock, job.slug, {
            stage: 'skill_origin_extract',
            stageLabel: 'Skill 原点提炼',
            percent: 30,
            currentRound: 0,
            totalRounds: 0,
            elapsedSec,
            etaMin: Math.max(0, 4 - Math.ceil(elapsedSec / 60)),
            etaMax: Math.max(0, 10 - Math.ceil(elapsedSec / 60)),
          });
        } else if (line.includes('[SKILL_STAGE] skill_expand')) {
          safeWriteRuntimeProgress(lock, job.slug, {
            stage: 'skill_expand',
            stageLabel: 'Skill 证据融合',
            percent: 62,
            currentRound: 0,
            totalRounds: 0,
            elapsedSec,
            etaMin: Math.max(0, 3 - Math.ceil(elapsedSec / 60)),
            etaMax: Math.max(0, 8 - Math.ceil(elapsedSec / 60)),
          });
        } else if (line.includes('[SKILL_STAGE] skill_merge')) {
          safeWriteRuntimeProgress(lock, job.slug, {
            stage: 'skill_merge',
            stageLabel: 'Skill 蒸馏入库',
            percent: 88,
            currentRound: 0,
            totalRounds: 0,
            elapsedSec,
            etaMin: 1,
            etaMax: 3,
          });
        }
      }
    });

    const code = await new Promise<number>((resolve) => {
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    clearInterval(heartbeat);

    if (code === 0 && !lockLost && lock.isCurrent()) {
      const elapsedSec = Math.max(1, Math.floor((Date.now() - startTs) / 1000));
      safeWriteRuntimeProgress(lock, job.slug, {
        stage: 'done',
        stageLabel: 'Skill 刷新完成',
        percent: 100,
        currentRound: 0,
        totalRounds: 0,
        elapsedSec,
        etaMin: 0,
        etaMax: 0,
      });
      safePatchRuntimeTaskState(lock, job.slug, {
        state: 'done',
        pid: child.pid ?? null,
        finishedAt: new Date().toISOString(),
        lastError: '',
      });
    } else {
      safePatchRuntimeTaskState(lock, job.slug, {
        state: 'failed',
        pid: child.pid ?? null,
        finishedAt: new Date().toISOString(),
        lastError: lockLost ? 'lease lock lost while refreshing skills' : `skills refresh exit code ${code}`,
      });
    }
  } finally {
    lock.release();
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
        if (job.kind === 'train') {
          await runTrainJob(job);
        } else {
          await runSkillRefreshJob(job);
        }
      } finally {
        pendingSlugs.delete(job.slug);
      }
    }
  } finally {
    workerRunning = false;
  }
}

export function enqueueTrainJob(job: Omit<TrainJob, 'kind'>): EnqueueResult {
  if (pendingSlugs.has(job.slug)) return { accepted: false, reason: 'already_queued_or_running' };
  const queuedAhead = queue.length + (workerRunning ? 1 : 0);
  pendingSlugs.add(job.slug);
  patchRuntimeTaskState(job.slug, {
    state: 'queued',
    taskType: 'train',
    rounds: job.rounds,
    profile: job.profile,
    retries: job.retries,
    startedAt: new Date().toISOString(),
    lastError: '',
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
  queue.push({ kind: 'train', ...job });
  void ensureWorker();
  return { accepted: true, queuedAhead };
}

export function enqueueSkillRefreshJob(slug: string): EnqueueResult {
  if (pendingSlugs.has(slug)) return { accepted: false, reason: 'already_queued_or_running' };
  const queuedAhead = queue.length + (workerRunning ? 1 : 0);
  pendingSlugs.add(slug);
  patchRuntimeTaskState(slug, {
    state: 'queued',
    taskType: 'train',
    rounds: 0,
    profile: 'full',
    retries: 0,
    startedAt: new Date().toISOString(),
    lastError: '',
    pid: null,
  });
  writeRuntimeProgress(slug, {
    stage: 'queued',
    stageLabel: 'Skill 刷新排队中',
    percent: 2,
    currentRound: 0,
    totalRounds: 0,
    elapsedSec: 0,
    etaMin: 2,
    etaMax: 8,
  });
  queue.push({ kind: 'skills_refresh', slug, source: 'api', mode: 'quick' });
  void ensureWorker();
  return { accepted: true, queuedAhead };
}

export function enqueueSkillRefreshJobWithMode(slug: string, mode: 'quick' | 'full'): EnqueueResult {
  if (pendingSlugs.has(slug)) return { accepted: false, reason: 'already_queued_or_running' };
  const queuedAhead = queue.length + (workerRunning ? 1 : 0);
  pendingSlugs.add(slug);
  patchRuntimeTaskState(slug, {
    state: 'queued',
    taskType: 'train',
    rounds: 0,
    profile: 'full',
    retries: 0,
    startedAt: new Date().toISOString(),
    lastError: '',
    pid: null,
  });
  writeRuntimeProgress(slug, {
    stage: 'queued',
    stageLabel: `Skill 刷新排队中 (${mode})`,
    percent: 2,
    currentRound: 0,
    totalRounds: 0,
    elapsedSec: 0,
    etaMin: mode === 'quick' ? 2 : 6,
    etaMax: mode === 'quick' ? 8 : 20,
  });
  queue.push({ kind: 'skills_refresh', slug, source: 'api', mode });
  void ensureWorker();
  return { accepted: true, queuedAhead };
}

export function isTrainQueuedOrRunning(slug: string): boolean {
  return pendingSlugs.has(slug);
}

export function readLockHolder(slug: string): string | null {
  const lock = readLeaseLock(slug);
  if (!lock) return null;
  return `${lock.pid}`;
}

function safePatchRuntimeTaskState(lock: LeaseHandle, slug: string, patch: Parameters<typeof patchRuntimeTaskState>[1]): void {
  if (!lock.isCurrent()) return;
  patchRuntimeTaskState(slug, {
    ...patch,
    lastError: patch.lastError,
  });
}

function safeWriteRuntimeProgress(lock: LeaseHandle, slug: string, progress: Parameters<typeof writeRuntimeProgress>[1]): void {
  if (!lock.isCurrent()) return;
  writeRuntimeProgress(slug, progress);
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface RuntimeProgress {
  stage: string;
  stageLabel: string;
  percent: number;
  currentRound: number;
  totalRounds: number;
  elapsedSec: number;
  etaMin: number;
  etaMax: number;
  updatedAt: string;
}

export interface RuntimeTaskState {
  state: 'queued' | 'running' | 'done' | 'failed';
  pid: number | null;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  lastError?: string;
  taskType?: 'create' | 'train';
  rounds?: number;
  profile?: string;
  retries?: number;
  autoRecoveredAt?: string;
  autoRecoverCount?: number;
}

interface EtaStatItem {
  samples: number;
  totalSec: number;
  avgSec: number;
}

interface EtaStats {
  create_quick?: EtaStatItem;
  create_full?: EtaStatItem;
  train_quick?: EtaStatItem;
  train_full?: EtaStatItem;
}

export function getPersonaRoot(): string {
  return join(homedir(), '.neeko', 'personas');
}

export function getProgressPath(slug: string): string {
  return join(getPersonaRoot(), slug, 'runtime-progress.json');
}

export function getTaskStatePath(slug: string): string {
  return join(getPersonaRoot(), slug, 'runtime-task.json');
}

function getRuntimeRoot(): string {
  return join(homedir(), '.neeko', 'runtime');
}

function getEtaStatsPath(): string {
  return join(getRuntimeRoot(), 'eta-stats.json');
}

export function writeRuntimeProgress(slug: string, progress: Omit<RuntimeProgress, 'updatedAt'>): void {
  const dir = join(getPersonaRoot(), slug);
  mkdirSync(dir, { recursive: true });
  const payload: RuntimeProgress = { ...progress, updatedAt: new Date().toISOString() };
  writeFileSync(getProgressPath(slug), JSON.stringify(payload, null, 2), 'utf-8');
}

export function readRuntimeProgress(slug: string): RuntimeProgress | null {
  const path = getProgressPath(slug);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RuntimeProgress;
  } catch {
    return null;
  }
}

export function writeRuntimeTaskState(
  slug: string,
  state: Omit<RuntimeTaskState, 'updatedAt'> & { updatedAt?: string }
): void {
  const dir = join(getPersonaRoot(), slug);
  mkdirSync(dir, { recursive: true });
  const payload: RuntimeTaskState = {
    ...state,
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
  writeFileSync(getTaskStatePath(slug), JSON.stringify(payload, null, 2), 'utf-8');
}

export function patchRuntimeTaskState(slug: string, patch: Partial<RuntimeTaskState>): RuntimeTaskState {
  const prev = readRuntimeTaskState(slug);
  const next: RuntimeTaskState = {
    state: patch.state ?? prev?.state ?? 'queued',
    pid: patch.pid ?? prev?.pid ?? null,
    startedAt: patch.startedAt ?? prev?.startedAt ?? new Date().toISOString(),
    finishedAt: patch.finishedAt ?? prev?.finishedAt,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    lastError: patch.lastError ?? prev?.lastError,
    taskType: patch.taskType ?? prev?.taskType,
    rounds: patch.rounds ?? prev?.rounds,
    profile: patch.profile ?? prev?.profile,
    retries: patch.retries ?? prev?.retries,
    autoRecoveredAt: patch.autoRecoveredAt ?? prev?.autoRecoveredAt,
    autoRecoverCount: patch.autoRecoverCount ?? prev?.autoRecoverCount,
  };
  writeRuntimeTaskState(slug, next);
  return next;
}

export function readRuntimeTaskState(slug: string): RuntimeTaskState | null {
  const path = getTaskStatePath(slug);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RuntimeTaskState;
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getEtaKey(taskType: 'create' | 'train', rounds: number): keyof EtaStats {
  const tier = rounds <= 3 ? 'quick' : 'full';
  return `${taskType}_${tier}` as keyof EtaStats;
}

function readEtaStats(): EtaStats {
  const path = getEtaStatsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as EtaStats;
  } catch {
    return {};
  }
}

function writeEtaStats(stats: EtaStats): void {
  const root = getRuntimeRoot();
  mkdirSync(root, { recursive: true });
  writeFileSync(getEtaStatsPath(), JSON.stringify(stats, null, 2), 'utf-8');
}

export function estimateEtaRangeMinutes(
  taskType: 'create' | 'train',
  rounds: number,
  elapsedSec: number
): { etaMin: number; etaMax: number } {
  const key = getEtaKey(taskType, rounds);
  const stats = readEtaStats();
  const learned = stats[key];
  if (learned && learned.samples >= 2 && learned.avgSec > 0) {
    const minTotal = Math.max(5 * 60, Math.floor(learned.avgSec * 0.7));
    const maxTotal = Math.max(minTotal, Math.ceil(learned.avgSec * 1.3));
    return {
      etaMin: Math.max(0, Math.ceil((minTotal - elapsedSec) / 60)),
      etaMax: Math.max(0, Math.ceil((maxTotal - elapsedSec) / 60)),
    };
  }

  const base = rounds <= 3 ? { min: 15, max: 30 } : rounds <= 10 ? { min: 30, max: 90 } : { min: 60, max: 180 };
  return {
    etaMin: Math.max(0, Math.ceil(base.min - elapsedSec / 60)),
    etaMax: Math.max(0, Math.ceil(base.max - elapsedSec / 60)),
  };
}

export function recordEtaSample(taskType: 'create' | 'train', rounds: number, durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  const key = getEtaKey(taskType, rounds);
  const stats = readEtaStats();
  const prev = stats[key] ?? { samples: 0, totalSec: 0, avgSec: 0 };
  const next: EtaStatItem = {
    samples: prev.samples + 1,
    totalSec: prev.totalSec + durationSec,
    avgSec: (prev.totalSec + durationSec) / (prev.samples + 1),
  };
  stats[key] = next;
  writeEtaStats(stats);
}

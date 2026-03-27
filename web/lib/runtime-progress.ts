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
  state: 'running' | 'done' | 'failed';
  pid: number | null;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  lastError?: string;
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

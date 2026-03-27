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

export function getPersonaRoot(): string {
  return join(homedir(), '.neeko', 'personas');
}

export function getProgressPath(slug: string): string {
  return join(getPersonaRoot(), slug, 'runtime-progress.json');
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


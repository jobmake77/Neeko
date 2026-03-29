import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { readRuntimeProgress, readRuntimeTaskState } from '@/lib/runtime-progress';

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = join(homedir(), '.neeko', 'personas', slug);
  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }

  const progress = readRuntimeProgress(slug);
  const task = readRuntimeTaskState(slug);
  const checkpointIndex = readJson<{ checkpoints?: Array<{ id: string; created_at: string; track: string; stage: string; round: number; path: string }> }>(
    join(dir, 'checkpoint_index.json'),
    {}
  );
  const errors = readJson<Array<{ created_at: string; tag: string; recovery_action: string; recovered: boolean }>>(
    join(dir, 'error_ledger.json'),
    []
  );
  const latestCheckpoint = Array.isArray(checkpointIndex.checkpoints) && checkpointIndex.checkpoints.length > 0
    ? checkpointIndex.checkpoints[checkpointIndex.checkpoints.length - 1]
    : null;

  return NextResponse.json({
    slug,
    stage: progress?.stage ?? 'idle',
    eta: progress ? { min: progress.etaMin, max: progress.etaMax } : null,
    checkpoint: latestCheckpoint,
    failure_state: task?.state === 'failed'
      ? {
          last_error: task.lastError ?? 'unknown',
          recent_errors: errors.slice(-5),
        }
      : null,
    recovery_state: {
      auto_recover_count: task?.autoRecoverCount ?? 0,
      auto_recovered_at: task?.autoRecoveredAt ?? null,
      resumable: !!latestCheckpoint,
    },
    runtime_progress: progress,
    runtime_task: task,
  });
}

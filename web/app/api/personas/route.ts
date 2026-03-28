import { NextResponse } from 'next/server';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isPidAlive, readRuntimeProgress, readRuntimeTaskState } from '@/lib/runtime-progress';
import { maybeAutoRecoverTraining } from '@/lib/auto-recover';

function getDataDir() {
  return join(homedir(), '.neeko', 'personas');
}

function isStalled(
  status: string | undefined,
  runtimeUpdatedAt?: string,
  taskState?: { state: string; pid: number | null; updatedAt: string } | null
): boolean {
  if (status !== 'training') return false;
  if (taskState?.state === 'failed') return true;
  if (taskState?.state === 'running') {
    const alive = isPidAlive(taskState.pid);
    if (alive) return false;
    const lastBeat = new Date(taskState.updatedAt || runtimeUpdatedAt || 0).getTime();
    if (Number.isFinite(lastBeat) && Date.now() - lastBeat > 90 * 1000) return true;
  }
  if (!runtimeUpdatedAt) return true;
  const ts = new Date(runtimeUpdatedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > 15 * 60 * 1000;
}

export async function GET() {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    return NextResponse.json([]);
  }

  const slugs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const personas = slugs
    .map((slug) => {
      const personaPath = join(dir, slug, 'persona.json');
      if (!existsSync(personaPath)) return null;
      const persona = JSON.parse(readFileSync(personaPath, 'utf-8'));
      const runtimeProgress = readRuntimeProgress(slug);
      const taskState = readRuntimeTaskState(slug);
      const stalled = isStalled(persona.status, runtimeProgress?.updatedAt, taskState);
      const recovering = stalled && maybeAutoRecoverTraining(slug, taskState, runtimeProgress);
      return {
        ...persona,
        status: recovering ? 'recovering' : stalled ? 'stalled' : persona.status,
        runtime_progress: runtimeProgress,
        runtime_task: taskState,
      };
    })
    .filter(Boolean);

  return NextResponse.json(personas);
}

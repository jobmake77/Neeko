import { patchRuntimeTaskState, RuntimeProgress, RuntimeTaskState } from './runtime-progress';
import { enqueueTrainJob, isTrainQueuedOrRunning, readLockHolder } from './train-queue';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const recoverCooldown = new Map<string, number>();

function readTrainingContext(slug: string): { requested_rounds?: number; completed_rounds?: number; profile?: string } | null {
  const path = join(homedir(), '.neeko', 'personas', slug, 'training-context.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as {
      requested_rounds?: number;
      completed_rounds?: number;
      profile?: string;
    };
  } catch {
    return null;
  }
}

export function maybeAutoRecoverTraining(
  slug: string,
  taskState: RuntimeTaskState | null,
  runtimeProgress: RuntimeProgress | null
): boolean {
  const now = Date.now();
  const cool = recoverCooldown.get(slug) ?? 0;
  if (now < cool) return false;
  if (isTrainQueuedOrRunning(slug)) return false;

  if (taskState?.state === 'running' && taskState.pid) {
    try {
      process.kill(taskState.pid, 0);
      return false;
    } catch {
      // process dead, continue to recover
    }
  }

  const context = readTrainingContext(slug);
  const autoRecoverCount = taskState?.autoRecoverCount ?? 0;
  const lockConflict = String(taskState?.lastError ?? '').includes('lock already exists');
  const lockHolder = readLockHolder(slug);
  const allowExtraRecover = lockConflict && !lockHolder;
  const totalByContext = context?.requested_rounds ?? 0;
  const doneByContext = context?.completed_rounds ?? 0;
  const totalByRuntime = runtimeProgress?.totalRounds ?? taskState?.rounds ?? 3;
  const currentByRuntime = runtimeProgress?.currentRound ?? 0;
  const total = totalByContext > 0 ? totalByContext : totalByRuntime;
  const current = Math.max(doneByContext, currentByRuntime);
  const remaining = Math.max(1, Math.min(10, total - current));
  const failedButRecoverable = taskState?.state === 'failed' && !lockHolder && total > current;

  // Keep conservative default retries, but allow extra resumes for true interrupted runs.
  if (autoRecoverCount >= 2 && !allowExtraRecover && !failedButRecoverable) return false;
  if (autoRecoverCount >= 20) return false;

  const profile = context?.profile ?? taskState?.profile ?? 'full';

  const enqueued = enqueueTrainJob({
    slug,
    rounds: remaining,
    profile,
    retries: 3,
    source: 'recovery',
    track: 'full_serial',
    mode: remaining <= 3 ? 'quick' : 'full',
  });
  if (!enqueued.accepted) return false;

  recoverCooldown.set(slug, now + (failedButRecoverable ? 60 * 1000 : 30 * 1000));
  patchRuntimeTaskState(slug, {
    state: 'queued',
    taskType: 'train',
    pid: null,
    rounds: remaining,
    profile,
    autoRecoveredAt: new Date().toISOString(),
    autoRecoverCount: autoRecoverCount + 1,
    startedAt: taskState?.startedAt ?? new Date().toISOString(),
    lastError: undefined,
  });
  return true;
}

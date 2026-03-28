import { patchRuntimeTaskState, RuntimeProgress, RuntimeTaskState } from './runtime-progress';
import { enqueueTrainJob, isTrainQueuedOrRunning } from './train-queue';

const recoverCooldown = new Map<string, number>();

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

  const autoRecoverCount = taskState?.autoRecoverCount ?? 0;
  if (autoRecoverCount >= 2) return false;

  const total = runtimeProgress?.totalRounds ?? taskState?.rounds ?? 3;
  const current = runtimeProgress?.currentRound ?? 0;
  const remaining = Math.max(1, Math.min(10, total - current));
  const profile = taskState?.profile ?? 'full';

  const enqueued = enqueueTrainJob({
    slug,
    rounds: remaining,
    profile,
    retries: 3,
    source: 'recovery',
  });
  if (!enqueued.accepted) return false;

  recoverCooldown.set(slug, now + 30 * 1000);
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

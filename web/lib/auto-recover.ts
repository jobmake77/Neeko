import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { patchRuntimeTaskState, RuntimeProgress, RuntimeTaskState } from './runtime-progress';

const recoverCooldown = new Map<string, number>();

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'dist', 'index.js'))) return cwd;
  const parent = join(cwd, '..');
  if (existsSync(join(parent, 'dist', 'index.js'))) return parent;
  return cwd;
}

export function maybeAutoRecoverTraining(
  slug: string,
  taskState: RuntimeTaskState | null,
  runtimeProgress: RuntimeProgress | null
): boolean {
  const now = Date.now();
  const cool = recoverCooldown.get(slug) ?? 0;
  if (now < cool) return false;

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

  const repoRoot = resolveRepoRoot();
  const args = ['dist/index.js', 'train', slug, '--rounds', String(remaining), '--training-profile', profile, '--retries', '3'];

  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  recoverCooldown.set(slug, now + 30 * 1000);
  patchRuntimeTaskState(slug, {
    state: 'running',
    taskType: 'train',
    pid: child.pid ?? null,
    rounds: remaining,
    profile,
    autoRecoveredAt: new Date().toISOString(),
    autoRecoverCount: autoRecoverCount + 1,
    startedAt: taskState?.startedAt ?? new Date().toISOString(),
    lastError: undefined,
  });
  return true;
}


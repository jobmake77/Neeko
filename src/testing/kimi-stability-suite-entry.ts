import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  KimiStabilityMode,
  normalizeKimiStabilityMode,
} from '../core/training/strategy-resolver.js';

async function main() {
  const [
    postsPath,
    handle = 'turingou',
    roundsRaw = '2',
    profile = 'full',
    timeoutRaw = '180000',
    routing = 'v2',
    modesRaw = 'standard,tight_runtime,sparse_director,hybrid',
    optimizationMode = 'auto',
  ] = process.argv.slice(2);

  if (!postsPath) {
    throw new Error(
      'Usage: node dist/testing/kimi-stability-suite-entry.js <posts.json> [handle] [rounds] [profile] [timeoutMs] [routing] [modes] [optimizationMode]'
    );
  }

  const rounds = Math.max(1, parseInt(roundsRaw, 10) || 2);
  const timeoutMs = Math.max(60_000, parseInt(timeoutRaw, 10) || 180_000);
  const modes = resolveModes(modesRaw);
  const entryPath = resolve(dirname(fileURLToPath(import.meta.url)), './kimi-stability-entry.js');
  const provider = process.env.NEEKO_ACTIVE_PROVIDER ?? 'unknown';
  const combinedResults: Array<Record<string, unknown>> = [];

  for (const mode of modes) {
    console.error(`[kimi-stability-suite] mode=${mode} isolated run start`);
    const payload = await runSingleMode({
      entryPath,
      postsPath,
      handle,
      rounds,
      profile,
      timeoutMs,
      routing,
      mode,
      optimizationMode,
    });
    if (combinedResults.length === 0) {
      combinedResults.push(...payload.results.filter((item: any) => item.kind === 'seed'));
    }
    combinedResults.push(...payload.results.filter((item: any) => item.kind !== 'seed'));
    console.error(`[kimi-stability-suite] mode=${mode} isolated run done`);
  }

  process.stdout.write(JSON.stringify({
    handle,
    rounds,
    profile,
    compared_at: new Date().toISOString(),
    provider,
    routing: [routing],
    modes,
    isolated: true,
    results: combinedResults,
  }, null, 2), () => process.exit(0));
}

async function runSingleMode(input: {
  entryPath: string;
  postsPath: string;
  handle: string;
  rounds: number;
  profile: string;
  timeoutMs: number;
  routing: string;
  mode: KimiStabilityMode;
  optimizationMode: string;
}): Promise<{ results: Array<Record<string, unknown>> }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        input.entryPath,
        input.postsPath,
        input.handle,
        String(input.rounds),
        input.profile,
        String(input.timeoutMs),
        input.routing,
        input.mode,
        input.optimizationMode,
      ],
      {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    let finished = false;
    const hardKillMs = input.timeoutMs + 150_000;

    const timer = setTimeout(() => {
      if (finished) return;
      stderr += `\n[kimi-stability-suite] hard timeout after ${hardKillMs}ms`;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, hardKillMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (error) => {
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      finished = true;
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`isolated mode ${input.mode} killed by signal ${signal}\n${stderr}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`isolated mode ${input.mode} exited with code ${code}\n${stderr}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(
            `failed to parse isolated mode ${input.mode} output: ${error instanceof Error ? error.message : String(error)}\nstdout=${stdout}\nstderr=${stderr}`
          )
        );
      }
    });
  });
}

function resolveModes(raw?: string): KimiStabilityMode[] {
  const modes = String(raw ?? '')
    .split(',')
    .map((item) => normalizeKimiStabilityMode(item.trim(), 'auto'))
    .filter((item): item is KimiStabilityMode => item !== 'auto');
  return modes.length > 0 ? Array.from(new Set(modes)) : ['standard', 'tight_runtime', 'sparse_director', 'hybrid'];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

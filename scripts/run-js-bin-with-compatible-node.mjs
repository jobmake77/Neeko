#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter } from 'node:path';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , target, ...args] = process.argv;

if (!target) {
  console.error('Usage: node scripts/run-js-bin-with-compatible-node.mjs <package-or-script> [...args]');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const cwd = process.cwd();
const compatibleNode = ensureCompatibleNode(cwd);
const entry = resolveEntry(target, cwd);

const child = spawn(compatibleNode, [entry, ...args], {
  cwd,
  stdio: 'inherit',
  env: buildChildEnv(compatibleNode),
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function ensureCompatibleNode(workingDirectory) {
  const cacheDir = join(repoRoot, '.neeko-tools', 'compatible-node');
  mkdirSync(cacheDir, { recursive: true });

  const candidates = Array.from(
    new Set(
      [
        process.execPath,
        '/usr/local/bin/node',
        '/opt/homebrew/bin/node',
        '/opt/local/bin/node',
      ].filter((candidate) => candidate && existsSync(candidate))
    )
  );

  for (const candidate of candidates) {
    if (canLoadRollupNative(candidate, workingDirectory)) {
      return candidate;
    }

    const copiedCandidate = copyNodeIntoCache(candidate, cacheDir);
    if (canLoadRollupNative(copiedCandidate, workingDirectory)) {
      return copiedCandidate;
    }
  }

  console.error(`Failed to load Rollup native bindings with all known Node runtimes: ${candidates.join(', ')}`);
  process.exit(1);
}

function copyNodeIntoCache(sourcePath, cacheDir) {
  const sourceStat = statSync(sourcePath);
  const targetPath = join(
    cacheDir,
    `node-${basenameForCache(sourcePath)}-${process.platform}-${process.arch}-${sourceStat.size}-${Math.trunc(sourceStat.mtimeMs)}`
  );

  if (!existsSync(targetPath)) {
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, 0o755);
  }

  return targetPath;
}

function canLoadRollupNative(nodePath, workingDirectory) {
  const probe = [
    'const cwd = process.argv[1];',
    'try {',
    "  const resolved = require.resolve('rollup/dist/native.js', { paths: [cwd] });",
    '  require(resolved);',
    "  process.stdout.write('ok');",
    '} catch (error) {',
    "  if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes('rollup/dist/native.js')) {",
    "    process.stdout.write('skip');",
    '    process.exit(0);',
    '  }',
    "  process.stderr.write(String(error && error.stack ? error.stack : error));",
    '  process.exit(1);',
    '}',
  ].join('\n');

  const result = spawnSync(nodePath, ['-e', probe, workingDirectory], {
    cwd: workingDirectory,
    stdio: 'pipe',
    env: process.env,
    encoding: 'utf8',
  });

  return result.status === 0;
}

function resolveEntry(targetName, workingDirectory) {
  const looksLikeFilePath = (
    targetName.startsWith('.')
    || targetName.startsWith('/')
    || targetName.startsWith('..')
    || targetName.includes('\\')
    || targetName.endsWith('.js')
    || targetName.endsWith('.mjs')
  );

  if (looksLikeFilePath) {
    return resolve(workingDirectory, targetName);
  }

  const requireFromCwd = createRequire(join(workingDirectory, '__compat-node__.cjs'));
  const packageJsonPath = requireFromCwd.resolve(`${targetName}/package.json`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const bin = packageJson.bin;

  if (typeof bin === 'string') {
    return resolve(dirname(packageJsonPath), bin);
  }

  if (bin && typeof bin === 'object') {
    const direct = bin[targetName.split('/').pop()];
    const fallback = Object.values(bin)[0];
    const selected = typeof direct === 'string' ? direct : typeof fallback === 'string' ? fallback : null;
    if (selected) {
      return resolve(dirname(packageJsonPath), selected);
    }
  }

  console.error(`Unable to resolve a runnable bin for package "${targetName}".`);
  process.exit(1);
}

function basenameForCache(value) {
  return value.replaceAll('/', '_').replaceAll('\\', '_').replaceAll(':', '_');
}

function buildChildEnv(nodePath) {
  const pathEntries = [
    dirname(nodePath),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    process.env.PATH ?? '',
  ].filter(Boolean);

  return {
    ...process.env,
    PATH: Array.from(new Set(pathEntries.join(delimiter).split(delimiter).filter(Boolean))).join(delimiter),
  };
}

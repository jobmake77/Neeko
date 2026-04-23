import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = join(repoRoot, 'desktop', 'runtime', 'neeko-runtime');
const runtimeNodeModules = join(runtimeRoot, 'node_modules');
const runtimeBinDir = join(runtimeRoot, 'bin');
const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function log(step) {
  console.log(`[prepare-desktop-runtime] ${step}`);
}

log('resetting staged runtime');
rmSync(runtimeRoot, { recursive: true, force: true });
ensureDir(runtimeRoot);
ensureDir(runtimeBinDir);

log('copying CLI dist bundle');
cpSync(join(repoRoot, 'dist'), join(runtimeRoot, 'dist'), { recursive: true });

log('copying runtime scripts');
cpSync(join(repoRoot, 'scripts'), join(runtimeRoot, 'scripts'), {
  recursive: true,
  filter(source) {
    if (source.endsWith('.DS_Store')) return false;
    return true;
  },
});

log('copying bundled Node runtime');
const nodeBinary = resolvePreferredNodeBinary();
if (!nodeBinary) {
  throw new Error('could not locate node binary for desktop runtime');
}
cpSync(nodeBinary, join(runtimeBinDir, 'node'));
chmodSync(join(runtimeBinDir, 'node'), 0o755);

log('copying installed node_modules');
cpSync(join(repoRoot, 'node_modules'), runtimeNodeModules, {
  recursive: true,
  filter(source) {
    if (source.includes(`${join('node_modules', '.cache')}`)) return false;
    return true;
  },
});

const runtimePackage = {
  name: 'neeko-runtime',
  private: true,
  version: rootPackage.version,
  type: rootPackage.type,
  main: './dist/cli/index.js',
  dependencies: rootPackage.dependencies,
  engines: rootPackage.engines,
};

log('writing runtime package manifest');
writeFileSync(join(runtimeRoot, 'package.json'), JSON.stringify(runtimePackage, null, 2));

log('pruning dev dependencies from staged runtime');
const npmCli = resolveNpmCliPath();
execFileSync(nodeBinary, [npmCli, 'prune', '--omit=dev', '--ignore-scripts'], {
  cwd: runtimeRoot,
  stdio: 'inherit',
});

if (!existsSync(join(runtimeRoot, 'dist', 'cli', 'index.js'))) {
  throw new Error('staged runtime is missing dist/cli/index.js');
}

if (!existsSync(join(runtimeRoot, 'scripts', 'fetch-twitter-corpus.mjs'))) {
  throw new Error('staged runtime is missing scripts/fetch-twitter-corpus.mjs');
}

if (!existsSync(join(runtimeRoot, 'node_modules'))) {
  throw new Error('staged runtime is missing node_modules');
}

if (!existsSync(join(runtimeBinDir, 'node'))) {
  throw new Error('staged runtime is missing bundled node binary');
}

log(`runtime ready at ${runtimeRoot}`);

function resolvePreferredNodeBinary() {
  const candidates = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/opt/local/bin/node',
    process.execPath,
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }

  const fromShell = execSync('command -v node', {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim();
  return fromShell ? realpathSync(fromShell) : null;
}

function resolveNpmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js',
    '/opt/local/lib/node_modules/npm/bin/npm-cli.js',
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }

  throw new Error('could not locate npm-cli.js for desktop runtime pruning');
}

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { execSync } from 'child_process';
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

log('copying bundled Node runtime');
const nodeBinary = execSync('command -v node', {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'ignore'],
  encoding: 'utf8',
}).trim();
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
execSync('npm prune --omit=dev --ignore-scripts', {
  cwd: runtimeRoot,
  stdio: 'inherit',
});

if (!existsSync(join(runtimeRoot, 'dist', 'cli', 'index.js'))) {
  throw new Error('staged runtime is missing dist/cli/index.js');
}

if (!existsSync(join(runtimeRoot, 'node_modules'))) {
  throw new Error('staged runtime is missing node_modules');
}

if (!existsSync(join(runtimeBinDir, 'node'))) {
  throw new Error('staged runtime is missing bundled node binary');
}

log(`runtime ready at ${runtimeRoot}`);

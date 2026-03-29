import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export interface CliEntryResolution {
  repoRoot: string;
  cliEntry: string;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(MODULE_DIR, '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');

export function resolveCliEntry(): CliEntryResolution {
  return {
    repoRoot: REPO_ROOT,
    cliEntry: 'dist/cli/index.js',
  };
}

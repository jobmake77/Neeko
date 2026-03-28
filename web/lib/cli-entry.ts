import { existsSync } from 'fs';
import { join } from 'path';

export interface CliEntryResolution {
  repoRoot: string;
  cliEntry: string;
}

export function resolveCliEntry(startCwd = process.cwd()): CliEntryResolution {
  const roots = [startCwd, join(startCwd, '..')];
  const entries = ['dist/cli/index.js', 'dist/index.js'];
  for (const root of roots) {
    for (const entry of entries) {
      if (existsSync(join(root, entry))) {
        return { repoRoot: root, cliEntry: entry };
      }
    }
  }
  // fallback for predictable error behavior
  return { repoRoot: roots[0], cliEntry: 'dist/cli/index.js' };
}

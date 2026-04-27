import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settings } from '../../dist/testing/train-test-entry.js';

let dataDirLock = Promise.resolve();

export async function withTempDataDir(prefix, run) {
  const execute = async () => {
    const previousDataDir = settings.get('neekoDataDir');
    const dataDir = mkdtempSync(join(tmpdir(), prefix));
    settings.set('neekoDataDir', dataDir);

    try {
      return await run(dataDir);
    } finally {
      if (previousDataDir) {
        settings.set('neekoDataDir', previousDataDir);
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  };

  const next = dataDirLock.then(execute, execute);
  dataDirLock = next.then(() => undefined, () => undefined);
  return next;
}

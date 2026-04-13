import { WorkbenchService } from '../../core/workbench/service.js';

interface WorkbenchSourceSyncOptions {
  mode?: string;
}

export async function cmdWorkbenchSourceSync(
  slug: string,
  options: WorkbenchSourceSyncOptions = {},
  cliEntryPath = process.argv[1]
): Promise<void> {
  const service = new WorkbenchService(undefined, cliEntryPath, process.cwd());
  const mode = options.mode === 'incremental_sync' ? 'incremental_sync' : 'deep_fetch';
  await service.runSourceSyncForeground(slug, mode);
}

import { WorkbenchService } from '../../core/workbench/service.js';

export async function cmdWorkbenchCreatePersona(
  slug: string,
  cliEntryPath = process.argv[1]
): Promise<void> {
  const service = new WorkbenchService(undefined, cliEntryPath, process.cwd());
  await service.runCreatePersonaForeground(slug);
}

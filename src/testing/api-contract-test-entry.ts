import { WorkbenchService } from '../core/workbench/service.js';

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

function hasKeys(value: unknown, keys: string[]): boolean {
  return Boolean(value && typeof value === 'object' && keys.every((key) => key in (value as Record<string, unknown>)));
}

async function main() {
  const service = new WorkbenchService();
  const checks: Check[] = [];

  const modelConfig = service.getRuntimeModelConfig();
  checks.push({
    name: 'runtime-model-config',
    ok: hasKeys(modelConfig, ['provider', 'model', 'api_keys']),
  });

  const runtimeSettings = service.getRuntimeSettings();
  checks.push({
    name: 'runtime-settings',
    ok: hasKeys(runtimeSettings, ['data_dir']),
  });

  const personas = service.listPersonas();
  checks.push({
    name: 'personas-list-shape',
    ok: Array.isArray(personas) && personas.every((item) => hasKeys(item, ['slug', 'name', 'status', 'updated_at'])),
    detail: `count=${personas.length}`,
  });

  const cultivating = service.listCultivatingPersonas();
  checks.push({
    name: 'cultivating-filter',
    ok: Array.isArray(cultivating) && cultivating.every((item) => !item.is_ready),
    detail: `count=${cultivating.length}`,
  });

  if (cultivating[0]) {
    const detail = service.getCultivationDetail(cultivating[0].slug);
    checks.push({
      name: 'cultivation-detail-shape',
      ok: hasKeys(detail, ['persona', 'progress', 'phase', 'source_summary']),
      detail: detail.phase,
    });
  }

  const failed = checks.filter((item) => !item.ok);
  for (const check of checks) {
    const prefix = check.ok ? 'PASS' : 'FAIL';
    console.log(`${prefix} ${check.name}${check.detail ? ` :: ${check.detail}` : ''}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();

import { invoke } from '@tauri-apps/api/core';

export interface BootstrapResult {
  status: string;
  port?: number;
}

export async function bootstrapWorkbench(port = 4310, repoRoot?: string): Promise<BootstrapResult> {
  try {
    const status = await invoke<string>('bootstrap_workbench_service', { port, repoRoot });
    return { status, port };
  } catch (e) {
    return { status: 'error' };
  }
}

export async function getWorkbenchStatus(): Promise<{ node_available: boolean; dist_ready: boolean }> {
  try {
    return await invoke('get_workbench_bootstrap_status');
  } catch {
    return { node_available: false, dist_ready: false };
  }
}

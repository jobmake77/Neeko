import { invoke } from '@tauri-apps/api/core';

export interface BootstrapResult {
  status: string;
  port?: number;
}

export interface WorkbenchBootstrapStatus {
  mode?: string;
  resolved_runtime_root?: string | null;
  node_available: boolean;
  node_source?: string;
  dist_ready: boolean;
  service_managed?: boolean;
  message?: string;
}

export async function bootstrapWorkbench(port = 4310, repoRoot?: string): Promise<BootstrapResult> {
  const candidatePorts = Array.from(new Set([port, 4310, 4311, 4312, 4313]));
  for (const candidatePort of candidatePorts) {
    try {
      const payload = await invoke<{ status: string; port?: number }>('bootstrap_workbench_service', {
        port: candidatePort,
        repoRoot,
      });
      return {
        status: payload.status,
        port: payload.port ?? candidatePort,
      };
    } catch {
      // Try the next local fallback port.
    }
  }
  return { status: 'error' };
}

export async function getWorkbenchStatus(): Promise<WorkbenchBootstrapStatus> {
  try {
    return await invoke('get_workbench_bootstrap_status');
  } catch {
    return { node_available: false, dist_ready: false };
  }
}

export async function pickFiles(options?: {
  multiple?: boolean;
  directory?: boolean;
}): Promise<string[]> {
  try {
    return await invoke('pick_files', { request: options ?? {} });
  } catch {
    return [];
  }
}

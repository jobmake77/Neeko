export interface WorkbenchHealthStatus {
  ok?: boolean;
  build_id?: string;
  server_version?: string;
}

export interface ProbeFetchInit {
  signal?: unknown;
}

export interface AbortControllerLike {
  signal: unknown;
  abort(): void;
}

export interface BootstrapResult {
  status: string;
  port?: number;
}

export interface ProbeWorkbenchBaseUrlOptions {
  timeoutMs?: number;
  fetchJsonFromBase<T>(baseUrl: string, path: string, init?: ProbeFetchInit): Promise<T>;
  createAbortController?: () => AbortControllerLike;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface WaitForWorkbenchHealthOptions {
  baseUrl: string;
  probe(baseUrl: string, timeoutMs: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  maxAttempts?: number;
  timeoutBaseMs?: number;
  timeoutStepMs?: number;
  backoffStepMs?: number;
}

export interface RecoverLocalWorkbenchOptions {
  currentBaseUrl: string;
  setBaseUrl(baseUrl: string): void;
  probe(baseUrl: string, timeoutMs: number): Promise<boolean>;
  bootstrap(port: number): Promise<BootstrapResult>;
  sleep(ms: number): Promise<void>;
  forceBootstrap?: boolean;
  localPortCandidates?: number[];
}

export const DEFAULT_LOCAL_PORT_CANDIDATES = [4310, 4311, 4312, 4313];

export function buildLocalBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function normalizeLocalBaseUrl(url: string): string {
  const match = String(url).trim().match(/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)$/i);
  return match ? buildLocalBaseUrl(Number(match[1])) : String(url).trim();
}

export function isLocalWorkbenchBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(normalizeLocalBaseUrl(baseUrl));
}

export function getCurrentLocalPort(baseUrl: string): number | undefined {
  const normalized = normalizeLocalBaseUrl(baseUrl);
  const match = normalized.match(/:(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

export async function probeWorkbenchBaseUrl(
  baseUrl: string,
  options: ProbeWorkbenchBaseUrlOptions,
): Promise<boolean> {
  const controller = (options.createAbortController ?? (() => new AbortController()))();
  const setTimeoutFn = options.setTimeoutFn ?? ((handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const timer = setTimeoutFn(() => controller.abort(), options.timeoutMs ?? 2500);
  try {
    const health = await options.fetchJsonFromBase<WorkbenchHealthStatus>(baseUrl, '/health', {
      signal: controller.signal,
    });
    if (!health.ok || !health.build_id || !health.server_version) return false;
    await options.fetchJsonFromBase<unknown[]>(baseUrl, '/api/personas', {
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeoutFn(timer);
  }
}

export async function waitForWorkbenchHealth(options: WaitForWorkbenchHealthOptions): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 8;
  const timeoutBaseMs = options.timeoutBaseMs ?? 2500;
  const timeoutStepMs = options.timeoutStepMs ?? 250;
  const backoffStepMs = options.backoffStepMs ?? 300;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await options.probe(options.baseUrl, timeoutBaseMs + (attempt * timeoutStepMs))) {
      return true;
    }
    await options.sleep(backoffStepMs * (attempt + 1));
  }
  return false;
}

export async function recoverLocalWorkbenchBaseUrl(options: RecoverLocalWorkbenchOptions): Promise<boolean> {
  const currentBaseUrl = normalizeLocalBaseUrl(options.currentBaseUrl);
  if (!isLocalWorkbenchBaseUrl(currentBaseUrl)) return false;

  if (!options.forceBootstrap) {
    const currentHealthy = await waitForWorkbenchHealth({
      baseUrl: currentBaseUrl,
      probe: options.probe,
      sleep: options.sleep,
      maxAttempts: 1,
    });
    if (currentHealthy) return true;
  }

  const currentPort = getCurrentLocalPort(currentBaseUrl);
  const candidatePorts = [
    ...(currentPort ? [currentPort] : []),
    ...(options.localPortCandidates ?? DEFAULT_LOCAL_PORT_CANDIDATES),
  ].filter((port, index, list) => list.indexOf(port) === index);

  for (const port of candidatePorts) {
    const baseUrl = buildLocalBaseUrl(port);
    if (await waitForWorkbenchHealth({
      baseUrl,
      probe: options.probe,
      sleep: options.sleep,
      maxAttempts: 1,
    })) {
      options.setBaseUrl(baseUrl);
      return true;
    }
  }

  for (const port of candidatePorts) {
    const bootstrap = await options.bootstrap(port).catch(() => ({ status: 'error', port }));
    const resolvedPort = bootstrap.port ?? port;
    const baseUrl = buildLocalBaseUrl(resolvedPort);
    if (await waitForWorkbenchHealth({
      baseUrl,
      probe: options.probe,
      sleep: options.sleep,
    })) {
      options.setBaseUrl(baseUrl);
      return true;
    }
  }

  return false;
}

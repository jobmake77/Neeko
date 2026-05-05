import test from 'node:test';
import assert from 'node:assert/strict';
import { __desktopApiTestables } from '../dist/testing/desktop-api-test-entry.js';

const {
  buildLocalBaseUrl,
  inspectLocalWorkbenchDiagnostics,
  probeWorkbenchBaseUrl,
  recoverLocalWorkbenchBaseUrl,
} = __desktopApiTestables;

test('probeWorkbenchBaseUrl accepts healthy responders without probing personas endpoint', async () => {
  const calls = [];
  let timerCleared = false;

  const ok = await probeWorkbenchBaseUrl('http://127.0.0.1:4310', {
    timeoutMs: 1500,
    fetchJsonFromBase: async (baseUrl, path, init) => {
      calls.push({ baseUrl, path, hasSignal: Boolean(init?.signal) });
      if (path === '/health') {
        return { ok: true, build_id: 'local-dev', server_version: '1.2.3' };
      }
      throw new Error(`unexpected path: ${path}`);
    },
    createAbortController: () => ({
      signal: { aborted: false },
      abort() {},
    }),
    setTimeoutFn: () => 'timer-handle',
    clearTimeoutFn: (handle) => {
      timerCleared = handle === 'timer-handle';
    },
  });

  assert.equal(ok, true);
  assert.equal(timerCleared, true);
  assert.deepEqual(calls.map((item) => item.path), ['/health']);
  assert.equal(calls.every((item) => item.hasSignal), true);
});

test('recoverLocalWorkbenchBaseUrl switches to a healthy fallback port without bootstrapping', async () => {
  const probes = [];
  const bootstraps = [];
  const resolvedBaseUrls = [];

  const recovered = await recoverLocalWorkbenchBaseUrl({
    currentBaseUrl: 'http://localhost:4310',
    setBaseUrl: (baseUrl) => resolvedBaseUrls.push(baseUrl),
    probe: async (baseUrl) => {
      probes.push(baseUrl);
      return baseUrl === buildLocalBaseUrl(4311);
    },
    bootstrap: async (port) => {
      bootstraps.push(port);
      return { status: 'error', port };
    },
    sleep: async () => undefined,
  });

  assert.equal(recovered, true);
  assert.deepEqual(bootstraps, []);
  assert.equal(resolvedBaseUrls.at(-1), 'http://127.0.0.1:4311');
  assert.deepEqual(
    probes,
    [
      'http://127.0.0.1:4310',
      'http://127.0.0.1:4310',
      'http://127.0.0.1:4311',
    ],
  );
});

test('recoverLocalWorkbenchBaseUrl bootstraps and adopts the resolved fallback port when probes initially fail', async () => {
  const probes = [];
  const bootstraps = [];
  const resolvedBaseUrls = [];
  const successfulProbeUrls = new Set();

  const recovered = await recoverLocalWorkbenchBaseUrl({
    currentBaseUrl: 'http://127.0.0.1:4310',
    forceBootstrap: true,
    setBaseUrl: (baseUrl) => resolvedBaseUrls.push(baseUrl),
    probe: async (baseUrl) => {
      probes.push(baseUrl);
      return successfulProbeUrls.has(baseUrl);
    },
    bootstrap: async (port) => {
      bootstraps.push(port);
      if (port === 4310) {
        successfulProbeUrls.add('http://127.0.0.1:4311');
        return { status: 'started', port: 4311 };
      }
      return { status: 'error', port };
    },
    sleep: async () => undefined,
  });

  assert.equal(recovered, true);
  assert.deepEqual(bootstraps, [4310]);
  assert.equal(resolvedBaseUrls.at(-1), 'http://127.0.0.1:4311');
  assert.equal(probes.includes('http://127.0.0.1:4311'), true);
});

test('recoverLocalWorkbenchBaseUrl recovers from an occupied primary port by adopting a later healthy fallback', async () => {
  const probes = [];
  const bootstraps = [];
  const resolvedBaseUrls = [];
  const successfulProbeUrls = new Set();

  const recovered = await recoverLocalWorkbenchBaseUrl({
    currentBaseUrl: 'http://127.0.0.1:4310',
    forceBootstrap: true,
    setBaseUrl: (baseUrl) => resolvedBaseUrls.push(baseUrl),
    probe: async (baseUrl) => {
      probes.push(baseUrl);
      return successfulProbeUrls.has(baseUrl);
    },
    bootstrap: async (port) => {
      bootstraps.push(port);
      if (port === 4310) {
        successfulProbeUrls.add('http://127.0.0.1:4312');
        return { status: 'started', port: 4312 };
      }
      return { status: 'error', port };
    },
    sleep: async () => undefined,
  });

  assert.equal(recovered, true);
  assert.deepEqual(bootstraps, [4310]);
  assert.equal(resolvedBaseUrls.at(-1), 'http://127.0.0.1:4312');
  assert.equal(probes.includes('http://127.0.0.1:4312'), true);
});

test('recoverLocalWorkbenchBaseUrl treats an unhealthy 4310 listener as stale and adopts a healthy 4311 fallback', async () => {
  const probes = [];
  const resolvedBaseUrls = [];

  const recovered = await recoverLocalWorkbenchBaseUrl({
    currentBaseUrl: 'http://localhost:4310',
    setBaseUrl: (baseUrl) => resolvedBaseUrls.push(baseUrl),
    probe: async (baseUrl) => {
      probes.push(baseUrl);
      return baseUrl === buildLocalBaseUrl(4311);
    },
    bootstrap: async () => {
      throw new Error('bootstrap should not run when a healthy fallback already exists');
    },
    sleep: async () => undefined,
  });

  assert.equal(recovered, true);
  assert.equal(resolvedBaseUrls.at(-1), 'http://127.0.0.1:4311');
  assert.equal(probes.includes('http://127.0.0.1:4310'), true);
  assert.equal(probes.includes('http://127.0.0.1:4311'), true);
});

test('settings runtime diagnostics surface stale 4310 debug listener details when fallback is active', async () => {
  const diagnostics = await inspectLocalWorkbenchDiagnostics({
    currentBaseUrl: 'http://127.0.0.1:4311',
    fetchJsonFromBase: async (baseUrl, path) => {
      assert.equal(path, '/health');
      if (baseUrl === buildLocalBaseUrl(4311)) {
        return { ok: true, build_id: 'healthy-4311', server_version: '1.2.3' };
      }
      throw new Error(`unhealthy listener at ${baseUrl}`);
    },
    createAbortController: () => ({
      signal: { aborted: false },
      abort() {},
    }),
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => undefined,
  });

  assert.equal(diagnostics.current_port, 4311);
  assert.equal(diagnostics.healthy_port, 4311);
  assert.equal(diagnostics.fallback_active, true);
  assert.equal(diagnostics.stale_debug_port_4310, true);
  assert.match(diagnostics.stale_debug_summary ?? '', /4310/);
  assert.match(diagnostics.stale_debug_summary ?? '', /切换/);
});

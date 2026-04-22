import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesRoot = join(__dirname, 'fixtures', 'benchmarks');
const registryRoot = join(fixturesRoot, 'packs');
const validPackDir = join(registryRoot, 'persona-core-v1');
const invalidPackDir = join(registryRoot, 'persona-core-invalid-v1');

async function importOptional(modulePath) {
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' ||
      error?.code === 'MODULE_NOT_FOUND' ||
      String(error?.message ?? '').includes('Cannot find module')
    ) {
      return null;
    }
    throw error;
  }
}

function pickPackApi(mod) {
  if (!mod) return {};
  return {
    loadBenchmarkPack:
      mod.loadBenchmarkPack ??
      mod.loadPack ??
      mod.resolveBenchmarkPack ??
      mod.loadBenchmarkPackByIdOrPath ??
      null,
    validateBenchmarkPack:
      mod.validateBenchmarkPack ??
      mod.validatePack ??
      mod.assertValidBenchmarkPack ??
      null,
  };
}

async function callWithVariants(fn, variants) {
  let lastError = null;
  for (const makeArgs of variants) {
    try {
      const args = makeArgs();
      return await fn(...args);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('no invocation variants provided');
}

async function loadPack(loadBenchmarkPack, ref) {
  return callWithVariants(loadBenchmarkPack, [
    () => [{ packIdOrPath: ref, registryRoot }],
    () => [{ packIdOrPath: ref, registryRoot: fixturesRoot }],
    () => [{ pack: ref, registryRoot }],
    () => [{ pack: ref, registryRoot: fixturesRoot }],
    () => [{ idOrPath: ref, registryRoot }],
    () => [{ idOrPath: ref, registryRoot: fixturesRoot }],
    () => [ref, { registryRoot }],
    () => [ref, { registryRoot: fixturesRoot }],
    () => [ref],
  ]);
}

async function validatePack(validateBenchmarkPack, loaded) {
  return callWithVariants(validateBenchmarkPack, [
    () => [loaded],
    () => [{ pack: loaded }],
  ]);
}

function summarizeLoadedPack(loaded) {
  const pack = loaded?.pack ?? loaded?.manifest ?? loaded ?? {};
  const cases = loaded?.cases ?? loaded?.case_entries ?? loaded?.caseEntries ?? [];
  const labels = loaded?.labels ?? loaded?.case_labels ?? loaded?.caseLabels ?? loaded?.expectations ?? [];
  return {
    packId: pack.pack_id ?? pack.id ?? null,
    packVersion: pack.pack_version ?? pack.version ?? null,
    suiteTier: pack.suite_tier ?? pack.tier ?? null,
    suiteType: pack.suite_type ?? pack.type ?? null,
    cases,
    labels,
  };
}

async function requireBenchmarkPackApi(t) {
  const mod =
    (await importOptional(join(__dirname, '..', 'dist', 'testing', 'benchmark-pack-test-entry.js'))) ??
    (await importOptional(join(__dirname, '..', 'dist', 'core', 'training', 'benchmark-pack.js')));
  if (!mod) {
    t.skip('Blocker: benchmark-pack test entry is not built yet.');
    return null;
  }
  const api = pickPackApi(mod);
  if (!api.loadBenchmarkPack) {
    t.skip('Blocker: benchmark-pack module exists, but no loader export is available for tests.');
    return null;
  }
  if (!api.validateBenchmarkPack) {
    t.skip('Blocker: benchmark-pack module exists, but no validator export is available for tests.');
    return null;
  }
  return api;
}

test('benchmark pack loader accepts a valid fixture pack by path', async (t) => {
  const api = await requireBenchmarkPackApi(t);
  if (!api) return;

  const loaded = await loadPack(api.loadBenchmarkPack, validPackDir);
  await validatePack(api.validateBenchmarkPack, loaded);
  const summary = summarizeLoadedPack(loaded);

  assert.equal(summary.packId, 'persona-core-v1');
  assert.equal(summary.packVersion, '2026-04-22');
  assert.equal(summary.suiteTier, 'official');
  assert.equal(summary.suiteType, 'official_benchmark');
  assert.equal(summary.cases.length, 2);
  assert.equal(summary.labels.length, 2);
});

test('benchmark pack loader can resolve a valid fixture pack by id from a custom registry root', async (t) => {
  const api = await requireBenchmarkPackApi(t);
  if (!api) return;

  const loaded = await loadPack(api.loadBenchmarkPack, 'persona-core-v1');
  await validatePack(api.validateBenchmarkPack, loaded);
  const summary = summarizeLoadedPack(loaded);

  assert.equal(summary.packId, 'persona-core-v1');
  assert.equal(summary.packVersion, '2026-04-22');
  assert.equal(summary.cases.length, 2);
});

test('benchmark pack validator rejects label rows that do not map to declared cases', async (t) => {
  const api = await requireBenchmarkPackApi(t);
  if (!api) return;

  await assert.rejects(
    async () => {
      const loaded = await loadPack(api.loadBenchmarkPack, invalidPackDir);
      await validatePack(api.validateBenchmarkPack, loaded);
    },
    /label|case[_ ]?id|missing|unknown/i
  );
});

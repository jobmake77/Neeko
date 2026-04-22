import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const significanceSourcePath = fileURLToPath(new URL('../src/core/training/significance.ts', import.meta.url));
const fixturePath = join(repoRoot, 'test', 'fixtures', 'benchmarks', 'significance', 'paired-bootstrap-edge.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

let significanceModulePromise;

async function importOptional(specifier) {
  try {
    return await import(specifier);
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

async function loadSignificanceModule() {
  if (!significanceModulePromise) {
    significanceModulePromise = (async () => {
      if (!existsSync(significanceSourcePath)) return null;
      const esbuild = await importOptional('esbuild');
      if (!esbuild?.build) return null;

      const tempDir = await mkdtemp(join(repoRoot, '.tmp-significance-'));
      const entryPath = join(tempDir, 'significance-entry.ts');
      const outfile = join(tempDir, 'significance-entry.mjs');
      await writeFile(entryPath, `export * from ${JSON.stringify(significanceSourcePath)};\n`, 'utf8');
      await esbuild.build({
        entryPoints: [entryPath],
        outfile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        packages: 'external',
        absWorkingDir: repoRoot,
        logLevel: 'silent',
      });
      return import(pathToFileURL(outfile).href);
    })();
  }

  return significanceModulePromise;
}

async function requireSignificanceApi(t) {
  const mod = await loadSignificanceModule();
  if (!mod) {
    t.skip('Blocker: significance module is not available yet.');
    return null;
  }
  const api = mod.__significanceTestables ?? mod;
  const compute =
    api.computeBenchmarkSignificance ??
    api.buildBenchmarkSignificanceSummary ??
    api.summarizeBenchmarkSignificance ??
    api.pairedBootstrapSignificance ??
    null;
  const buildGovernance = api.buildBenchmarkGovernanceSummary ?? null;
  if (!compute) {
    t.skip('Blocker: significance module exists, but no public significance summary function is testable yet.');
    return null;
  }
  return { compute, buildGovernance };
}

async function callWithVariants(fn, scenario) {
  const variants = [
    () => [
      {
        replicasA: scenario.replicas_a,
        replicasB: scenario.replicas_b,
        metric: fixture.metric,
        method: fixture.method,
        bootstrapSamples: fixture.bootstrap_samples,
      },
    ],
    () => [
      {
        a: scenario.replicas_a,
        b: scenario.replicas_b,
        metric: fixture.metric,
        method: fixture.method,
        bootstrap_samples: fixture.bootstrap_samples,
      },
    ],
    () => [
      scenario.replicas_a,
      scenario.replicas_b,
      {
        metric: fixture.metric,
        method: fixture.method,
        bootstrapSamples: fixture.bootstrap_samples,
      },
    ],
  ];

  let lastError = null;
  for (const makeArgs of variants) {
    try {
      return await fn(...makeArgs());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('no significance invocation variant succeeded');
}

function normalizeSummary(raw) {
  const summary = raw?.benchmark_significance ?? raw?.summary ?? raw;
  if (summary == null) return null;
  return {
    method: summary.method ?? summary.significance_method ?? null,
    metric: summary.metric ?? null,
    replicasA: summary.replicas_a ?? summary.replicasA ?? null,
    replicasB: summary.replicas_b ?? summary.replicasB ?? null,
    deltaMean: summary.delta_mean ?? summary.deltaMean ?? summary.mean_delta ?? null,
    ciLow: summary.ci_low ?? summary.ciLow ?? summary.confidence_interval?.low ?? null,
    ciHigh: summary.ci_high ?? summary.ciHigh ?? summary.confidence_interval?.high ?? null,
    significant: summary.significant ?? summary.is_significant ?? null,
    favors: summary.favors ?? summary.winner ?? null,
    status: summary.status ?? summary.significance_status ?? null,
  };
}

function scenario(name) {
  const found = fixture.scenarios.find((item) => item.name === name);
  if (!found) {
    throw new Error(`unknown significance fixture scenario "${name}"`);
  }
  return found;
}

test('paired bootstrap summary marks clear improvement as significant', async (t) => {
  const api = await requireSignificanceApi(t);
  if (!api) return;

  const summary = normalizeSummary(await callWithVariants(api.compute, scenario('improved')));
  assert.ok(summary, 'significance summary should be returned for improved scenario');
  assert.equal(summary.method, 'paired_bootstrap');
  assert.equal(summary.metric, 'benchmark_overall');
  assert.equal(summary.replicasA, 3);
  assert.equal(summary.replicasB, 3);
  assert.equal(summary.significant, true);
  assert.ok(summary.deltaMean > 0);
  assert.ok(summary.ciLow > 0);
  assert.ok(summary.ciHigh > 0);
  assert.ok(summary.favors === 'b' || summary.status === 'improved');
});

test('paired bootstrap summary marks clear regression as significant in favor of baseline', async (t) => {
  const api = await requireSignificanceApi(t);
  if (!api) return;

  const summary = normalizeSummary(await callWithVariants(api.compute, scenario('regressed')));
  assert.ok(summary, 'significance summary should be returned for regressed scenario');
  assert.equal(summary.method, 'paired_bootstrap');
  assert.equal(summary.replicasA, 3);
  assert.equal(summary.replicasB, 3);
  assert.equal(summary.significant, true);
  assert.ok(summary.deltaMean < 0);
  assert.ok(summary.ciHigh < 0);
  assert.ok(summary.favors === 'a' || summary.status === 'regressed');
});

test('paired bootstrap summary keeps overlapping evidence as not significant', async (t) => {
  const api = await requireSignificanceApi(t);
  if (!api) return;

  const summary = normalizeSummary(await callWithVariants(api.compute, scenario('not_significant')));
  assert.ok(summary, 'significance summary should be returned for overlapping scenario');
  assert.equal(summary.method, 'paired_bootstrap');
  assert.equal(summary.replicasA, 3);
  assert.equal(summary.replicasB, 3);
  assert.equal(summary.significant, false);
  assert.ok(summary.ciLow <= 0);
  assert.ok(summary.ciHigh >= 0);
  assert.ok(summary.favors === 'neither' || summary.status === 'not_significant');
});

test('significance flow does not overclaim when replica evidence is insufficient', async (t) => {
  const api = await requireSignificanceApi(t);
  if (!api) return;

  const raw = await callWithVariants(api.compute, scenario('insufficient_evidence'));
  if (raw == null) {
    assert.equal(raw, null);
    return;
  }

  const summary = normalizeSummary(raw);
  assert.ok(summary, 'insufficient evidence should return a summary or null');
  assert.ok(summary.replicasA === 1 || summary.replicasA === null);
  assert.ok(summary.replicasB === 1 || summary.replicasB === null);
  assert.ok(summary.status === 'insufficient_evidence' || summary.significant === false);
  if (summary.ciLow !== null && summary.ciHigh !== null) {
    assert.ok(summary.ciLow <= 0);
    assert.ok(summary.ciHigh >= 0);
  }
});

test('governance stays provisional when benchmark significance evidence is insufficient', async (t) => {
  const api = await requireSignificanceApi(t);
  if (!api?.buildGovernance) {
    t.skip('Blocker: governance summary builder is not available yet.');
    return;
  }

  const governance = api.buildGovernance({
    pack: {
      pack_id: 'persona-core-v1',
      pack_version: '2026-04-22',
      status: 'official',
    },
    judgeMode: 'benchmark_dual',
    homogeneity: {
      homogeneous: true,
      reasons: [],
      manifest_versions: ['benchmark-case-manifest-v1'],
      freeze_levels: ['frozen_cases'],
      suite_labels: ['official_benchmark:persona-core-v1'],
      pack_versions: ['2026-04-22'],
      provider_fingerprints: ['provider-demo'],
      runtime_fingerprints: ['runtime-demo'],
      judge_fingerprints: ['judge-demo'],
    },
    replicaSummary: {
      version: 'benchmark-replica-summary-v1',
      replica_group: 'demo',
      metric: 'benchmark_overall',
      replica_count: 1,
      clean_replica_count: 1,
      excluded_replica_count: 0,
      benchmark_overall: { mean: 0.8, min: 0.8, max: 0.8, range: 0, stddev: 0 },
      avg_quality: { mean: 0.8, min: 0.8, max: 0.8, range: 0, stddev: 0 },
      coverage: { mean: 0.8, min: 0.8, max: 0.8, range: 0, stddev: 0 },
      contradiction_rate: { mean: 0.1, min: 0.1, max: 0.1, range: 0, stddev: 0 },
      duplication_rate: { mean: 0.1, min: 0.1, max: 0.1, range: 0, stddev: 0 },
      pass_rate: { mean: 0.8, min: 0.8, max: 0.8, range: 0, stddev: 0 },
      disputed_rate: { mean: 0, min: 0, max: 0, range: 0, stddev: 0 },
      disagreement_rate: { mean: 0, min: 0, max: 0, range: 0, stddev: 0 },
    },
    significance: {
      version: 'benchmark-significance-v1',
      method: 'paired_bootstrap',
      metric: 'benchmark_overall',
      replicas_a: 1,
      replicas_b: 1,
      clean_pairs: 1,
      bootstrap_samples: 1000,
      delta_mean: null,
      ci_low: null,
      ci_high: null,
      significant: false,
      significance_status: 'insufficient_evidence',
      favors: 'neither',
      explanation: 'paired bootstrap requires at least 2 clean replica pairs',
    },
    requiredMinCleanReplicas: 1,
    judgeDisagreementRate: 0,
  });

  assert.equal(governance.significance_status, 'insufficient_evidence');
  assert.equal(governance.promotion_readiness, 'provisional');
});

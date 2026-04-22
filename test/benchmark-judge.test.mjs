import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const agentSourcePath = fileURLToPath(new URL('../src/core/agents/index.ts', import.meta.url));

let evaluatorAgentModulePromise;

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

async function loadEvaluatorAgentModule() {
  if (!evaluatorAgentModulePromise) {
    evaluatorAgentModulePromise = (async () => {
      const esbuild = await importOptional('esbuild');
      if (!esbuild?.build) return null;

      const tempDir = await mkdtemp(join(repoRoot, '.tmp-benchmark-judge-'));
      const entryPath = join(tempDir, 'benchmark-judge-entry.ts');
      const outfile = join(tempDir, 'benchmark-judge-entry.mjs');
      await writeFile(
        entryPath,
        `export { EvaluatorAgent } from ${JSON.stringify(agentSourcePath)};\n`,
        'utf8'
      );
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

  return evaluatorAgentModulePromise;
}

async function requireEvaluatorAgent(t) {
  const mod = await loadEvaluatorAgentModule();
  if (!mod?.EvaluatorAgent) {
    t.skip('Blocker: no testable EvaluatorAgent export is available for benchmark-judge tests.');
    return null;
  }
  return mod.EvaluatorAgent;
}

function evaluation(overrides = {}) {
  return {
    consistency_score: 0.7,
    authenticity_score: 0.72,
    depth_score: 0.68,
    overall_score: 0.71,
    verdict: 'reinforce',
    insights: ['consistent and grounded'],
    new_memory_candidates: [],
    ...overrides,
  };
}

test('benchmark judge single-judge mode returns the primary evaluation unchanged', async (t) => {
  const EvaluatorAgent = await requireEvaluatorAgent(t);
  if (!EvaluatorAgent) return;

  const agent = new EvaluatorAgent();
  const primary = evaluation({
    overall_score: 0.74,
    verdict: 'write',
    insights: ['principled tradeoff framing'],
    new_memory_candidates: [
      {
        summary: 'Prefers principle-first tradeoffs.',
        category: 'value',
        soul_dimension: 'values',
        confidence: 0.77,
      },
    ],
  });
  let calls = 0;
  agent.runSingleEvaluation = async () => {
    calls += 1;
    return primary;
  };

  const result = await agent.evaluate(
    'What guides your toughest product decisions?',
    'I start from principles, then test tradeoffs against long-term maintainability.',
    'onevcat',
    'scenario',
    { dualReview: false }
  );

  assert.deepEqual(result, primary);
  assert.equal(calls, 1);
});

test('benchmark judge dual-judge mode keeps the primary verdict when judges agree within threshold', async (t) => {
  const EvaluatorAgent = await requireEvaluatorAgent(t);
  if (!EvaluatorAgent) return;

  const agent = new EvaluatorAgent();
  const primary = evaluation({
    overall_score: 0.78,
    verdict: 'write',
    insights: ['stays concrete'],
  });
  const secondary = evaluation({
    overall_score: 0.83,
    verdict: 'write',
    insights: ['stays concrete', 'same overall conclusion'],
  });
  const queued = [primary, secondary];
  let calls = 0;
  agent.runSingleEvaluation = async () => {
    calls += 1;
    return queued.shift();
  };

  const result = await agent.evaluate(
    'How do you structure large refactors?',
    'I split them into reversible cuts and avoid mixing architecture with cleanup.',
    'onevcat',
    'consistency',
    { dualReview: true, disagreementThreshold: 0.1 }
  );

  assert.deepEqual(result, primary);
  assert.equal(calls, 2);
});

test('benchmark judge dual-judge mode emits an adjudicated merge when judges materially disagree', async (t) => {
  const EvaluatorAgent = await requireEvaluatorAgent(t);
  if (!EvaluatorAgent) return;

  const agent = new EvaluatorAgent();
  const primary = evaluation({
    consistency_score: 0.42,
    authenticity_score: 0.46,
    depth_score: 0.44,
    overall_score: 0.45,
    verdict: 'discard',
    insights: ['too generic'],
    new_memory_candidates: [],
  });
  const secondary = evaluation({
    consistency_score: 0.88,
    authenticity_score: 0.84,
    depth_score: 0.82,
    overall_score: 0.85,
    verdict: 'write',
    insights: ['captures principle-first reasoning', 'concrete tradeoff framing'],
    new_memory_candidates: [
      {
        summary: 'Treats reversibility as a first-class constraint.',
        category: 'value',
        soul_dimension: 'values',
        confidence: 0.8,
      },
      {
        summary: 'Prefers incremental architecture moves over big-bang rewrites.',
        category: 'behavior',
        soul_dimension: 'behavioral_traits',
        confidence: 0.78,
      },
    ],
  });
  const queued = [primary, secondary];
  agent.runSingleEvaluation = async () => queued.shift();

  const result = await agent.evaluate(
    'What tradeoff do you accept for long-term maintainability?',
    'I will pay local complexity if it keeps the system reversible and easy to reason about later.',
    'onevcat',
    'scenario',
    { dualReview: true, disagreementThreshold: 0.2 }
  );

  assert.equal(result.verdict, 'write');
  assert.equal(result.consistency_score, (primary.consistency_score + secondary.consistency_score) / 2);
  assert.equal(result.authenticity_score, (primary.authenticity_score + secondary.authenticity_score) / 2);
  assert.equal(result.depth_score, (primary.depth_score + secondary.depth_score) / 2);
  assert.equal(result.overall_score, (primary.overall_score + secondary.overall_score) / 2);
  assert.deepEqual(result.insights, [
    'too generic',
    'captures principle-first reasoning',
    'concrete tradeoff framing',
  ]);
  assert.deepEqual(result.new_memory_candidates, secondary.new_memory_candidates);
});

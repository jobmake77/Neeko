import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [
  slug,
  outputDirArg,
  repeatsRaw = '3',
  roundsRaw = '1',
  questionsRaw = '1',
  kimiModeRaw = 'tight_runtime',
  variantsRaw = 'legacy:off,v2:off,v2:signals',
  maxAttemptsRaw = '3',
] = process.argv.slice(2);

if (!slug || !outputDirArg) {
  console.error(
    'Usage: /usr/local/bin/node scripts/run-input-routing-pk.mjs <slug> <outputDir> ' +
    '[repeats=3] [rounds=1] [questions=1] [kimiMode=tight_runtime] ' +
    '[variants=legacy:off,v2:off,v2:signals] [maxAttempts=3]'
  );
  process.exit(1);
}

const outputDir = path.resolve(outputDirArg);
const repeats = Math.max(1, parseInt(repeatsRaw, 10) || 3);
const rounds = Math.max(1, parseInt(roundsRaw, 10) || 1);
const questions = Math.max(1, parseInt(questionsRaw, 10) || 1);
const kimiMode = String(kimiModeRaw || 'tight_runtime');
const variants = variantsRaw.split(',').map((item) => item.trim()).filter(Boolean);
const maxAttempts = Math.max(1, parseInt(maxAttemptsRaw, 10) || 3);

fs.mkdirSync(outputDir, { recursive: true });
const { buildPkAggregateSummary, defaultCurrentGrayPathRecommendation } = await import(
  '../dist/testing/pk-aggregate-test-entry.js'
);

const allRuns = [];

for (const variant of variants) {
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const runDir = path.join(outputDir, sanitizeVariant(variant), `run-${String(repeat).padStart(2, '0')}`);
    fs.mkdirSync(runDir, { recursive: true });
    console.error(`pk-run variant=${variant} repeat=${repeat}/${repeats}`);

    let latestReport = null;
    let row = null;
    let routingDecisionRecord = null;
    let lastExitCode = null;
    let successfulAttempt = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.error(`pk-retry variant=${variant} repeat=${repeat}/${repeats} attempt=${attempt}/${maxAttempts}`);
      }

      const result = spawnSync(
        '/usr/local/bin/node',
        [
          'dist/cli/index.js',
          'experiment',
          slug,
          '--skip-profile-sweep',
          '--rounds',
          String(rounds),
          '--questions-per-round',
          String(questions),
          '--compare-training-seed',
          '--compare-variants',
          variant,
          '--kimi-stability-mode',
          kimiMode,
          '--output-dir',
          runDir,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            NEEKO_PREFLIGHT_EXPERIMENT_TIMEOUT_MS: process.env.NEEKO_PREFLIGHT_EXPERIMENT_TIMEOUT_MS || '45000',
            NEEKO_EXPERIMENT_PROFILE_TIMEOUT_MS: process.env.NEEKO_EXPERIMENT_PROFILE_TIMEOUT_MS || '180000',
          },
          maxBuffer: 16 * 1024 * 1024,
        }
      );

      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);

      lastExitCode = result.status ?? null;
      latestReport = findLatestJson(runDir);
      const parsed = latestReport ? JSON.parse(fs.readFileSync(latestReport, 'utf8')) : null;
      row = parsed?.input_routing_comparison?.[0] ?? null;
      routingDecisionRecord = parsed?.routing_decision_record ?? null;

      if ((result.status ?? 1) === 0 && row && typeof row.avgQuality === 'number') {
        successfulAttempt = attempt;
        break;
      }

      if (attempt < maxAttempts) {
        sleep(3_000 * attempt);
      }
    }

    const runSummary = {
      variant,
      repeat,
      attempts: maxAttempts,
      successfulAttempt,
      exitCode: lastExitCode,
      reportPath: latestReport,
      quality: row?.avgQuality ?? null,
      coverage: row?.coverage ?? null,
      contradictionRate: row?.contradictionRate ?? null,
      duplicationRate: row?.duplicationRate ?? null,
      inputRouting: row?.input_routing ?? null,
      trainingSeedMode: row?.training_seed_mode ?? null,
      runtimeObservability: row?.runtime_observability ?? null,
      observability: row?.observability ?? null,
      scalingObservability: row?.scaling_observability ?? null,
      routingDecisionRecord,
    };
    allRuns.push(runSummary);
  }
}

const aggregateSummary = buildPkAggregateSummary({
  runs: allRuns,
  currentGrayPathRecommendation: defaultCurrentGrayPathRecommendation(),
});

const summary = {
  slug,
  repeats,
  rounds,
  questions,
  kimi_mode: kimiMode,
  max_attempts: maxAttempts,
  variants,
  runs: allRuns,
  aggregate: aggregateSummary.aggregate,
  aggregate_by_variant: aggregateSummary.aggregate_by_variant,
  routing_decision_aggregate: aggregateSummary.routing_decision_aggregate,
};

const summaryPath = path.join(outputDir, 'pk-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      summaryPath,
      aggregate: summary.aggregate,
      routing_decision_aggregate: summary.routing_decision_aggregate,
    },
    null,
    2
  )
);

function sanitizeVariant(value) {
  return value.replace(/[^a-z0-9:_-]+/gi, '-').replace(/:/g, '__');
}

function findLatestJson(dir) {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && name.startsWith('experiment-')).sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

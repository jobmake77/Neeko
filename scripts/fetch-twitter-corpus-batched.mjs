import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [
  handleArg,
  outArg,
  targetRaw = '1200',
  startRaw = '2026-04-01',
  earliestRaw = '2024-01-01',
  initialWindowDaysRaw = '7',
  minWindowDaysRaw = '1',
  batchQueriesRaw = '12',
  cooldownMsRaw = '4000',
  maxPassesRaw = '24',
] = process.argv.slice(2);

if (!handleArg || !outArg) {
  console.error(
    'Usage: /usr/local/bin/node scripts/fetch-twitter-corpus-batched.mjs <handle> <out.json> ' +
    '[target=1200] [start=2026-04-01] [earliest=2024-01-01] [initialWindowDays=7] [minWindowDays=1] ' +
    '[batchQueries=12] [cooldownMs=4000] [maxPasses=24]'
  );
  process.exit(1);
}

const out = path.resolve(outArg);
const statePath = `${out}.state.json`;
const batchQueries = Math.max(1, parseInt(batchQueriesRaw, 10) || 12);
const cooldownMs = Math.max(0, parseInt(cooldownMsRaw, 10) || 4000);
const maxPasses = Math.max(1, parseInt(maxPassesRaw, 10) || 24);
const args = [
  'scripts/fetch-twitter-corpus.mjs',
  handleArg,
  out,
  targetRaw,
  startRaw,
  earliestRaw,
  initialWindowDaysRaw,
  minWindowDaysRaw,
];

let lastCount = readCorpusCount(out);
let stagnationPasses = 0;
let finalSummary = null;

for (let pass = 1; pass <= maxPasses; pass++) {
  console.error(`batch-pass ${pass}/${maxPasses} starting count=${lastCount}`);

  const result = spawnSync('/usr/local/bin/node', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NEEKO_TWITTER_MAX_QUERIES_PER_RUN: String(batchQueries),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);

  const summary = extractLastJsonObject(result.stdout || '');
  if (summary && typeof summary === 'object') {
    finalSummary = summary;
  }

  const currentCount = readCorpusCount(out);
  const gained = currentCount - lastCount;
  if (gained <= 0) stagnationPasses += 1;
  else stagnationPasses = 0;

  console.error(`batch-pass ${pass} done gained=${gained} total=${currentCount} stagnation=${stagnationPasses}`);

  if (result.status !== 0) {
    console.error(`batch-pass ${pass} exited with status=${result.status}`);
    break;
  }

  if (finalSummary?.stopped_reason === 'provider_unhealthy') {
    console.error('batch supervisor stopping because provider is unhealthy');
    break;
  }

  if (!fs.existsSync(statePath)) {
    break;
  }

  if (stagnationPasses >= 3) {
    console.error('batch supervisor stopping after 3 stagnant passes');
    break;
  }

  if (cooldownMs > 0) sleep(cooldownMs);
  lastCount = currentCount;
}

const state = readState(statePath);
const output = {
  out,
  count: readCorpusCount(out),
  state_exists: fs.existsSync(statePath),
  next_until: state?.until,
  final_summary: finalSummary,
};

console.log(JSON.stringify(output, null, 2));

function readCorpusCount(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function extractLastJsonObject(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  const joined = lines.join('\n');
  const start = joined.lastIndexOf('\n{');
  const candidate = start >= 0 ? joined.slice(start + 1) : joined;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

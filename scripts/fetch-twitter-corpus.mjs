import { execSync } from 'node:child_process';
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
] = process.argv.slice(2);

if (!handleArg || !outArg) {
  console.error('Usage: node scripts/fetch-twitter-corpus.mjs <handle> <out.json> [target=1200] [start=2026-04-01] [earliest=2024-01-01] [initialWindowDays=7] [minWindowDays=1]');
  process.exit(1);
}

const handle = handleArg.replace(/^@/, '');
const out = path.resolve(outArg);
const statePath = `${out}.state.json`;
const target = Math.max(1, parseInt(targetRaw, 10) || 1200);
const start = new Date(`${startRaw}T00:00:00Z`);
const earliest = new Date(`${earliestRaw}T00:00:00Z`);
const initialWindowDays = Math.max(1, parseInt(initialWindowDaysRaw, 10) || 7);
const minWindowDays = Math.max(1, parseInt(minWindowDaysRaw, 10) || 1);
const saturationThreshold = 18;
const env = {
  ...process.env,
  PATH: `/Users/a77/.npm-global/bin:/usr/local/bin:${process.env.PATH || ''}`,
};

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function subDays(d, days) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - days);
  return x;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runWindow(since, until) {
  const query = `from:${handle} since:${fmt(since)} until:${fmt(until)}`;
  const cmd = `opencli twitter search \"${query}\" --filter live --limit 100 --format json`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const output = execSync(cmd, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsed = JSON.parse(output);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      const message = String(error?.stderr || error?.message || error);
      if (attempt < 3 && /Detached while handling command|Failed to start opencli daemon|Browser Bridge not connected/i.test(message)) {
        sleep(1500 * attempt);
        continue;
      }
      return [];
    }
  }
  return [];
}

function loadExisting(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function persistCorpus(filePath, rows) {
  const data = [...rows.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return data;
}

function persistState(filePath, state) {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

const existing = loadExisting(out);
const seen = new Map(existing.filter((row) => row?.id).map((row) => [row.id, row]));
const savedState = loadState(statePath);

let until = savedState?.handle === handle && savedState?.out === out && savedState?.until
  ? new Date(savedState.until)
  : start;
let windowDays = Number(savedState?.windowDays) > 0 ? savedState.windowDays : initialWindowDays;
let zeroStreak = Number(savedState?.zeroStreak) > 0 ? savedState.zeroStreak : 0;
let queryCount = Number(savedState?.queryCount) > 0 ? savedState.queryCount : 0;

while (until > earliest && seen.size < target) {
  const since = subDays(until, windowDays);
  const rows = runWindow(since, until);
  queryCount += 1;

  for (const row of rows) {
    if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
  }

  zeroStreak = rows.length === 0 ? zeroStreak + 1 : 0;
  console.error(`${fmt(since)}..${fmt(until)} days=${windowDays} rows=${rows.length} total=${seen.size} queries=${queryCount}`);
  persistCorpus(out, seen);

  if (rows.length >= saturationThreshold && windowDays > minWindowDays) {
    windowDays = Math.max(minWindowDays, Math.floor(windowDays / 2));
    persistState(statePath, {
      handle,
      out,
      until: until.toISOString(),
      windowDays,
      zeroStreak,
      queryCount,
      count: seen.size,
      updated_at: new Date().toISOString(),
    });
    continue;
  }

  if (rows.length === 0 && zeroStreak >= 6 && windowDays < 28) {
    windowDays = Math.min(28, windowDays * 2);
    zeroStreak = 0;
  }

  until = since;
  persistState(statePath, {
    handle,
    out,
    until: until.toISOString(),
    windowDays,
    zeroStreak,
    queryCount,
    count: seen.size,
    updated_at: new Date().toISOString(),
  });
}

const data = persistCorpus(out, seen);
if (fs.existsSync(statePath)) {
  fs.unlinkSync(statePath);
}
console.log(JSON.stringify({
  handle,
  count: data.length,
  out,
  newest: data[0]?.created_at,
  oldest: data[data.length - 1]?.created_at,
  queries: queryCount,
}, null, 2));

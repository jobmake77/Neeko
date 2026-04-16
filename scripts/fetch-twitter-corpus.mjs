import { spawn } from 'node:child_process';
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
const searchHorizonStopDays = Math.max(56, parseInt(process.env.NEEKO_FETCH_SEARCH_HORIZON_STOP_DAYS || '180', 10) || 180);
const emptyWindowRetries = Math.max(0, parseInt(process.env.NEEKO_TWITTER_EMPTY_WINDOW_RETRIES || '1', 10) || 1);
const maxQueriesPerRun = Math.max(0, parseInt(process.env.NEEKO_TWITTER_MAX_QUERIES_PER_RUN || '0', 10) || 0);
const unhealthyFailureLimit = Math.max(1, parseInt(process.env.NEEKO_TWITTER_PROVIDER_UNHEALTHY_FAILURES || '3', 10) || 3);
const fallbackProvider = String(process.env.NEEKO_TWITTER_FETCH_FALLBACK_PROVIDER || 'off').trim().toLowerCase();
const searchMode = String(process.env.NEEKO_TWITTER_SEARCH_MODE || 'live_then_top').trim().toLowerCase();
const queryTimeoutMs = Math.max(15_000, parseInt(process.env.NEEKO_TWITTER_QUERY_TIMEOUT_MS || '120000', 10) || 120_000);
const env = {
  ...process.env,
  PATH: `/Users/a77/.npm-global/bin:/usr/local/bin:${process.env.PATH || ''}`,
  OPENCLI_BROWSER_COMMAND_TIMEOUT: String(
    Math.max(
      parseInt(process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '0', 10) || 0,
      Math.ceil(queryTimeoutMs / 1000),
      180,
    )
  ),
};
const maxRecentWindows = 12;
let snscrapeBlockedInRun = false;
let snscrapeBlockedReason = null;
let runtimeState = null;

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function iso(value) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function subDays(d, days) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - days);
  return x;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

function parseCreatedAt(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time) : null;
}

function findOldestSeenDate(rows) {
  let oldest = null;
  for (const row of rows.values()) {
    const parsed = parseCreatedAt(row?.created_at);
    if (!parsed) continue;
    if (!oldest || parsed < oldest) oldest = parsed;
  }
  return oldest;
}

function createProviderStats(savedState) {
  const initial = savedState?.providerStats && typeof savedState.providerStats === 'object'
    ? savedState.providerStats
    : {};
  return {
    opencli: {
      windows: Number(initial.opencli?.windows) || 0,
      nonEmptyWindows: Number(initial.opencli?.nonEmptyWindows) || 0,
      rows: Number(initial.opencli?.rows) || 0,
      failures: Number(initial.opencli?.failures) || 0,
      lastError: typeof initial.opencli?.lastError === 'string' ? initial.opencli.lastError : undefined,
    },
    snscrape: {
      windows: Number(initial.snscrape?.windows) || 0,
      nonEmptyWindows: Number(initial.snscrape?.nonEmptyWindows) || 0,
      rows: Number(initial.snscrape?.rows) || 0,
      failures: Number(initial.snscrape?.failures) || 0,
      lastError: typeof initial.snscrape?.lastError === 'string' ? initial.snscrape.lastError : undefined,
    },
  };
}

function updateProviderStats(stats, attempts) {
  for (const attempt of attempts) {
    const bucket = stats[attempt.provider];
    if (!bucket) continue;
    bucket.windows += 1;
    bucket.rows += Number(attempt.rows) || 0;
    if (attempt.rows > 0) bucket.nonEmptyWindows += 1;
    if (attempt.ok === false) {
      bucket.failures += 1;
      if (attempt.error) bucket.lastError = attempt.error;
    }
  }
}

function normalizeAuthor(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function authorFromUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/x\.com\/([^/?#]+)\/status\//i) || text.match(/twitter\.com\/([^/?#]+)\/status\//i);
  const normalized = normalizeAuthor(match?.[1]);
  return normalized === 'i' ? '' : normalized;
}

function validateFetchedRows(rows) {
  const accepted = [];
  let matchedCount = 0;
  let mismatchedCount = 0;
  let rejectedCount = 0;

  for (const row of rows) {
    const author = normalizeAuthor(row?.author);
    const authorHandle = normalizeAuthor(row?.author_handle);
    const urlAuthor = authorFromUrl(row?.url ?? row?.source_url);
    const matches = [author, authorHandle, urlAuthor].filter(Boolean).filter((item) => item === handle.toLowerCase()).length;
    const signals = [author, authorHandle, urlAuthor].filter(Boolean).length;
    if (matches >= Math.min(2, Math.max(1, signals))) {
      accepted.push(row);
      matchedCount += 1;
    } else {
      mismatchedCount += 1;
      rejectedCount += 1;
    }
  }

  const failureRatio = rows.length > 0 ? mismatchedCount / rows.length : 0;
  return {
    rows: accepted,
    matchedCount,
    mismatchedCount,
    rejectedCount,
    windowFailed: rows.length > 0 && failureRatio > 0.5,
  };
}

function withinWindow(value, since, until) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return false;
  return time >= since.getTime() && time < until.getTime();
}

function sanitizeSnscrapeError(error) {
  const raw = String(error?.stderr || error?.message || error || '');
  const cleanedLines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/NotOpenSSLWarning|warnings\.warn\(/i.test(line));

  const priorityLine =
    cleanedLines.find((line) => /ScraperException:/i.test(line)) ||
    cleanedLines.find((line) => /CRITICAL\s+.*Errors:/i.test(line)) ||
    cleanedLines.find((line) => /blocked \(404\)/i.test(line)) ||
    cleanedLines.find((line) => /Error retrieving/i.test(line)) ||
    cleanedLines[0] ||
    raw.trim();

  return priorityLine.slice(0, 240);
}

function isSnscrapeBlockedError(message) {
  return /blocked \(404\)|ScraperException: .*failed, giving up|Error retrieving .* blocked \(404\)|snscrape\.base\.ScraperException|SearchTimeline\?variables=/i.test(String(message || ''));
}

function shouldRetryOpenCliError(message) {
  return /Detached while handling command|Failed to start opencli daemon|Browser Bridge not connected|Debugger is not attached|connection error|timed out|timeout|SPA navigation .*Final path: \/explore|Final path: \/explore|SecurityError: Failed to execute 'pushState'/i.test(
    String(message || '')
  );
}

function isStructuralOpenCliError(message) {
  const error = String(message || '').toLowerCase();
  return (
    error.includes('selector not found') ||
    error.includes('page structure may have changed') ||
    error.includes('debugger is not attached') ||
    error.includes("securityerror: failed to execute 'pushstate'") ||
    error.includes("origin 'null'") ||
    error.includes('data:text/html')
  );
}

function isPrimaryProviderFatal(meta) {
  const error = String(meta?.error || '');
  return (
    error.includes('majority author mismatch') ||
    isStructuralOpenCliError(error) ||
    /browser bridge not connected|failed to start opencli daemon/i.test(error)
  );
}

function shouldAbortForProviderStats(stats) {
  const opencli = stats?.opencli;
  const snscrape = stats?.snscrape;
  const opencliExhausted = Number(opencli?.nonEmptyWindows || 0) === 0 && Number(opencli?.failures || 0) >= unhealthyFailureLimit;
  const snscrapeExhausted = fallbackProvider === 'snscrape'
    && Number(snscrape?.nonEmptyWindows || 0) === 0
    && Number(snscrape?.failures || 0) >= unhealthyFailureLimit;
  return opencliExhausted && (fallbackProvider !== 'snscrape' || snscrapeExhausted);
}

function resolveSearchModes() {
  if (searchMode === 'top_only') return ['top'];
  if (searchMode === 'top_then_live') return ['top', 'live'];
  if (searchMode === 'live_only') return ['live'];
  return ['live', 'top'];
}

function createWindowSummary(input) {
  return {
    source_label: `@${handle}`,
    window_start: iso(input.since),
    window_end: iso(input.until),
    provider: input.provider,
    filter_mode: input.filterMode,
    status: input.status,
    attempt: input.attempt,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    updated_at: input.updatedAt,
    duration_ms: input.durationMs,
    result_count: input.resultCount,
    new_count: input.newCount,
    matched_count: input.matchedCount,
    rejected_count: input.rejectedCount,
    quarantined_count: input.quarantinedCount,
    error: input.error,
  };
}

function mergeState(patch = {}) {
  runtimeState = {
    ...(runtimeState ?? {}),
    ...patch,
  };
  persistState(statePath, runtimeState);
}

function recordWindow(summary) {
  const recent = Array.isArray(runtimeState?.recent_windows) ? runtimeState.recent_windows.slice() : [];
  recent.unshift(summary);
  const nextState = {
    recent_windows: recent.slice(0, maxRecentWindows),
    current_window: summary,
    last_heartbeat_at: summary.updated_at ?? summary.finished_at ?? summary.started_at ?? new Date().toISOString(),
  };
  if (summary.status === 'completed' || summary.status === 'empty' || summary.status === 'skipped') {
    nextState.last_success_window = summary;
  }
  if (summary.status === 'timeout' || summary.status === 'failed') {
    nextState.last_failure_window = summary;
  }
  mergeState(nextState);
}

function initializeRuntimeState(savedState, seenCount, queryCount) {
  const totalRangeDays = Math.max(1, Math.ceil((start.getTime() - earliest.getTime()) / 86_400_000));
  const estimatedTotalWindows = Math.max(1, Math.ceil(totalRangeDays / Math.max(1, Number(savedState?.windowDays) || initialWindowDays)));
  runtimeState = {
    ...(savedState ?? {}),
    handle,
    out,
    phase: 'deep_fetching',
    source_label: `@${handle}`,
    estimated_total_windows: Math.max(Number(savedState?.estimated_total_windows) || 0, estimatedTotalWindows),
    completed_windows: Number(savedState?.completed_windows) || 0,
    providerStats: savedState?.providerStats ?? savedState?.provider_stats ?? {},
    consecutivePrimaryProviderFailures: Number(savedState?.consecutivePrimaryProviderFailures ?? savedState?.consecutive_primary_provider_failures) || 0,
    history_exhausted: savedState?.history_exhausted === true,
    provider_exhausted: savedState?.provider_exhausted === true,
    collection_stop_reason: typeof savedState?.collection_stop_reason === 'string' ? savedState.collection_stop_reason : undefined,
    queryCount,
    count: seenCount,
    updated_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    recent_windows: Array.isArray(savedState?.recent_windows) ? savedState.recent_windows.slice(0, maxRecentWindows) : [],
  };
  persistState(statePath, runtimeState);
}

async function runCommand(binary, args, options = {}) {
  const startAt = Date.now();
  return await new Promise((resolve) => {
    const child = spawn(binary, args, {
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killedHard = false;

    const heartbeatTimer = options.onHeartbeat
      ? setInterval(() => {
          options.onHeartbeat({
            pid: child.pid,
            updatedAt: new Date().toISOString(),
          });
        }, options.heartbeatMs ?? 3000)
      : null;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        if (settled) return;
        killedHard = true;
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 2500).unref();
    }, options.timeoutMs ?? queryTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
        timedOut,
        killedHard,
        durationMs: Date.now() - startAt,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
        timedOut,
        killedHard,
        durationMs: Date.now() - startAt,
      });
    });
  });
}

async function runOpenCliSearchWindow(query, filter, limit, since, until) {
  const args = ['twitter', 'search', query, '--filter', filter, '--limit', String(limit), '--format', 'json'];
  for (let emptyAttempt = 0; emptyAttempt <= emptyWindowRetries; emptyAttempt++) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const startedAt = new Date().toISOString();
      mergeState({
        current_window: createWindowSummary({
          since,
          until,
          provider: 'opencli',
          filterMode: `search:${filter}`,
          status: 'running',
          attempt,
          startedAt,
          updatedAt: startedAt,
        }),
        current_operation: 'deep_fetch',
        updated_at: startedAt,
        last_heartbeat_at: startedAt,
      });

      const execution = await runCommand('opencli', args, {
        env,
        timeoutMs: queryTimeoutMs,
        onHeartbeat: ({ updatedAt }) => {
          mergeState({
            current_window: {
              ...(runtimeState?.current_window ?? {}),
              updated_at: updatedAt,
              status: 'running',
            },
            updated_at: updatedAt,
            last_heartbeat_at: updatedAt,
          });
        },
      });

      const finishedAt = new Date().toISOString();
      if (execution.code === 0) {
        try {
          const parsed = JSON.parse(execution.stdout || '[]');
          const rawRows = Array.isArray(parsed) ? parsed : [];
          const candidateRows = rawRows.filter((row) => withinWindow(row?.created_at, since, until));
          const validation = validateFetchedRows(candidateRows);
          const rows = validation.windowFailed ? [] : validation.rows;
          const summary = createWindowSummary({
            since,
            until,
            provider: 'opencli',
            filterMode: `search:${filter}`,
            status: validation.windowFailed ? 'failed' : rows.length > 0 ? 'completed' : 'empty',
            attempt,
            startedAt,
            finishedAt,
            updatedAt: finishedAt,
            durationMs: execution.durationMs,
            resultCount: rows.length,
            newCount: 0,
            matchedCount: validation.matchedCount,
            rejectedCount: validation.rejectedCount,
          });
          recordWindow(summary);
          if (rows.length === 0 && emptyAttempt < emptyWindowRetries) {
            sleep(1200 * (emptyAttempt + 1));
            break;
          }
          return {
            rows,
            meta: {
              provider: 'opencli',
              ok: !validation.windowFailed,
              status: validation.windowFailed ? 'failed' : rows.length > 0 ? 'completed' : 'empty',
              mode: `search:${filter}`,
              rows: rows.length,
              attempt,
              emptyVerificationPasses: emptyAttempt,
              durationMs: execution.durationMs,
              matched_count: validation.matchedCount,
              rejected_count: validation.rejectedCount,
              error: validation.windowFailed ? 'majority author mismatch' : undefined,
            },
          };
        } catch (error) {
          const message = String(error?.message || error);
          const summary = createWindowSummary({
            since,
            until,
            provider: 'opencli',
            filterMode: `search:${filter}`,
            status: 'failed',
            attempt,
            startedAt,
            finishedAt,
            updatedAt: finishedAt,
            durationMs: execution.durationMs,
            resultCount: 0,
            newCount: 0,
            error: message.slice(0, 240),
          });
          recordWindow(summary);
          return {
            rows: [],
            meta: {
              provider: 'opencli',
              ok: false,
              status: 'failed',
              mode: `search:${filter}`,
              rows: 0,
              attempt,
              emptyVerificationPasses: emptyAttempt,
              durationMs: execution.durationMs,
              error: message.slice(0, 240),
            },
          };
        }
      }

      const message = String(execution.stderr || execution.stdout || 'opencli failed');
      const status = execution.timedOut ? 'timeout' : 'failed';
      const summary = createWindowSummary({
        since,
        until,
        provider: 'opencli',
        filterMode: `search:${filter}`,
        status,
        attempt,
        startedAt,
        finishedAt,
        updatedAt: finishedAt,
        durationMs: execution.durationMs,
        resultCount: 0,
        newCount: 0,
        error: message.slice(0, 240),
      });
      recordWindow(summary);

      if (attempt < 3 && shouldRetryOpenCliError(message)) {
        sleep(1500 * attempt);
        continue;
      }

      return {
        rows: [],
        meta: {
          provider: 'opencli',
          ok: false,
          status,
          mode: `search:${filter}`,
          rows: 0,
          attempt,
          emptyVerificationPasses: emptyAttempt,
          durationMs: execution.durationMs,
          error: message.slice(0, 240),
        },
      };
    }
  }

  return {
    rows: [],
    meta: {
      provider: 'opencli',
      ok: false,
      status: 'failed',
      mode: 'search:exhausted',
      rows: 0,
      attempt: 3,
      emptyVerificationPasses: emptyWindowRetries,
      error: 'opencli exhausted retries',
    },
  };
}

async function runOpenCliTimelineWindow(since, until) {
  const args = ['twitter', 'timeline', '--type', 'following', '--limit', '120', '--format', 'json'];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = new Date().toISOString();
    mergeState({
      current_window: createWindowSummary({
        since,
        until,
        provider: 'opencli',
        filterMode: 'timeline:following',
        status: 'running',
        attempt,
        startedAt,
        updatedAt: startedAt,
      }),
      updated_at: startedAt,
      last_heartbeat_at: startedAt,
    });

    const execution = await runCommand('opencli', args, {
      env,
      timeoutMs: queryTimeoutMs,
      onHeartbeat: ({ updatedAt }) => {
        mergeState({
          current_window: {
            ...(runtimeState?.current_window ?? {}),
            updated_at: updatedAt,
            status: 'running',
          },
          updated_at: updatedAt,
          last_heartbeat_at: updatedAt,
        });
      },
    });

    const finishedAt = new Date().toISOString();
    if (execution.code === 0) {
      try {
        const parsed = JSON.parse(execution.stdout || '[]');
        const candidateRows = (Array.isArray(parsed) ? parsed : [])
          .filter((row) => normalizeAuthor(row?.author) === handle.toLowerCase())
          .filter((row) => withinWindow(row?.created_at, since, until));
        const validation = validateFetchedRows(candidateRows);
        const rows = validation.windowFailed ? [] : validation.rows;
        recordWindow(createWindowSummary({
          since,
          until,
          provider: 'opencli',
          filterMode: 'timeline:following',
          status: validation.windowFailed ? 'failed' : rows.length > 0 ? 'completed' : 'empty',
          attempt,
          startedAt,
          finishedAt,
          updatedAt: finishedAt,
          durationMs: execution.durationMs,
          resultCount: rows.length,
          newCount: 0,
          matchedCount: validation.matchedCount,
          rejectedCount: validation.rejectedCount,
        }));
        return {
          rows,
          meta: {
            provider: 'opencli',
            ok: !validation.windowFailed,
            status: validation.windowFailed ? 'failed' : rows.length > 0 ? 'completed' : 'empty',
            mode: 'timeline:following',
            rows: rows.length,
            attempt,
            durationMs: execution.durationMs,
            matched_count: validation.matchedCount,
            rejected_count: validation.rejectedCount,
            error: validation.windowFailed ? 'majority author mismatch' : undefined,
          },
        };
      } catch (error) {
        const message = String(error?.message || error);
        recordWindow(createWindowSummary({
          since,
          until,
          provider: 'opencli',
          filterMode: 'timeline:following',
          status: 'failed',
          attempt,
          startedAt,
          finishedAt,
          updatedAt: finishedAt,
          durationMs: execution.durationMs,
          resultCount: 0,
          newCount: 0,
          error: message.slice(0, 240),
        }));
        return {
          rows: [],
          meta: {
            provider: 'opencli',
            ok: false,
            status: 'failed',
            mode: 'timeline:following',
            rows: 0,
            attempt,
            durationMs: execution.durationMs,
            error: message.slice(0, 240),
          },
        };
      }
    }

    const message = String(execution.stderr || execution.stdout || 'timeline failed');
    const status = execution.timedOut ? 'timeout' : 'failed';
    recordWindow(createWindowSummary({
      since,
      until,
      provider: 'opencli',
      filterMode: 'timeline:following',
      status,
      attempt,
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      durationMs: execution.durationMs,
      resultCount: 0,
      newCount: 0,
      error: message.slice(0, 240),
    }));
    if (attempt < 2 && shouldRetryOpenCliError(message)) {
      sleep(1200 * attempt);
      continue;
    }
    return {
      rows: [],
      meta: {
        provider: 'opencli',
        ok: false,
        status,
        mode: 'timeline:following',
        rows: 0,
        attempt,
        durationMs: execution.durationMs,
        error: message.slice(0, 240),
      },
    };
  }

  return {
    rows: [],
    meta: {
      provider: 'opencli',
      ok: false,
      status: 'failed',
      mode: 'timeline:following',
      rows: 0,
      attempt: 2,
      error: 'timeline fallback exhausted retries',
    },
  };
}

async function runSnscrapeWindow(since, until) {
  const query = `from:${handle} since:${fmt(since)} until:${fmt(until)}`;
  const snscrapeEnv = {
    ...env,
    PATH: `${path.join(process.env.HOME || '', 'Library/Python/3.9/bin')}:${env.PATH}`,
    PYTHONWARNINGS: 'ignore::urllib3.exceptions.NotOpenSSLWarning',
  };
  const startedAt = new Date().toISOString();
  mergeState({
    current_window: createWindowSummary({
      since,
      until,
      provider: 'snscrape',
      filterMode: 'search',
      status: 'running',
      attempt: 1,
      startedAt,
      updatedAt: startedAt,
    }),
    updated_at: startedAt,
    last_heartbeat_at: startedAt,
  });

  const execution = await runCommand('snscrape', ['--jsonl', '--max-results', '100', 'twitter-search', query], {
    env: snscrapeEnv,
    timeoutMs: queryTimeoutMs,
    onHeartbeat: ({ updatedAt }) => {
      mergeState({
        current_window: {
          ...(runtimeState?.current_window ?? {}),
          updated_at: updatedAt,
          status: 'running',
        },
        updated_at: updatedAt,
        last_heartbeat_at: updatedAt,
      });
    },
  });

  const finishedAt = new Date().toISOString();
  if (execution.code === 0) {
    const candidateRows = execution.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const validation = validateFetchedRows(candidateRows);
    const rows = validation.windowFailed ? [] : validation.rows;
    recordWindow(createWindowSummary({
      since,
      until,
      provider: 'snscrape',
      filterMode: 'search',
      status: validation.windowFailed ? 'failed' : rows.length > 0 ? 'completed' : 'empty',
      attempt: 1,
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      durationMs: execution.durationMs,
      resultCount: rows.length,
      newCount: 0,
      matchedCount: validation.matchedCount,
      rejectedCount: validation.rejectedCount,
    }));
    return {
      rows,
      meta: {
        provider: 'snscrape',
        ok: !validation.windowFailed,
        status: validation.windowFailed ? 'failed' : rows.length > 0 ? 'completed' : 'empty',
        rows: rows.length,
        attempt: 1,
        durationMs: execution.durationMs,
        matched_count: validation.matchedCount,
        rejected_count: validation.rejectedCount,
        error: validation.windowFailed ? 'majority author mismatch' : undefined,
      },
    };
  }

  const message = sanitizeSnscrapeError({ stderr: execution.stderr || execution.stdout || 'snscrape failed' });
  const status = execution.timedOut ? 'timeout' : 'failed';
  recordWindow(createWindowSummary({
    since,
    until,
    provider: 'snscrape',
    filterMode: 'search',
    status,
    attempt: 1,
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    durationMs: execution.durationMs,
    resultCount: 0,
    newCount: 0,
    error: message.slice(0, 240),
  }));
  return {
    rows: [],
    meta: {
      provider: 'snscrape',
      ok: false,
      status,
      rows: 0,
      attempt: 1,
      durationMs: execution.durationMs,
      error: message.slice(0, 240),
    },
  };
}

async function runOpenCliWindow(since, until) {
  const query = `from:${handle} since:${fmt(since)} until:${fmt(until)}`;
  const attempts = [];
  const modes = resolveSearchModes();

  for (const mode of modes) {
    const result = await runOpenCliSearchWindow(query, mode, 100, since, until);
    attempts.push(result.meta);
    if (result.rows.length > 0) {
      return { rows: result.rows, provider: result.meta.provider, meta: result.meta, attempts };
    }
    if (isStructuralOpenCliError(result.meta.error)) {
      continue;
    }
  }

  if (attempts.some((attempt) => isStructuralOpenCliError(attempt.error))) {
    const timeline = await runOpenCliTimelineWindow(since, until);
    attempts.push(timeline.meta);
    return { rows: timeline.rows, provider: timeline.meta.provider, meta: timeline.meta, attempts };
  }

  const lastAttempt = attempts[attempts.length - 1] ?? {
    provider: 'opencli',
    ok: false,
    status: 'failed',
    rows: 0,
    mode: 'search:unknown',
    error: 'no opencli search attempt executed',
  };
  return { rows: [], provider: lastAttempt.provider, meta: lastAttempt, attempts };
}

async function runWindow(since, until) {
  const attempts = [];
  const primary = await runOpenCliWindow(since, until);
  attempts.push(...primary.attempts);
  const shouldTryFallback =
    fallbackProvider === 'snscrape' &&
    (
      primary.rows.length === 0 ||
      primary.meta?.error === 'majority author mismatch' ||
      primary.attempts.some((attempt) => attempt?.error === 'majority author mismatch')
    );

  if (primary.rows.length > 0 || !shouldTryFallback) {
    return { rows: primary.rows, provider: primary.meta.provider, attempts };
  }

  if (!snscrapeBlockedInRun) {
    const secondary = await runSnscrapeWindow(since, until);
    attempts.push(secondary.meta);
    if (secondary.meta.ok === false && isSnscrapeBlockedError(secondary.meta.error)) {
      snscrapeBlockedInRun = true;
      snscrapeBlockedReason = secondary.meta.error ?? 'snscrape blocked';
    }
    if (secondary.rows.length > 0) {
      return { rows: secondary.rows, provider: secondary.meta.provider, attempts };
    }
  } else {
    const skippedMeta = {
      provider: 'snscrape',
      ok: false,
      status: 'skipped',
      rows: 0,
      attempt: 0,
      skipped: true,
      error: snscrapeBlockedReason ?? 'snscrape blocked earlier in this run',
    };
    attempts.push(skippedMeta);
    recordWindow(createWindowSummary({
      since,
      until,
      provider: 'snscrape',
      filterMode: 'search',
      status: 'skipped',
      attempt: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      durationMs: 0,
      resultCount: 0,
      newCount: 0,
      error: skippedMeta.error,
    }));
  }

  return { rows: primary.rows, provider: primary.meta.provider, attempts };
}

async function main() {
  const existing = loadExisting(out);
  const seen = new Map(existing.filter((row) => row?.id).map((row) => [row.id, row]));
  const savedState = loadState(statePath);
  let oldestSeenDate = findOldestSeenDate(seen);
  let emptyDaysPastOldest = Number(savedState?.emptyDaysPastOldest) > 0 ? savedState.emptyDaysPastOldest : 0;
  const providerStats = createProviderStats(savedState);
  let consecutivePrimaryProviderFailures =
    Number(savedState?.consecutivePrimaryProviderFailures) > 0
      ? savedState.consecutivePrimaryProviderFailures
      : 0;

  let until = savedState?.handle === handle && savedState?.out === out && savedState?.until
    ? new Date(savedState.until)
    : start;
  let windowDays = Number(savedState?.windowDays) > 0 ? savedState.windowDays : initialWindowDays;
  let zeroStreak = Number(savedState?.zeroStreak) > 0 ? savedState.zeroStreak : 0;
  let queryCount = Number(savedState?.queryCount) > 0 ? savedState.queryCount : 0;
  const queryCountAtStart = queryCount;
  let stoppedReason = 'completed';

  initializeRuntimeState(savedState, seen.size, queryCount);
  mergeState({
    until: until.toISOString(),
    windowDays,
    zeroStreak,
    emptyDaysPastOldest,
    consecutivePrimaryProviderFailures,
    providerStats,
    provider_stats: providerStats,
    history_exhausted: false,
    provider_exhausted: false,
    collection_stop_reason: undefined,
  });

  while (until > earliest && seen.size < target) {
    if (maxQueriesPerRun > 0 && queryCount - queryCountAtStart >= maxQueriesPerRun) {
      stoppedReason = 'query_budget_reached';
      break;
    }

    const since = subDays(until, windowDays);
    const windowResult = await runWindow(since, until);
    const rows = windowResult.rows;
    let uniqueRowsAdded = 0;
    queryCount += 1;
    updateProviderStats(providerStats, windowResult.attempts);
    const primaryMeta = windowResult.attempts[0];
    if (primaryMeta?.ok === false) {
      consecutivePrimaryProviderFailures += 1;
    } else if ((primaryMeta?.rows ?? 0) > 0) {
      consecutivePrimaryProviderFailures = 0;
    }

    for (const row of rows) {
      if (row?.id && !seen.has(row.id)) {
        seen.set(row.id, row);
        uniqueRowsAdded += 1;
      }
    }
    oldestSeenDate = findOldestSeenDate(seen);

    zeroStreak = uniqueRowsAdded === 0 ? zeroStreak + 1 : 0;
    if (uniqueRowsAdded === 0 && oldestSeenDate && since < oldestSeenDate) {
      emptyDaysPastOldest += Math.max(1, Math.round((until.getTime() - since.getTime()) / 86_400_000));
    } else if (uniqueRowsAdded > 0) {
      emptyDaysPastOldest = 0;
    }

    const latestWindow = runtimeState?.current_window
      ? {
          ...runtimeState.current_window,
          new_count: uniqueRowsAdded,
          result_count: rows.length,
          updated_at: new Date().toISOString(),
        }
      : undefined;
    if (latestWindow) {
      recordWindow(latestWindow);
    }

    console.error(
      `${fmt(since)}..${fmt(until)} days=${windowDays} rows=${rows.length} unique=${uniqueRowsAdded} total=${seen.size} queries=${queryCount} provider=${windowResult.provider}`
    );
    persistCorpus(out, seen);

    const nextPatch = {
      until: until.toISOString(),
      windowDays,
      zeroStreak,
      emptyDaysPastOldest,
      consecutivePrimaryProviderFailures,
      providerStats,
      queryCount,
      count: seen.size,
      completed_windows: Number(runtimeState?.completed_windows || 0) + 1,
      updated_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    };

    if (uniqueRowsAdded >= saturationThreshold && windowDays > minWindowDays) {
      windowDays = Math.max(minWindowDays, Math.floor(windowDays / 2));
      mergeState({ ...nextPatch, windowDays });
      continue;
    }

    if (uniqueRowsAdded === 0 && zeroStreak >= 6 && windowDays < 28) {
      windowDays = Math.min(28, windowDays * 2);
      zeroStreak = 0;
    }

    until = since;
    mergeState({ ...nextPatch, until: until.toISOString(), windowDays, zeroStreak });

    if (
      primaryMeta?.ok === false &&
      consecutivePrimaryProviderFailures >= unhealthyFailureLimit &&
      isPrimaryProviderFatal(primaryMeta)
    ) {
      stoppedReason = 'provider_unhealthy';
      console.error(
        `provider unhealthy: ${primaryMeta.provider} failed ${consecutivePrimaryProviderFailures} consecutive windows (${primaryMeta.error ?? 'unknown error'})`
      );
      break;
    }

    if (shouldAbortForProviderStats(providerStats)) {
      stoppedReason = 'provider_unhealthy';
      console.error(
        `provider unhealthy by cumulative stats: opencli_failures=${providerStats.opencli.failures} snscrape_failures=${providerStats.snscrape.failures}`
      );
      break;
    }

    if (emptyDaysPastOldest >= searchHorizonStopDays) {
      stoppedReason = 'search_horizon_reached';
      console.error(
        `search-horizon reached: no additional tweets found for ${emptyDaysPastOldest} days before oldest seen tweet (${oldestSeenDate?.toISOString() ?? 'unknown'})`
      );
      break;
    }
  }

  const data = persistCorpus(out, seen);
  const historyExhausted = stoppedReason === 'search_horizon_reached' || (until <= earliest && seen.size < target);
  const providerExhausted = stoppedReason === 'provider_unhealthy';
  mergeState({
    phase: stoppedReason === 'completed'
      ? 'completed'
      : historyExhausted
        ? 'history_exhausted'
        : providerExhausted
          ? 'provider_unhealthy'
          : 'deep_fetching',
    updated_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    providerStats,
    provider_stats: providerStats,
    consecutivePrimaryProviderFailures,
    consecutive_primary_provider_failures: consecutivePrimaryProviderFailures,
    history_exhausted: historyExhausted,
    provider_exhausted: providerExhausted,
    collection_stop_reason: stoppedReason,
  });
  console.log(JSON.stringify({
    handle,
    count: data.length,
    out,
    newest: data[0]?.created_at,
    oldest: data[data.length - 1]?.created_at,
    queries: queryCount,
    queries_this_run: queryCount - queryCountAtStart,
    stopped_reason: stoppedReason,
    search_horizon_stop_days: searchHorizonStopDays,
    max_queries_per_run: maxQueriesPerRun,
    unhealthy_failure_limit: unhealthyFailureLimit,
    query_timeout_ms: queryTimeoutMs,
    fallback_provider: fallbackProvider,
    consecutive_primary_provider_failures: consecutivePrimaryProviderFailures,
    provider_stats: providerStats,
    history_exhausted: historyExhausted,
    provider_exhausted: providerExhausted,
  }, null, 2));
}

await main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});

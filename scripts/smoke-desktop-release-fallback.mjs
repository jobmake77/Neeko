import http from 'node:http';
import { spawn } from 'node:child_process';
import process from 'node:process';

const APP_EXECUTABLE = '/Users/a77/Desktop/Neeko/desktop/src-tauri/target/release/bundle/macos/Neeko 客户端.app/Contents/MacOS/neeko-workbench';
const RELEASE_SERVER_MATCHER = 'Contents/Resources/_up_/runtime/neeko-runtime/dist/cli/index.js workbench-server --port 4311';
const APP_MATCHER = 'Contents/MacOS/neeko-workbench';
const FALLBACK_PORT = 4311;
const PRIMARY_PORT = 4310;
const HEALTH_TIMEOUT_MS = 2_500;
const STARTUP_TIMEOUT_MS = 25_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('zsh', ['-lc', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `command failed: ${command}`));
      }
    });
  });
}

async function tryRunCommand(command) {
  try {
    return await runCommand(command);
  } catch {
    return '';
  }
}

async function killExistingReleaseApp() {
  await tryRunCommand(`pkill -f '${RELEASE_SERVER_MATCHER.replace(/'/g, "'\\''")}' || true`);
  await tryRunCommand(`pkill -f '${APP_MATCHER.replace(/'/g, "'\\''")}' || true`);
  await sleep(1500);
}

async function fetchHealth(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await fetchHealth(port);
    if (health?.ok) {
      return health;
    }
    await sleep(600);
  }
  throw new Error(`Timed out waiting for healthy workbench server on port ${port}`);
}

async function main() {
  await killExistingReleaseApp();

  const blocker = http.createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('occupied-by-smoke-test');
  });

  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(PRIMARY_PORT, '127.0.0.1', resolve);
  });

  let appProcess = null;
  try {
    appProcess = spawn(APP_EXECUTABLE, [], {
      detached: true,
      stdio: 'ignore',
    });
    appProcess.unref();

    const fallbackHealth = await waitForHealth(FALLBACK_PORT, STARTUP_TIMEOUT_MS);
    const primaryHealth = await fetchHealth(PRIMARY_PORT);

    console.log(JSON.stringify({
      primaryPort: PRIMARY_PORT,
      fallbackPort: FALLBACK_PORT,
      fallbackHealth,
      primaryHealth,
      passed: Boolean(fallbackHealth?.ok && fallbackHealth.port === FALLBACK_PORT),
    }, null, 2));

    if (!fallbackHealth?.ok || fallbackHealth.port !== FALLBACK_PORT) {
      throw new Error(`Expected release app to recover to port ${FALLBACK_PORT}`);
    }
  } finally {
    blocker.close();
    await killExistingReleaseApp();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

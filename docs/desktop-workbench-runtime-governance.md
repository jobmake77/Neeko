# Desktop Workbench Runtime Governance

Last updated: 2026-04-29

## Scope

This note documents how the desktop client selects, starts, probes, and cleans up the local `workbench-server` runtime.

It applies to:

- `desktop/src/lib/api.ts`
- `desktop/src/lib/tauri.ts`
- `src/shared/workbench-recovery.ts`
- `desktop/src-tauri/src/lib.rs`

## Runtime topology

The desktop app always talks to a local HTTP workbench server.

Common layouts:

- Debug desktop app:
  - app binary: `desktop/src-tauri/target/debug/neeko-workbench`
  - runtime root: `desktop/src-tauri/target/debug/_up_/runtime/neeko-runtime`
  - preferred port: `4310`
- Packaged release app:
  - app bundle: `desktop/src-tauri/target/release/bundle/macos/Neeko 客户端.app`
  - runtime root: `Contents/Resources/_up_/runtime/neeko-runtime`
  - preferred port: `4310`, with local fallback probing across `4311`, `4312`, `4313`

The frontend must treat `4310-4313` as a local candidate set, not as a single fixed port.

## Bootstrap and recovery flow

Frontend bootstrap flow:

1. Read `neeko.apiBaseUrl` from local storage.
2. Normalize it to `http://127.0.0.1:<port>`.
3. Probe `/health`.
4. If unhealthy, try local fallback candidates in this order:
   - current port
   - `4310`
   - `4311`
   - `4312`
   - `4313`
5. If none is healthy, invoke the Tauri bootstrap command.
6. After bootstrap, re-probe the resolved port and persist the recovered base URL.

Current health probe contract:

- `GET /health` must return:
  - `ok=true`
  - `build_id`
  - `server_version`

The desktop recovery layer intentionally does **not** require `/api/personas` to answer before treating a local instance as healthy. This avoids false negatives when a stale or overloaded local instance can still recover after routing to a newer managed port.

## Port semantics

- `4310` is the default starting port.
- `4311-4313` are reserved local fallback ports.
- The packaged app may legitimately run on `4311` when `4310` is occupied.
- Users should not be exposed to this distinction in product UI.

## Cleanup semantics

### On startup

Before spawning a new `workbench-server`, the Tauri bootstrap layer scans the target port for an existing listener.

Cleanup is allowed only when all of the following are true:

- the listener is on the target bootstrap port
- the process command line contains the same `runtime_root`
- the process command line contains `workbench-server`

This guard prevents the desktop app from killing unrelated local processes that happen to use the same port.

### On shutdown

The desktop app tracks the spawned child process and now terminates the **entire process group** on exit, not just the direct child PID.

This reduces the chance of leaving behind:

- orphan `workbench-server` processes
- descendant helper processes that outlive the app

## Known limitation

If a historical debug server has already entered an unkillable macOS `UE` state, user-space cleanup may fail even with `SIGKILL`.

Observed behavior:

- listener remains on `4310`
- `kill` and `kill -9` have no effect
- process parent is already `1`

In that case:

- the desktop app should recover to a healthy fallback port
- the stale process is considered a system-level artifact
- a full machine restart is the reliable cleanup path

## Testing guidance

Minimum coverage for this area should include:

1. Recovery logic:
   - healthy fallback port is adopted without bootstrap
   - bootstrap result can resolve to a different port
2. Stale listener filtering:
   - same runtime + `workbench-server` is eligible for cleanup
   - different runtime is not eligible
   - non-`workbench-server` processes are not eligible
3. Desktop build:
   - `cargo check --manifest-path desktop/src-tauri/Cargo.toml`
   - `npm run -s desktop:build`

## Operational guidance

When debugging local desktop connectivity issues:

1. Check `http://127.0.0.1:4310-4313/health`
2. Confirm which runtime owns the healthy port
3. Prefer the packaged app managed runtime over stale debug leftovers
4. If `4310` is occupied by an unresponsive debug process, do not block the user on it; allow failover to `4311+`

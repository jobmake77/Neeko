# Client Minimal V2 Implementation Note

Updated: 2026-04-25  
Owner: PM-Orchestrator agent  
Audience: Main agent, Desktop agent, Service agent, QA agent

## Goal

Coordinate the current desktop-first `Client Minimal V2` cut as a narrow, reviewable integration effort.

This note defines:

- task split and ownership boundaries
- integration acceptance checklist
- rollout risks, migration impact, and GUI verification expectations

This is a coordination artifact only. It does not authorize scope expansion beyond the current stage rules.

## Fixed Constraints

- Do not modify `src/core/pipeline/ingestion/article.ts` in this rollout.
- PM-Orchestrator output is documentation only; no service logic, test logic, or UI implementation is included here.
- Keep the product surface limited to `Chat / Personas / Settings`.
- Do not re-expose internal product terms such as `Soul`, `Memory`, `Training`, `Experiment`, `Export`, `Evidence`, or `Inspector` in the primary desktop UI.
- Keep the writeback contract conservative:
  - conversation layer may write `conversation log`, `session summary`, and `memory candidates`
  - `promotion-ready -> handoff artifact -> training prep artifact` remains an internal safety chain
  - no direct write to formal persona assets from chat flow
- When local service URL is used, the desktop app should prefer automatic detect, automatic start, and automatic reconnect behavior.

## Recommended Workstreams

### 1. Desktop Shell and Navigation

Owner: Desktop shell agent

Primary modules:

- `desktop/src/App.tsx`
- `desktop/src/components/layout/AppShell.tsx`
- `desktop/src/components/layout/Sidebar.tsx`
- `desktop/src/components/layout/TopBar.tsx`
- `desktop/src/stores/app.ts`
- `desktop/src/lib/i18n.ts`
- `desktop/src/lib/i18n-provider.tsx`
- `desktop/src/styles/globals.css`

Responsibilities:

- keep the first-level product structure limited to `Chat`, `Personas`, and `Settings`
- keep Chinese as default desktop language while preserving bilingual switching
- ensure navigation wording stays user-facing and does not leak internal pipeline concepts
- preserve responsive desktop layout quality without reopening deprecated dashboard panels

Out of scope:

- new workflow dashboards
- internal governance or evidence consoles
- large visual redesign outside the current shell cut

### 2. Chat Surface

Owner: Chat UX agent

Primary modules:

- `desktop/src/components/chat/ChatView.tsx`
- `desktop/src/components/chat/ChatInput.tsx`
- `desktop/src/components/chat/MessageList.tsx`
- `desktop/src/stores/chat.ts`
- `desktop/src/lib/types.ts`
- `desktop/src/lib/api.ts`

Responsibilities:

- keep Chat limited to current persona, thread list, message stream, and input box
- preserve attachment entry only if it stays within current product contract
- avoid reintroducing evidence import, training context, writeback state, or summary side panels into Chat
- ensure message-level wording stays product-safe and does not expose hidden runtime internals

Out of scope:

- promotion management UI
- training prep visualization
- inspector-style debug drawers

### 3. Persona Library and Persona Editing

Owner: Persona agent

Primary modules:

- `desktop/src/components/persona/PersonaView.tsx`
- `desktop/src/components/persona/PersonaCard.tsx`
- `desktop/src/components/persona/PersonaEditor.tsx`
- `desktop/src/components/persona/CultivationCenter.tsx`
- `desktop/src/components/persona/PersonaGenesisAscii.tsx`
- `desktop/src/stores/persona.ts`
- `desktop/src/stores/cultivation.ts`

Responsibilities:

- keep the `list on the left + detail editor on the right` structure stable
- preserve the two-step persona creation flow
- keep post-save rebuild behavior automatic and backgrounded
- keep deletion semantics aligned with hard delete of local persona-related assets

Out of scope:

- archive mode for persona deletion
- exposing training internals as first-level concepts
- bringing back legacy multi-panel workbench flows

### 4. Settings and Local Service Recovery

Owner: Integration agent

Primary modules:

- `desktop/src/components/settings/SettingsView.tsx`
- `desktop/src/lib/tauri.ts`
- `desktop/src/lib/api.ts`
- `desktop/src/stores/app.ts`
- `desktop/src-tauri/src/lib.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src-tauri/tauri.conf.json`

Related backend-facing integration points:

- `src/cli/commands/workbench-server.ts`
- `src/cli/index.ts`
- `src/core/workbench/service.ts`

Responsibilities:

- keep Settings limited to API address, local service connection, language, and data directory or repo root
- make local service recovery behavior user-friendly when the target is local
- keep failure wording actionable and concise instead of surfacing raw backend details
- ensure desktop-managed service behavior remains aligned with bundled runtime assumptions

Out of scope:

- new training forms
- experiment launch forms in Settings
- exposing internal health diagnostics as a primary settings experience

### 5. Packaging and Runtime Staging

Owner: Runtime and release agent

Primary modules:

- `desktop/src-tauri/**`
- runtime staging scripts and packaging pipeline assets outside Git-tracked staging outputs

Responsibilities:

- ensure packaged desktop app carries `desktop/runtime/neeko-runtime`
- ensure bundled runtime includes `dist`, production dependencies, `bin/node`, and required `scripts/`
- keep staging directories ignored from Git
- validate that packaged app prefers bundled runtime over host-installed Node

Out of scope:

- ad hoc dependency on the developer machine runtime
- checking in staged runtime artifacts

## Sequencing Guidance

Recommended integration order:

1. shell and navigation contract
2. chat surface restraint
3. persona library and creation flow
4. settings and local service recovery
5. packaged runtime verification
6. final end-to-end GUI pass

Reasoning:

- the top-level information architecture must settle first
- chat and persona pages depend on that product contract
- local service recovery and packaging are integration-critical and should be validated after the visible surface is stable

## Hard Boundaries for This Rollout

- No edits to `src/core/pipeline/ingestion/article.ts`.
- No broad refactor across `src/core/pipeline/**`.
- No reopening a browser-based surface as the primary product surface.
- No return of old workbench-first vocabulary in desktop primary navigation.
- No direct chat-to-formal-asset writeback path.
- No scope creep into benchmark governance, experiment dashboarding, or review console features.

## Integration Acceptance Checklist

### Product Scope

- [ ] Primary desktop navigation exposes only `Chat`, `Personas`, and `Settings`
- [ ] No first-level desktop surface reintroduces `Soul`, `Memory`, `Training`, `Experiment`, `Export`, `Evidence`, or `Inspector`
- [ ] Chat does not grow side panels or workflow consoles outside the approved minimal contract
- [ ] Settings remains a basic settings page rather than a hidden operations panel

### Chat Acceptance

- [ ] Chat shows only current persona, thread list, message stream, and input box as first-order UI
- [ ] Thread create, rename, switch, and delete still work after integration
- [ ] Send flow remains available with keyboard shortcut behavior intact
- [ ] Message rendering does not expose internal debug or hidden-memory wording
- [ ] Attachment entry, if present, does not imply unsupported ingest or training behavior

### Persona Acceptance

- [ ] Personas page preserves `left list + right detail editor`
- [ ] Persona creation remains a two-step flow
- [ ] Persona save triggers background rebuild behavior without requiring manual extra steps
- [ ] Persona deletion wording matches hard-delete semantics and does not imply archive recovery
- [ ] Persona list, detail view, and cultivation status remain internally consistent after edits

### Settings and Recovery Acceptance

- [ ] Settings exposes API address, local service connection, language, and data directory or repo root
- [ ] When configured with a local URL, the app attempts automatic detect, automatic start, and automatic reconnect
- [ ] Local service failure wording stays user-facing and avoids raw implementation noise
- [ ] Non-local connection behavior does not incorrectly claim desktop-managed recovery

### Packaging Acceptance

- [ ] Packaged app starts with bundled runtime instead of assuming host Node
- [ ] Bundled runtime includes `dist`, production dependencies, `bin/node`, and required `scripts/`
- [ ] Git diff does not include staged runtime payloads
- [ ] Desktop bundle startup path remains compatible with local service recovery flow

### Governance and Data Safety Acceptance

- [ ] Chat-layer write targets remain limited to `conversation log`, `session summary`, and `memory candidates`
- [ ] No GUI path claims direct write into formal persona assets
- [ ] `handoff artifact` and `training prep artifact` remain internal adaptation layers rather than primary user-facing concepts
- [ ] UI copy remains conservative about background rebuilds, updates, and recovery state

## Risks and Migration Impact

### Risk 1. Old Workbench Concepts Leak Back Into the Minimal Client

Impact:

- product direction becomes inconsistent
- new users see internal concepts instead of the intended desktop mental model
- future GUI simplification becomes more expensive

Mitigation:

- reject new first-level entry points beyond `Chat / Personas / Settings`
- treat legacy inspector, evidence, and experiment panels as opt-in follow-up work, not default scope

### Risk 2. Local Service Recovery Feels Broken or Noisy

Impact:

- users interpret recoverable local startup failures as app instability
- packaged app quality appears lower than the actual backend reliability

Mitigation:

- distinguish local versus remote connection behavior clearly
- prefer automatic recovery before surfacing user-facing failure states
- keep messages short, actionable, and free of backend jargon

### Risk 3. Persona Delete Semantics Are Misunderstood

Impact:

- users may expect archive recovery that no longer exists
- accidental deletion becomes a trust issue

Mitigation:

- keep wording explicit that deletion is local hard delete
- verify confirmations and post-delete refresh behavior in GUI pass

### Risk 4. Bundled Runtime Drift Causes Packaging Regressions

Impact:

- app works in repo mode but fails in packaged mode
- launch behavior becomes machine-dependent

Mitigation:

- verify packaged-mode startup explicitly
- validate presence of runtime assets before release cut
- keep runtime staging outputs outside Git

### Risk 5. Internal Safety Layers Become User-Facing Product Debt

Impact:

- users learn implementation artifacts instead of product concepts
- later renaming or hiding becomes a migration problem

Mitigation:

- keep `handoff artifact` and `training prep artifact` out of first-level GUI wording
- allow those concepts in diagnostics or trace files only when operationally required

## GUI Verification Checklist

### Navigation and Entry

- [ ] Launch lands in a coherent desktop shell with only three first-level destinations
- [ ] Chinese is the default language on first open
- [ ] Language switching does not break navigation labels or layout width
- [ ] No leftover entry exposes deprecated internal workbench terminology

### Chat Flow

- [ ] Switching persona updates the active chat context correctly
- [ ] Thread list operations behave correctly with existing conversation data
- [ ] Empty state, loading state, and send failure state are understandable without backend jargon
- [ ] Input box remains usable on both compact and wide desktop window sizes

### Personas Flow

- [ ] Persona list selection updates the right-side detail editor predictably
- [ ] Two-step creation feels linear and does not expose old training forms
- [ ] Save feedback is visible without requiring users to inspect logs
- [ ] Delete confirmation clearly communicates hard-delete semantics

### Settings Flow

- [ ] Local URL configuration can trigger recovery behavior without manual CLI steps
- [ ] Remote URL configuration does not pretend the desktop app can manage remote service startup
- [ ] Repo root or data directory configuration is understandable and discoverable
- [ ] Error messaging remains concise and user-facing

### Packaged App Smoke

- [ ] Packaged app can start on a machine path that does not depend on source checkout layout
- [ ] Packaged app can recover local service using bundled runtime assets
- [ ] Missing runtime asset behavior is fail-fast and explainable

## Handoff Expectations for Main Agent

Before merge or rollout, the main agent should confirm:

- the actual implementation owners stayed within their assigned module boundaries
- no protected or unrelated files were changed as part of convenience edits
- `src/core/pipeline/ingestion/article.ts` remained untouched
- the final GUI still represents the current stage direction instead of reviving legacy workbench scope
- packaged-mode verification was performed separately from repo-mode verification

## Exit Criteria

This rollout is ready for main-thread integration when:

1. scope remains limited to the current `Client Minimal V2` contract,
2. desktop GUI behavior is stable across `Chat / Personas / Settings`,
3. local service recovery works conservatively for local targets,
4. packaged runtime behavior is validated without host-runtime assumptions,
5. no forbidden internal concepts leak back into the primary product surface.

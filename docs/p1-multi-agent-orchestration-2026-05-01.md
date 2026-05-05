# P1 Multi-Agent Orchestration: Network Answering, Source Reliability, Cultivation Stability, and Runtime Diagnostics

Updated: 2026-05-01
Owner: Agent C / Orchestrator
Audience: Main agent, Agent A / Dev, Agent B / Test

## Goal

Provide an execution-ready coordination artifact for the current P1 round.

This document locks five things for the round:

- milestone order and dependency direction
- per-agent file boundaries
- interface contracts that must not fork during implementation
- acceptance gates for each milestone
- merge readiness, risk tracking, and no-expansion rules

This is governance only. It does not authorize edits to production logic or test logic by Agent C.

## Round Scope

This round covers exactly three problem clusters:

1. network answer quality and grounded claim usage
2. source quality judgment and cultivation continuation stability
3. desktop runtime diagnostics for stale debug listener scenarios

This round does not cover:

- training core loop rewrite
- graph database introduction
- live web search during chat
- broad ingestion adapter expansion
- new first-level product surfaces beyond `Chat / Personas / Settings`

## Fixed Constraints

- Agent C output remains documentation-only.
- Agent A owns implementation; Agent B owns tests and validation.
- Do not rename existing phase-stable contracts unless the main agent explicitly re-plans the round.
- Do not surface internal reasoning schema directly in first-level user copy.
- Runtime work must treat stale `UE` debug processes as a detect/isolate/failover problem, not a guaranteed user-space cleanup problem.
- Existing `soft-close / retrain / threshold / source-sync` semantics must not regress.

## 1. Current Phase Taskboard

### Milestone order

| Milestone | Owner | Allowed files | Depends on | Acceptance gate |
| --- | --- | --- | --- | --- |
| M0. Lock contracts and execution boundaries | Agent C | docs only | none | This document is agreed as the single orchestration source for the round |
| M1. Network answer planning enhancement | Agent A | `src/core/workbench/service.ts`, `src/core/models/workbench.ts`, minimal `src/core/pipeline/persona-web.ts` if required | M0 | Aggregated grounded claims can be compiled into layered answer plans without reintroducing meta deflection when confirmed self claims exist |
| M2. Network answer regression coverage | Agent B | `test/workbench-p1-regression.test.mjs`, optional `test/network-answer-planning.test.mjs`, `src/testing/**` if needed | M1 contract shape locked by M0 | Multi-source claim aggregation, ownership precedence, and no-deflection behavior are covered by repeatable tests |
| M3. Source relevance and stickiness enhancement | Agent A | `src/core/workbench/service.ts`, `src/core/pipeline/ingestion/article.ts`, `src/core/models/workbench.ts`, `desktop/src/lib/types.ts` if needed | M0 | Preview and ingest share stable relevance buckets and structured reason codes for page quality and person relevance |
| M4. Source quality regression coverage | Agent B | `test/source-attribution-preview.test.mjs`, `test/workbench-p1-regression.test.mjs`, `src/testing/**` if needed | M3 contract shape locked by M0 | Homepage, project site, aggregator, mismatch, and weak-related cases resolve to stable buckets and reason codes |
| M5. Cultivation continuation stabilization | Agent A | `src/core/workbench/service.ts`, `desktop/src/components/persona/CultivationCenter.tsx`, `src/core/models/workbench.ts`, `desktop/src/lib/types.ts` | M0, M3 | Continuation decisions consume source-level health and emit a stable `next_action` without high-frequency no-op loops |
| M6. Cultivation regression coverage | Agent B | `test/workbench-p1-regression.test.mjs`, `src/testing/**` if needed | M5 contract shape locked by M0 | Cooldown skip, source switching, stop-reason mapping, retrain/soft-close regressions all remain stable |
| M7. Runtime diagnostics enhancement | Agent A | `desktop/src/components/settings/SettingsView.tsx`, `desktop/src/lib/api.ts` or `desktop/src/lib/tauri.ts`, `src/shared/workbench-recovery.ts`, `docs/desktop-workbench-runtime-governance.md` | M0 | Settings diagnostics can explain stale `4310` occupancy and fallback adoption without claiming impossible cleanup |
| M8. Runtime recovery validation | Agent B | `test/desktop-api-recovery.test.mjs`, `scripts/smoke-desktop-release-fallback.mjs` if needed | M7 | Recovery tests and release smoke cover stale listener plus healthy fallback scenarios |
| M9. Final integration review | Agent C + main agent | docs only from Agent C | M1-M8 | Interfaces remain aligned, no forbidden scope spread appears, and merge checklist passes |

### Dependency notes

- M1 must define the claim aggregation shape before M2 adds stable test expectations.
- M3 must reuse, not bypass, M0 interface naming discipline.
- M5 must consume source quality and source health outputs from M3 rather than inventing parallel continuation state.
- M7 must align with runtime recovery behavior already documented in `/Users/a77/Desktop/Neeko/docs/desktop-workbench-runtime-governance.md`.
- Agent B may add thin test exports only when implementation contracts are already fixed by Agent A or M0.

## 2. File Boundary Matrix

### Agent A / Dev

Allowed primary edit targets:

- `/Users/a77/Desktop/Neeko/src/core/workbench/service.ts`
- `/Users/a77/Desktop/Neeko/src/core/models/workbench.ts`
- `/Users/a77/Desktop/Neeko/src/core/pipeline/persona-web.ts`
- `/Users/a77/Desktop/Neeko/src/core/pipeline/ingestion/article.ts`
- `/Users/a77/Desktop/Neeko/desktop/src/lib/types.ts`
- `/Users/a77/Desktop/Neeko/desktop/src/components/persona/CultivationCenter.tsx`
- `/Users/a77/Desktop/Neeko/desktop/src/components/settings/SettingsView.tsx`
- `/Users/a77/Desktop/Neeko/desktop/src/lib/api.ts`
- `/Users/a77/Desktop/Neeko/desktop/src/lib/tauri.ts`
- `/Users/a77/Desktop/Neeko/src/shared/workbench-recovery.ts`

Not allowed without explicit re-plan:

- broad edits across `src/core/pipeline/**` outside the files above
- chat surface redesign work outside data routing required for this round
- training loop redesign
- new runtime port policy beyond current `4310-4313` candidate semantics

### Agent B / Test

Allowed primary edit targets:

- `/Users/a77/Desktop/Neeko/test/**`
- `/Users/a77/Desktop/Neeko/src/testing/**`
- test fixtures or thin exports strictly required to exercise the locked contracts

Not allowed without explicit re-plan:

- production behavior changes disguised as test helpers
- rewriting runtime bootstrap behavior in tests instead of validating the locked contract

### Agent C / Orchestrator

Allowed primary edit targets:

- `/Users/a77/Desktop/Neeko/docs/**`
- `/Users/a77/Desktop/Neeko/AGENTS.md` only if a permanent repository rule must be synchronized

Not allowed:

- production code changes
- test logic changes
- incidental refactors

## 3. Locked Interface Checklist

The following interfaces are locked for this round. Additive fields are allowed only if they do not rename, split, or bypass the contract.

### 3.1 Claim aggregation contract

Locked names:

- `ClaimCandidate`
- `ClaimSupport`
- `ClaimOwnership`

Locked behavior:

- graph relations, project hits, and community or context hits must aggregate onto a stable claim identity before answer planning
- ownership scoring must consider semantic type, direct self evidence, multi-source support, and ownership signals together
- background-only support must never be promoted into first-person self-owned claims

Not allowed:

- adding a parallel alias contract for the same purpose
- bypassing aggregation by feeding raw graph relations directly into final answer planning for the same query path

### 3.2 Answer plan contract

Locked names:

- `AnswerPlan`
- `NetworkAnswerPack`
- `ChatRetrievalPlan`

Locked behavior:

- `compileAnswerPlan()` must be able to express at least four layers:
  - `confirmed_self_claims`
  - `related_context_claims`
  - `background_only_claims`
  - `blocked_claims`
- when confirmed self claims exist, meta deflection is not an acceptable fallback
- relation, project, background, and hybrid queries may share infrastructure, but must preserve ownership distinctions in the output plan

Not allowed:

- surfacing these internal contract names in first-level user UI copy
- using answer planning as a replacement for training-state or source-governance objects

### 3.3 Source relevance contract

Locked names:

- `ExtractionQualityAssessment`
- `SourceIngestOutcome`
- `SourceFailureClass`
- `PersonaSourceHealth`

Locked buckets:

- `direct_owner`
- `strong_related`
- `weak_related`
- `mismatch`

Locked behavior:

- preview and ingest must use the same structured relevance classification layer
- user-facing copy may summarize the result conservatively, but internal reason codes must remain structured and stable
- aggregator pages, directory pages, navigation pages, wrong-person pages, and weak background pages must not silently collapse into accepted owner-like sources

Not allowed:

- one-off string heuristics in UI that reinterpret backend relevance buckets
- bucket name drift between preview and ingest code paths

### 3.4 Cultivation continuation contract

Locked names:

- `next_action`
- `SourceSyncCheckpoint`

Locked `next_action` values:

- `retry_same_source`
- `switch_source`
- `wait_for_cooldown`
- `pause_until_updates`
- `ready_for_retrain`
- `soft_close_candidate`

Locked behavior:

- continuation decisions must combine persona-level state and source-level health
- one degraded or cooling-down source must not block other healthy sources
- the desktop cultivation surface should consume `next_action` rather than reconstructing policy from loosely related fields

Not allowed:

- adding same-purpose action aliases in UI or service code
- reintroducing high-frequency continuation loops when all sources are in cooldown or exhaustion states

### 3.5 Runtime diagnostics contract

Locked behavior:

- `4310` is not the only successful local runtime outcome
- a stale `4310` listener with failed `/health` must be represented as a stale debug occupancy case when fallback succeeds elsewhere
- release and debug diagnostics must not promise user-space removal of `UE` state processes

Locked display scope:

- diagnostics are allowed in Settings or operator-facing views
- diagnostics are not allowed to leak as noisy first-level user workflow states elsewhere

Not allowed:

- implying the app has fully healed the stale system process
- regressing fallback probing across `4310-4313`

## 4. Risk and Open Issues Register

| ID | Risk | Probability | Impact | Trigger signal | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Claim aggregation adds complexity but still leaves flat answer composition | Medium | High | Answers improve on projects but remain weak on relation or hybrid questions | Keep M1 acceptance focused on layered answer planning, not only more claim volume | Agent A, main agent |
| R2 | Ownership scoring becomes too permissive and upgrades background context to first-person facts | Medium | High | Chat starts claiming ownership of third-party projects or websites | Keep provenance guardrails and blocked-claim path mandatory in M1 and M2 | Agent A, Agent B |
| R3 | Source relevance buckets drift between preview and ingest | Medium | High | Preview says recommended while ingest quarantines the same source without matching reason | Force M3 shared structured reason codes and M4 drift tests | Agent A, Agent B |
| R4 | Continuation logic forks into persona-level and source-level parallel policy systems | Medium | High | UI still infers behavior from old stop fields while service emits `next_action` | Treat `next_action` as the single downstream policy summary for cultivation UI | Agent A |
| R5 | Runtime diagnostics overfit to one machine's stale `4310` case | Medium | Medium | Diagnostics mention implementation-specific cleanup promises or fail to generalize | Keep wording centered on stale debug occupancy and fallback adoption only | Agent A, Agent C |
| R6 | Scope spread into unrelated training or chat UX work | Medium | High | Implementation diff touches additional training loop or chat shell files without necessity | Main agent enforces file boundary review before merge | Main agent |
| R7 | Test harness requires thin exports not yet stabilized | Medium | Medium | Agent B blocks because internal helpers are inaccessible or too volatile | Allow thin exports only after contract names and shapes are frozen | Agent A, Agent B |
| R8 | Existing `soft-close / retrain / source-sync` behavior regresses under new continuation policy | Medium | High | Old personas loop incorrectly, stop early, or never re-enter retrain | Make regression coverage a hard gate in M6 | Agent B, main agent |

## 5. Stage Acceptance Gates

### Gate A: Network answering

All of the following must hold:

- project queries prefer confirmed self claims over background-only context
- relation and hybrid queries do not fall back to meta deflection when grounded self claims exist
- blocked claims remain unavailable to first-person generation
- test coverage includes at least one multi-source aggregation case and one background-vs-owned disambiguation case

### Gate B: Source quality and relevance

All of the following must hold:

- homepage and project site cases can resolve to owner or strong-related buckets when evidence supports it
- aggregator, directory, mismatch, and weak-related cases are stably separated
- preview and ingest reason codes do not drift for the same underlying source condition
- user-facing copy remains descriptive rather than schema-like

### Gate C: Cultivation stability

All of the following must hold:

- one source in cooldown does not block other sources
- exhausted versus provider-failed states map to stable `next_action` outcomes
- no-progress personas do not continue high-frequency empty continuation loops
- existing soft-close and retrain behavior remains intact

### Gate D: Runtime diagnostics

All of the following must hold:

- Settings can explain stale debug occupancy when fallback succeeded on another port
- recovery logic still accepts healthy fallback ports instead of insisting on `4310`
- release smoke remains green
- runtime docs stay aligned with actual fallback behavior

## 6. Merge Readiness Checklist

### Scope and ownership

- [ ] Agent A changes stay within the approved production file boundary
- [ ] Agent B changes stay within tests, fixtures, and thin test exports only
- [ ] Agent C changes stay within docs and governance artifacts only
- [ ] No same-purpose parallel contract names were introduced

### Network answer layer

- [ ] Claim aggregation exists before answer planning
- [ ] Ownership scoring uses more than one signal family
- [ ] `AnswerPlan` supports confirmed, related-context, background-only, and blocked claim layers
- [ ] Meta deflection no longer appears when confirmed self claims exist

### Source quality and relevance

- [ ] Preview and ingest share a structured relevance layer
- [ ] `direct_owner / strong_related / weak_related / mismatch` are stable and test-covered
- [ ] Aggregator and wrong-person sources are not silently accepted
- [ ] UI copy does not expose raw internal codes directly

### Cultivation stability

- [ ] `next_action` is emitted and consumed as the downstream continuation summary
- [ ] Source cooldown does not globally stall multi-source personas
- [ ] Old stop-reason and soft-close regressions are covered
- [ ] No high-frequency no-op deep fetch loop remains in the validated scenarios

### Runtime diagnostics and packaging

- [ ] Stale `4310` occupancy is diagnosable without pretending user-space cleanup is guaranteed
- [ ] Fallback probing across `4310-4313` remains intact
- [ ] Recovery tests and release smoke pass
- [ ] Docs and diagnostics wording match the actual runtime policy

### Product boundary

- [ ] No first-level UX expands beyond `Chat / Personas / Settings`
- [ ] No internal claim schema leaks into user-facing primary product language
- [ ] Existing `soft-close / retrain / threshold / source-sync` semantics do not regress

## 7. No-Expansion Rules

Until the main agent explicitly re-plans the round, do not use this document as justification to:

- rewrite the training core loop
- add live web search to chat
- introduce graph database dependencies
- widen the desktop product surface beyond `Chat / Personas / Settings`
- create a new evidence console or relationship inspector as a first-level feature
- broaden runtime port management beyond the currently documented local candidate set

## 8. Handoff Requirements

### Agent A -> Agent B

Each delivery must include:

- `changed files`
- behavior changes per file
- added or modified types and fields
- impact on existing behavior
- unverified paths
- areas that require focused regression coverage

### Agent B -> Agent A

Each delivery must include:

- covered behaviors
- uncovered behaviors
- failing cases
- minimal reproduction inputs
- expected versus actual behavior
- blocker classification: implementation gap or test harness gap

### Agent C -> main agent

Each delivery must include:

- current stage completion
- locked interfaces
- forbidden expansion zones
- merge readiness status
- risk and open issue summary

## 9. Merge Position

This round is not merge-ready at orchestration time.

It becomes merge-ready only when:

1. all milestone acceptance gates pass,
2. locked interfaces remain un-forked,
3. runtime diagnostics stay aligned with actual recovery behavior,
4. no forbidden scope spread appears,
5. the main agent can integrate Agent A and Agent B outputs without reopening contract naming.

# Client Minimal V2 Phase Taskboard and Governance

Updated: 2026-04-27
Owner: Agent C / PM-Orchestrator
Audience: Main agent, Desktop agent, Service agent, Chat agent, QA agent

## Goal

Provide a merge-oriented coordination artifact for the current `Client Minimal V2` phase without reopening implementation scope.

This document locks four things for the current stage:

- milestone-level task ownership
- cross-agent dependency and acceptance gates
- interface alignment boundaries for the current source/chat contracts
- final merge readiness checks and no-expansion rules

This document is governance only. It does not authorize edits to core business logic.

## Fixed Constraints

- This round is documentation-only from Agent C / PM-Orchestrator.
- Do not modify core implementation files under `src/**`, `desktop/src/**`, or `desktop/src-tauri/**` from this task.
- Keep the product surface constrained to `Chat / Personas / Settings`.
- Do not reopen browser-first product direction.
- Do not re-expose internal product terms such as `Soul`, `Memory`, `Training`, `Experiment`, `Export`, `Evidence`, or `Inspector` in first-level desktop UX.
- Do not reopen direct writeback from chat flow into formal persona assets.
- Do not expand source ingestion scope by modifying `src/core/pipeline/ingestion/article.ts` in this phase.

## 1. Current Phase Taskboard

| Milestone | Owner | Dependencies | Acceptance Gate |
| --- | --- | --- | --- |
| M1. Freeze `Client Minimal V2` product boundary | Main agent | Current stage rules in `AGENTS.md`, `docs/client-minimal-v2-implementation-note.md` | `Chat / Personas / Settings` stays the only first-level surface; no internal workflow vocabulary returns to primary UX |
| M2. Stabilize desktop shell and navigation wording | Desktop agent | M1 | Navigation, labels, empty states, and shell layout remain user-facing, bilingual-safe, and free of deprecated workbench terminology |
| M3. Restrain chat surface to the approved minimal contract | Chat agent | M1, M2 | Chat shows current persona, thread list, message stream, and input only; no side-channel evidence, writeback, or inspector panels are reintroduced |
| M4. Keep persona library flow stable and backgrounded | Persona agent | M1, M2 | `left list + right detail editor` remains stable; persona creation stays wizard-based; save still triggers background rebuild |
| M5. Make local service recovery conservative and product-safe | Service agent, Integration agent | M1, M2 | Local URL path prefers auto-detect, auto-start, and auto-reconnect; remote URL path does not pretend desktop-managed recovery |
| M6. Lock source and chat interface semantics for current phase | Main agent, Service agent, Chat agent | M1, M3, M5 | All seven named contracts below have agreed ownership, dependency, and acceptance wording; no same-purpose parallel contracts are introduced |
| M7. Verify packaging and bundled runtime discipline | Runtime and release agent | M5 | Bundled runtime includes `dist`, production dependencies, `bin/node`, and required `scripts/`; staged runtime payloads stay out of Git |
| M8. Complete merge readiness review | Main agent, QA agent | M2, M3, M4, M5, M6, M7 | Merge checklist passes; protected scope stays intact; cross-agent changes are reviewable and do not spill into forbidden modules |

## 2. Risk Register

| Risk | Probability | Impact | Trigger Signal | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| Legacy workbench concepts leak back into the minimal client | Medium | High | New first-level tabs, drawers, or copy reintroduce internal workflow nouns | Reject new first-level entry points; keep advanced diagnostics behind non-primary flows only if already approved elsewhere | Main agent, Desktop agent |
| Source contract work spreads into unrelated ingestion logic | Medium | High | Interface alignment work triggers edits across `src/core/pipeline/**` or `article.ts` | Keep this phase at contract alignment level; defer broad ingestion refactors; require explicit re-plan before touching protected modules | Main agent, Service agent |
| Chat contract drifts from training/runtime realities | Medium | High | UI or API starts promising source-grounded answers that runtime cannot conservatively supply | Lock names and semantic responsibilities first; require QA walkthrough with conservative-answer negative cases | Chat agent, QA agent |
| Local service recovery wording overpromises self-healing | Medium | Medium | Settings or banners imply remote services can also be auto-managed | Separate local and remote connection semantics in copy and acceptance checks | Integration agent |
| Interface names fork into near-duplicate variants across agents | Medium | High | New sibling names appear for the same purpose during implementation | Treat the seven contracts below as the only allowed names for this phase; rename proposals require main-agent approval before merge | Main agent |
| Packaged runtime validation is skipped because repo mode works | Medium | High | Merge is proposed without packaged-path verification evidence | Keep packaged-runtime verification as a hard acceptance gate rather than a release-time TODO | Runtime and release agent, QA agent |
| Governance terms leak into end-user UX | Low | Medium | `handoff artifact`, `training prep artifact`, or internal source-health jargon shows up in primary UI | Restrict governance vocabulary to docs, traces, and operator-only review material | Desktop agent, Main agent |

## 3. Interface Alignment Checklist

### 3.1 Lock Rule for This Phase

The current phase uses a narrow lock policy:

- interface name is locked
- primary responsibility boundary is locked
- upstream/downstream dependency direction is locked
- acceptance wording is locked
- additive payload detail is allowed only if it does not rename, split, or bypass the contract

Not allowed in this phase:

- introducing same-purpose alias contracts
- silently renaming the seven contracts below
- moving a contract across product layers without main-agent approval
- expanding contract work into unrelated ingestion, training, or UI scope

### 3.2 Contract Table

| Contract | Intended Layer | Owner | Upstream Dependency | Downstream Dependency | Phase Lock | Acceptance Gate |
| --- | --- | --- | --- | --- | --- | --- |
| `SourceFailureClass` | Service / source governance | Service agent | source fetch, ingest, sync failure detection | persona source health summary, retry/recovery messaging | Locked | Failure classes are enumerable, non-overlapping, and safe to surface indirectly through user-facing recovery wording |
| `PersonaSourceHealth` | Service -> desktop persona/cultivation summary | Service agent, Desktop agent | `SourceFailureClass`, source freshness and availability checks | persona list/detail status, cultivation summary, continue/check-update gating | Locked | Health states remain persona-scoped, conservative, and do not expose raw backend jargon in primary UI |
| `SourceIngestOutcome` | Service / ingestion result contract | Service agent | source ingest execution | extraction assessment, checkpointing, review summaries | Locked | Outcome clearly distinguishes success, partial, blocked, and failed paths without requiring UI to infer hidden state |
| `ExtractionQualityAssessment` | Service / evaluation summary | Service agent | `SourceIngestOutcome`, extraction pipeline signals | operator review, conservative downstream use, chat grounding confidence | Locked | Assessment remains an evaluation summary, not a direct user-facing score promise or training shortcut |
| `SourceSyncCheckpoint` | Service / sync persistence | Service agent | source polling or update scan | continue cultivation, dedupe, incremental sync reasoning | Locked | Checkpoint semantics remain resumable and audit-friendly; no alternate incremental-sync checkpoint name is introduced |
| `NetworkAnswerPack` | Chat runtime / answer packaging | Chat agent, Service agent | retrieval outputs, grounded evidence subset, persona context | chat response rendering and future observability hooks | Locked | Pack remains answer-scoped and grounding-oriented; it does not become a new public training or evidence console surface |
| `ChatRetrievalPlan` | Chat runtime / retrieval planning | Chat agent | persona context, user message, source/network availability | `NetworkAnswerPack`, answer generation, conservative refusal/clarify routing | Locked | Plan stays internal-or-runtime scoped, explainable to operators if needed, and does not leak as primary end-user jargon |

### 3.3 Per-Contract Alignment Notes

#### `SourceFailureClass`

Expected semantic role:

- classify source-stage failure into a stable taxonomy
- support retry, recovery, and health aggregation
- avoid one-off string matching spread across UI and service code

Do not expand into:

- raw provider exception transport format
- UI copy text catalog
- benchmark or training failure taxonomy

#### `PersonaSourceHealth`

Expected semantic role:

- aggregate persona-level source health for status presentation and action gating
- remain conservative when evidence is stale, partial, or unavailable

Do not expand into:

- direct exposure of hidden pipeline states in first-level UX
- a replacement for full cultivation run status

#### `SourceIngestOutcome`

Expected semantic role:

- record the immediate result of a source ingest attempt
- separate ingest result from later extraction-quality judgment

Do not expand into:

- long-lived training outcome
- chat answer quality promise

#### `ExtractionQualityAssessment`

Expected semantic role:

- provide downstream systems a bounded assessment of extraction quality
- support operator review and conservative routing

Do not expand into:

- user-facing ranking badge in primary desktop UI
- a shortcut to bypass review/governance layers

#### `SourceSyncCheckpoint`

Expected semantic role:

- preserve incremental sync position and audit continuity
- support retry/resume without ambiguous duplication semantics

Do not expand into:

- a catch-all persona progress state object
- UI-facing session status wording

#### `NetworkAnswerPack`

Expected semantic role:

- carry grounded answer-side material that chat runtime can render or inspect safely
- stay focused on answer generation and traceability

Do not expand into:

- a new generic evidence browser payload
- a hidden backdoor for direct writeback concepts

#### `ChatRetrievalPlan`

Expected semantic role:

- express retrieval intent before answer generation
- constrain what context is fetched and why

Do not expand into:

- end-user visible workflow stepper
- a substitute for training prep or source governance artifacts

### 3.4 Anti-Drift Review Questions

Use these questions before merging any implementation that touches the contracts above:

- Is this change using one of the seven locked names instead of inventing a sibling alias?
- Does the contract still sit in the same layer and dependency direction defined above?
- Did the change expand into protected modules or unrelated UI surface?
- Can the acceptance behavior be explained without exposing internal workflow nouns to end users?
- If optional fields were added, do they preserve conservative semantics instead of overpromising certainty?

## 4. Merge Readiness Checklist

### 4.1 Scope and File Discipline

- [ ] This integration keeps Agent C changes limited to governance docs and checklists
- [ ] No core business logic file was modified by this orchestration task
- [ ] No convenience refactor or formatting-only sweep expanded the diff outside approved scope
- [ ] `src/core/pipeline/ingestion/article.ts` remains untouched in this phase

### 4.2 Product Boundary

- [ ] Primary desktop navigation remains limited to `Chat`, `Personas`, and `Settings`
- [ ] No first-level UX reintroduces `Soul`, `Memory`, `Training`, `Experiment`, `Export`, `Evidence`, or `Inspector`
- [ ] Chat remains free of unapproved side panels, review consoles, or direct writeback affordances
- [ ] Persona delete semantics remain hard-delete and do not imply archive recovery

### 4.3 Interface Governance

- [ ] `SourceFailureClass` is the only failure taxonomy name used for source-stage failure classification in this phase
- [ ] `PersonaSourceHealth` is the only persona-level source health contract name used in this phase
- [ ] `SourceIngestOutcome` remains distinct from `ExtractionQualityAssessment`
- [ ] `SourceSyncCheckpoint` remains the single incremental sync checkpoint contract name in this phase
- [ ] `NetworkAnswerPack` and `ChatRetrievalPlan` are not renamed, duplicated, or surfaced as new primary UX nouns
- [ ] Any additive payload changes preserve the locked responsibility boundaries documented above

### 4.4 Recovery, Runtime, and Packaging

- [ ] Local URL behavior prefers auto-detect, auto-start, and auto-reconnect before showing failure
- [ ] Remote URL behavior does not claim desktop-managed startup or recovery
- [ ] Bundled runtime validation covers `dist`, production dependencies, `bin/node`, and required `scripts/`
- [ ] Runtime staging directories and packaged payloads are not committed to Git

### 4.5 QA and Review Handoff

- [ ] QA has a clear walkthrough target for minimal client UX and contract-conservative behavior
- [ ] Cross-agent ownership and dependencies are still readable from docs without reverse-engineering code intent
- [ ] Any blocked or deferred item is captured explicitly rather than being hidden in ambiguous implementation comments
- [ ] Main agent can explain why the merge is safe without claiming unverified runtime behavior

## 5. No-Expansion Rules After This Document

Until the main agent explicitly re-plans the phase, do not use this document as justification to:

- broaden source ingestion work into new adapters or ingestion refactors
- widen the desktop client beyond `Chat / Personas / Settings`
- surface governance-only terms as end-user product concepts
- add new same-purpose contracts parallel to the seven locked names
- reopen old browser-first workbench scope

## 6. Merge Position

This phase should be treated as merge-ready only when all of the following are true:

1. the current product boundary stays intact,
2. the seven contract names and responsibilities are treated as locked for the phase,
3. packaging and local-service recovery remain conservative and auditable,
4. no forbidden scope spread appears in protected modules,
5. the main agent can integrate cross-agent work without renaming or re-splitting the aligned contracts.

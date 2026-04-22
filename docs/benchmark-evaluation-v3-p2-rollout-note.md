# Benchmark Evaluation V3 P2 Rollout Note

Updated: 2026-04-22  
Owner: Governance / Control agent  
Audience: Main agent, Development agent, Testing agent

## Goal

Keep P2 rollout narrow and auditable: introduce benchmark-aware promotion semantics and significance-aware governance wording without expanding the workbench into a larger review product.

## What This P2 Cut Adds

- governance wording for repeated benchmark evidence
- promotion gating based on `promotion_readiness`
- conservative significance display when a summary exists
- explicit separation between:
  - observed best profile
  - strict official winner
  - promotable default candidate

## What This P2 Cut Does Not Add

- statistical implementation details or benchmark replica internals
- reviewer workflow for pack approval
- human-labeling UI or annotation surface
- P3-scale governance dashboard redesign

## Field Semantics

### `benchmark_governance`

- top-level conservative contract for how the report may be interpreted
- should be the first source of truth for default-promotion gating
- must remain capable of saying "not ready" even when benchmark outputs exist

### `promotion_readiness`

- `blocked`: do not allow promotion or imply a promotable candidate
- `provisional`: benchmark evidence exists, but more evidence or governance review is required
- `promotable`: governance permits the strict official winner to be used for default promotion

### `benchmark_significance`

- only meaningful as promotion evidence when emitted with sufficient data
- if absent, the UI should say the significance summary is unavailable or not yet emitted
- if present but not significant, the result should remain conservative

## Rollout Guidance

1. Keep the UI wording compact: status chips and one-line governance notes are enough.
2. Show the distinction between observed, official, and promotable states directly in experiment history.
3. Do not imply that `official_benchmark_status=available` means promotable.
4. When `benchmark_significance` is absent, treat the report as pending or insufficient evidence unless governance explicitly says otherwise.
5. Preserve backward compatibility for legacy reports that only have V2 fields.

## Risks

- If the page continues to show a single "winner" label, users may confuse observed best performance with a promotable default candidate.
- If absence of `benchmark_significance` is treated like a silent pass, governance can overstate evidence quality.
- If blocked or provisional runs are rendered with the same confidence cues as promotable runs, rollout discipline will erode quickly.

## Required Follow-up

- Agent A should ensure promotion-state transitions are emitted consistently with the design doc.
- Agent B should add fixtures where official benchmark data exists but governance remains provisional or blocked.
- Main agent should decide whether P2 needs an explicit reason field later, or whether conservative derived wording remains sufficient for now.

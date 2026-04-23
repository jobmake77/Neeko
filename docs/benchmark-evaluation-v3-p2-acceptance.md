# Benchmark Evaluation V3 P2 Acceptance Checklist

Updated: 2026-04-22  
Owner: Governance / Control agent  
Status: Draft for integration

## Scope

This checklist covers only the P2 governance contract:

- repeated official benchmark evidence and significance semantics,
- benchmark-aware promotion gating,
- conservative Web/API surfacing for `promotion_readiness`, `benchmark_significance`, and `benchmark_governance`.

Out of scope for this checklist:

- significance algorithm implementation details,
- replica execution orchestration details inside `src/core/**`,
- human-calibrated pack authoring workflow,
- large workbench UI redesign or reviewer console expansion.

## Required Artifacts

- this acceptance checklist
- P2 rollout note for promotion and significance semantics
- minimal Web/API compatibility for:
  - `benchmark_governance`
  - `benchmark_significance`
  - `promotion_readiness`
  - conservative distinction between observed, official, and promotable states

## Governance Semantics

### `promotion_readiness`

- `blocked` means the report must not be presented as a default-promotion candidate.
- `provisional` means benchmark evidence exists but is still not sufficient for promotion.
- `promotable` means governance evidence is strong enough that the strict official winner may be used for default promotion.

### `benchmark_significance`

- significance is promotion evidence, not a cosmetic score.
- if a significance summary is absent, UI and docs must treat it as unavailable or not yet emitted instead of inferring a positive result.
- `significant=false` must never be presented as promotion-safe improvement.

### `benchmark_governance`

- `benchmark_governance` is the top-level conservative contract for official benchmark interpretation.
- `official_benchmark_status=available` alone is not enough for promotion.
- disagreement, non-homogeneous benchmark identity, insufficient clean replicas, or non-significant outcomes must keep governance non-promotable.

## Acceptance Checklist

- [ ] P2 docs define how `blocked`, `provisional`, and `promotable` differ in user-facing governance wording
- [ ] P2 docs define how absent significance differs from `not_significant` and `insufficient_evidence`
- [ ] Web/API types accept top-level `benchmark_governance` and `benchmark_significance` fields without breaking legacy reports
- [ ] training history surface distinguishes `observed best`, `official winner`, and `default candidate`
- [ ] training history surface keeps provisional or blocked reports visually conservative
- [ ] default-profile promotion remains blocked unless `promotion_readiness=promotable`
- [ ] if significance summary is absent, UI does not fabricate a positive significance interpretation
- [ ] if governance reports `benchmark_homogeneous=false`, UI wording remains non-promotable
- [ ] legacy reports with no P2 fields remain readable
- [ ] no files under `src/core/**`, `src/cli/**`, or `test/**` were modified by the governance agent

## Integration Checks for Main Agent

- confirm Agent A emits stable top-level governance fields matching the V3 design
- confirm Agent A only emits `benchmark_significance` when evidence is sufficient, or otherwise leaves the summary absent and marks governance conservatively
- confirm Agent B covers provisional, blocked, promotable, and significance-absent report fixtures
- confirm default promotion logic remains driven by governance, not by raw best-profile score alone

## Exit Criteria

P2 governance is ready to hand off when:

1. significance and promotion semantics are fixed in docs,
2. the Web surface distinguishes observed, official, and promotable states without overclaiming certainty,
3. no UI wording implies that official benchmark availability alone is enough for promotion.

# Benchmark Evaluation V3 P1 Acceptance Checklist

Updated: 2026-04-22  
Owner: Governance / Control agent  
Status: Draft for integration

## Scope

This checklist covers only the P1 governance contract:

- benchmark judge field surface and terminology,
- explicit disagreement reporting semantics,
- separation between `proxy_scorecard` and `benchmark_scorecard`,
- minimal Web/API compatibility for newly added P1 report fields.

Out of scope for this checklist:

- benchmark judge prompt or adjudication implementation details,
- significance computation or promotion-grade statistical gating,
- large UI redesign or workbench governance panel expansion,
- pack status flow beyond the existing `draft` seed-pack state.

## Required Artifacts

- this acceptance checklist
- P1 rollout note for field semantics and rollout boundaries
- minimal Web/API compatibility for:
  - `benchmark_scorecards`
  - `benchmark_judge_summary`
  - `benchmark_significance`
  - row-level `benchmark_scorecard`
  - row-level `benchmark_case_summary`
  - row-level `benchmark_judge_disagreement`

## Governance Semantics

### Benchmark Judge

- `proxy_scorecard` remains the runtime observability score used by existing V2-compatible views.
- `benchmark_scorecard` is case-based evaluation output derived from the benchmark pack and judge flow.
- P1 reports may contain both scorecard families in the same run. Their meanings must stay distinct in docs and UI.

### Disagreement

- disagreement is a governance signal, not a value to be silently averaged away.
- if P1 report fields expose disagreement, Web/API surfaces must keep it visible as disagreement or disputed cases.
- disputed benchmark cases should prevent any UI wording that implies promotion-grade certainty.

### Promotion Semantics

- P1 alone does not make a report `promotable`.
- without P2 significance and sufficient clean evidence, governance should remain `provisional` unless the main agent explicitly approves a stricter rule set.

## Acceptance Checklist

- [ ] P1 docs explicitly distinguish `proxy_scorecard` from `benchmark_scorecard`
- [ ] P1 docs define disagreement as an explicit governance signal
- [ ] Web/API types accept top-level `benchmark_scorecards`, `benchmark_judge_summary`, and `benchmark_significance`
- [ ] Web/API types accept row-level `benchmark_scorecard`, `benchmark_case_summary`, and `benchmark_judge_disagreement`
- [ ] training history surface shows minimal P1 benchmark judge/disagreement information when present
- [ ] training history surface remains readable for legacy reports with no P1 benchmark fields
- [ ] default-profile promotion logic is unchanged except for already-introduced governance gating
- [ ] no files under `src/core/**`, `src/cli/**`, or `test/**` were modified by the governance agent

## Integration Checks for Main Agent

- confirm Agent A emits stable field names exactly as documented in the V3 design
- confirm Agent A keeps `proxy_scorecard` and `benchmark_scorecard` side by side instead of overwriting one with the other
- confirm Agent A emits explicit disagreement/disputed-case metadata instead of silently averaging dual-judge conflicts
- confirm Agent B adds coverage for legacy reports, disagreement-bearing reports, and mixed proxy+benchmark reports
- confirm `promotion_readiness` stays conservative until P2 significance is available

## Exit Criteria

P1 governance is ready to hand off when:

1. benchmark judge and disagreement terminology are fixed in docs,
2. newly emitted P1 report fields are visible in the minimal workbench surface,
3. no P1 UI wording implies that benchmark outputs are already fully promotion-grade.

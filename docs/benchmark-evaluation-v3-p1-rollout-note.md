# Benchmark Evaluation V3 P1 Rollout Note

Updated: 2026-04-22  
Owner: Governance / Control agent  
Audience: Main agent, Development agent, Testing agent

## Goal

Keep P1 rollout narrow and auditable: introduce benchmark judge and disagreement field semantics without pretending that significance, human calibration, or full governance UI already exist.

## What This P1 Cut Adds

- governance wording for benchmark-judge outputs
- explicit separation between proxy and benchmark scorecards
- minimal Web/API compatibility for disagreement and case-level benchmark summaries
- lightweight workbench visibility for P1 benchmark fields

## What This P1 Cut Does Not Add

- benchmark judge implementation details
- significance-backed promotion decisions
- human-calibrated official benchmark claims
- any P3-scale UI expansion

## Field Semantics

### `proxy_scorecard`

- operational/runtime-oriented quality signal
- retained for V2 compatibility and observability
- must not be mislabeled as benchmark evidence

### `benchmark_scorecard`

- case-based summary tied to a benchmark pack
- suitable for benchmark analysis, not yet sufficient by itself for promotion
- may coexist with `proxy_scorecard` in the same report

### `benchmark_judge_disagreement`

- explicit record that multiple judges did not align cleanly
- should remain visible as disagreement or disputed cases
- should bias governance toward caution, not be hidden in averaged scores

### `benchmark_significance`

- reserved for P2 evidence
- if present early for compatibility, it should be treated as informational until P2 acceptance criteria are met

## Rollout Guidance

1. Keep P1 UI additions summary-only: judge mode, scorecard mode, disputed cases, and disagreement rate are enough.
2. Do not rename or overload existing V2 fields to represent benchmark outputs.
3. If a report contains both proxy and benchmark outputs, keep both visible and semantically separate.
4. If disagreement or disputed cases exist, avoid any wording that implies stable promotion evidence.
5. Preserve backward compatibility for reports that contain none of the new P1 fields.

## Risks

- If development reuses V2 score fields to store benchmark judge output, downstream consumers may misread benchmark evidence as runtime proxy quality.
- If disagreement is only stored deep in artifacts and not surfaced at report level, governance review may miss contested cases.
- If P1 UI wording sounds too final, draft/editorial packs may be confused with fully calibrated official benchmarks.

## Required Follow-up

- Agent A should keep the top-level and row-level field names stable with the V3 design.
- Agent B should add compatibility coverage for mixed proxy+benchmark reports and disagreement-bearing fixtures.
- Main agent should confirm whether P1 reports with disagreement can ever be manually promoted, or whether that remains blocked until P2/P3.

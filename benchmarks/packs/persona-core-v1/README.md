# persona-core-v1

`persona-core-v1` is the P0 seed pack for the benchmark registry contract introduced in Benchmark Evaluation V3.

## Purpose

- provide a checked-in pack identity that can be referenced by id or path,
- exercise the required registry file layout,
- give Web/API governance surfaces stable `pack_id` and `pack_version` values,
- keep scope intentionally small until the benchmark runner and judge are implemented.

## Status

- `suite_tier`: `official`
- `status`: `draft`
- `label_source`: `editorial_draft`

The pack is suitable for contract validation and rollout wiring. It is not yet sufficient for promotion-grade benchmark claims.

## Contents

- `pack.json`: canonical metadata and governance defaults
- `cases.jsonl`: 3 immutable single-turn benchmark cases
- `labels.jsonl`: expected outcome contract for each case
- `rubric.md`: judge guidance and P0 limitations

## Notes for Integration

- Development work should load this pack without mutating checked-in case content at runtime.
- Testing should add dedicated fixtures under `test/fixtures/benchmarks/` instead of rewriting this seed pack.
- Promotion gating must treat this pack as `draft` until later phases upgrade the status flow.

## P1 Governance Notes

- If P1 reports include `benchmark_scorecard`, treat it as case-based benchmark evidence, not as a replacement for `proxy_scorecard`.
- If dual-judge evaluation reports disagreement or disputed cases, governance surfaces should keep that signal visible and conservative.
- This pack still does not qualify as a human-calibrated official benchmark pack, even if benchmark judge fields are emitted.

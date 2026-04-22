# Benchmark Evaluation V3 P0 Rollout Note

Updated: 2026-04-22  
Owner: Governance / Control agent  
Audience: Main agent, Development agent, Testing agent

## Goal

Keep P0 rollout narrow and auditable: introduce a checked-in benchmark registry contract without pretending that benchmark judging or significance already exists.

## What This P0 Cut Adds

- a reviewable seed benchmark pack in repository
- documented acceptance boundaries for governance work
- minimal workbench compatibility for `benchmark_pack` and `benchmark_governance`

## What This P0 Cut Does Not Add

- benchmark judge outputs
- significance summaries
- promotion-grade UI panels
- any new write path into Soul or long-term memory

## Rollout Guidance

1. Merge governance assets before or alongside the P0 loader implementation so pack ids and versions stay stable.
2. Treat `persona-core-v1` as a contract sample, not as proof of benchmark completeness.
3. Do not expose benchmark-driven promotion in the UI unless the report explicitly marks `promotion_readiness=promotable`.
4. Preserve backward compatibility: old reports should continue to render even when they do not contain benchmark fields.

## Risks

- If development emits `official_status=available` before governance fields are ready, old gating logic could over-promote a report.
- If tests mutate the checked-in seed pack directly, registry reviewability and replay stability become unclear.
- If `draft` pack status is ignored later, the project may confuse contract validation with a true official benchmark.

## Required Follow-up

- Agent A should implement pack loading and report emission against this checked-in contract.
- Agent B should add validation and compatibility coverage before P0 sign-off.
- Main agent should confirm whether `draft -> candidate -> official` status flow remains reserved for P3, as currently designed.

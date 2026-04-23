# Benchmark Evaluation V3 P0 Acceptance Checklist

Updated: 2026-04-22  
Owner: Governance / Control agent  
Status: Draft for integration

## Scope

This checklist covers only the P0 governance contract:

- checked-in benchmark pack registry layout,
- minimal benchmark pack sample,
- backward-compatible report field surface,
- conservative workbench gating for new governance fields.

Out of scope for this checklist:

- benchmark pack loader implementation,
- benchmark judge logic,
- significance computation,
- benchmark UI expansion beyond minimal compatibility.

## Required Artifacts

- checked-in seed pack at `benchmarks/packs/persona-core-v1/`
- registry index at `benchmarks/packs/README.md`
- this acceptance checklist
- rollout note for P0 handoff and risk control

## Acceptance Checklist

- [ ] `benchmarks/packs/persona-core-v1/pack.json` exists and uses `manifest_version=benchmark-pack-registry-v1`
- [ ] seed pack includes `pack.json`, `cases.jsonl`, `labels.jsonl`, `rubric.md`, and `README.md`
- [ ] `pack.json` records stable `pack_id` and `pack_version`
- [ ] each JSONL row includes a stable `case_id`
- [ ] seed pack is explicitly marked `status=draft`
- [ ] labels are explicitly marked as non-human-final (`label_source=editorial_draft`)
- [ ] Web/API types recognize `benchmark_pack` and `benchmark_governance`
- [ ] default-profile promotion is blocked unless `promotion_readiness=promotable`
- [ ] legacy reports without benchmark governance fields still render and keep previous fallback behavior
- [ ] no files under `src/core/training/**`, `src/cli/**`, or `test/**` were modified by the governance agent

## Integration Checks for Main Agent

- confirm Agent A loads checked-in packs by id or path without rewriting pack contents
- confirm Agent A emits `benchmark_pack` and `benchmark_governance` in experiment reports
- confirm Agent B adds validation coverage for malformed `pack.json` and mismatched `case_id`
- confirm P0 CLI reports keep existing consumers backward-compatible when benchmark fields are absent

## Exit Criteria

P0 governance is ready to hand off when:

1. the seed pack is checked in and reviewable,
2. the workbench will not mis-promote a report that is only `provisional`,
3. the remaining P0 work is clearly owned by development and testing agents.

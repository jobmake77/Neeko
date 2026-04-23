# Benchmark Evaluation V3 P3 Governance Constraints

Updated: 2026-04-22  
Owner: Governance / Control agent  
Status: Preparation draft

## Goal

Prepare the P3 governance boundary without expanding the current workbench into a large UI rewrite. This document defines the minimum status-flow and human-calibrated seed-pack constraints that later P3 implementation must respect.

## Pack Status Flow

P3 keeps a single linear status model:

`draft -> candidate -> official`

### `draft`

- default state for newly checked-in or structurally valid packs
- may be used for development, contract checks, and early benchmark iteration
- must not be presented as calibrated official promotion evidence

### `candidate`

- pack structure is stable enough for governance review
- label quality and rubric consistency are under active review
- may be shown as governance-track evidence, but still not as official benchmark authority

### `official`

- pack passed governance review and is approved for promotion-grade benchmark use
- may be referenced in official promotion decisions, subject to normal P2 significance and cleanliness gates
- must have a stable pack identity and review trail

## Status Transition Constraints

- status changes must be explicit and reviewable; no implicit auto-promotion from runtime success alone
- `draft -> candidate` requires a stable pack schema, stable case IDs, and reviewed rubric wording
- `candidate -> official` requires human calibration evidence and governance sign-off
- the workbench must not display `official` wording if pack status is still `draft` or `candidate`

## Human-Calibrated Seed Pack Constraints

P3 may introduce one small human-calibrated seed pack, but it must remain intentionally narrow.

Required constraints:

- keep the seed pack small and reviewable rather than broad and noisy
- ensure every labeled case has a stable `case_id`
- record human label provenance and label versioning in checked-in assets
- keep rubric text aligned with case dimensions and expected failure modes
- avoid claiming lexical exact-match style grading unless the rubric truly requires it
- preserve replayability and repository reviewability for every label update

## UI Guardrails

- avoid a governance dashboard rewrite; add only compact status cues and conservative wording
- keep observed results, official benchmark availability, and promotable state visually distinct
- do not expose internal annotation or review workflow jargon in the main training page
- if pack status is below `official`, any UI wording must bias toward caution

## Allowed Deviation from the Design

The design mentions a human-labeled benchmark seed pack as a P3 deliverable. This preparation draft constrains that scope further:

- only one small seed pack is required initially
- no annotation tooling is implied
- no broad pack-management UI is required in the first P3 cut

This keeps P3 aligned with the design while preserving the repository's current minimal-surface direction.

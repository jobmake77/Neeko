# Evaluation V2 P1

Updated: 2026-04-18
Status: Implemented for experiment, A/B, and PK aggregation flows

## Overview

Evaluation V2 P1 extends the P0 contract with benchmark identity and rerun stability metadata.

It does not introduce a brand-new benchmark runner. Instead, it upgrades the existing experiment outputs so the system can:

1. distinguish clean benchmark runs from contaminated or failed runs,
2. keep degraded runs visible for debugging and audit,
3. compute official recommendations only from clean runs,
4. preserve the current downstream consumers that still expect `experiment-*.json` and existing top-level fields,
5. label smoke vs regression vs ad-hoc suites explicitly,
6. summarize repeated-run stability instead of treating repeated execution as mere retries.

The current implementation is still intentionally narrow. It covers:

- `experiment` CLI report generation,
- input-routing / training-seed comparison rows,
- PK smoke summary and aggregate scripts,
- A/B regression suite metadata,
- routing decision aggregation,
- workbench experiment report-path compatibility.

It does not yet implement a new learned judge, benchmark dataset management, or a separate long-horizon evaluation service.

## Problem statement

Before V2, experiment reports mixed two different concerns:

1. observed run outcomes,
2. benchmark-worthy outcomes.

That meant a run with fallback behavior, partial observability, or execution failure could still accidentally influence:

- `best_profile`,
- routing comparison conclusions,
- PK aggregate clean means,
- gate decisions.

This is acceptable for local debugging, but not for evaluation governance.

Evaluation V2 P0 adds an explicit run-quality layer so consumers can separate:

- observed results: everything that happened,
- official results: only runs that are clean enough to count.

## Design goals

P1 has six goals.

1. Preserve compatibility with current report consumers.
2. Add explicit contamination and provenance metadata without changing the core training loop.
3. Make official decisions depend on clean runs only.
4. Keep smoke PK and official benchmark semantics separate.
5. Give every benchmark artifact a manifest-level identity.
6. Surface rerun stability as a first-class aggregate signal.

## Compatibility contract

The following report expectations stay stable:

- experiment report file pattern remains `experiment-*.json`,
- `generated_at` remains at the top level,
- `rounds_per_profile` remains at the top level,
- `summary_rows` remains at the top level,
- `best_profile` remains at the top level,
- `gate_result` remains at the top level,
- `input_routing_comparison` remains at the top level,
- `routing_decision_record` remains at the top level.

V2 adds fields. It does not remove those fields.

The workbench path-resolution logic is also updated so a run created with placeholder path `experiment-report.json` can still resolve the actual timestamped `experiment-*.json` artifact after the CLI finishes.

## New V2 metadata

### Row-level additions

`summary_rows` and `input_routing_comparison` rows can now carry:

- `run_quality`
- `contamination`
- `scorecard`
- `judge_provenance`
- `benchmark_context`
- `runtime_observability`

### Top-level additions

Experiment reports now also include:

- `schema_version: 2`
- `official_summary_rows`
- `official_input_routing_comparison`
- `observed_best_profile`
- `evaluation_v2`
- `benchmark_manifests`
- `artifact_refs`

The new `evaluation_v2` block is a compact summary of official vs observed counts:

```json
{
  "version": "evaluation-v2-p1",
  "smoke_mode": false,
  "official_status": "available",
  "official_best_profile": "full",
  "observed_best_profile": "full",
  "official_run_count": 6,
  "contaminated_run_count": 1,
  "failed_run_count": 0,
  "inconclusive_run_count": 0,
  "compatible_official_fallback_used": false,
  "suite_types_present": ["profile_sweep", "routing_compare"],
  "suite_tiers_present": ["ad_hoc"]
}
```

## Run-quality model

V2 P0 uses four statuses:

| Status | Meaning |
| --- | --- |
| `clean` | usable for official benchmark conclusions |
| `contaminated` | completed, but benchmark quality is compromised |
| `failed` | did not complete successfully |
| `inconclusive` | observability is too incomplete to trust the result |

### Current contamination signals

P0 marks runs using existing runtime signals only.

Current contamination reasons are:

- `provider_fallback`
- `judge_fallback`
- `runtime_timeout`
- `schema_drift`
- `partial_observability`
- `rerun_mismatch`

In the current implementation:

- provider or runtime fallback activity can produce `contaminated`,
- judge fallback can produce `contaminated`,
- timeout / schema / structured-output failures produce `failed`,
- zero-round or incomplete-observability cases can produce `inconclusive`.

## Scorecard model

P1 scorecards are still proxy scorecards, not a new learned rubric.

They derive six axes from already available metrics:

- `persona_fidelity`
- `groundedness`
- `user_usefulness`
- `boundary_safety`
- `writeback_quality`
- `runtime_reliability`

Important limitation:

- all P1 axes are proxies computed from existing quality, contradiction, duplication, coverage, and runtime fallback signals,
- they are not direct labels from a new benchmark judge,
- they are useful for trend comparison and gating, not for claiming final research-grade evaluation.

## Official vs observed outputs

This is the core P0 change.

### Observed outputs

Observed outputs preserve everything the run produced:

- `summary_rows`
- `input_routing_comparison`
- `observed_best_profile`

These are useful for:

- debugging,
- failure analysis,
- seeing whether a risky path looked good before contamination filtering.

### Official outputs

Official outputs filter to clean runs first:

- `official_summary_rows`
- `official_input_routing_comparison`
- `best_profile`

Gate evaluation also treats non-clean baseline or compare rows as a failure condition for official decision-making.

P1 adds one important clarification:

- `official_summary_rows` and `official_input_routing_comparison` are now strict clean-only views,
- `best_profile` is still preserved as a compatibility field,
- `evaluation_v2.official_status` tells consumers whether a strict official conclusion is actually available.

## Judge provenance

Each V2 row can carry `judge_provenance`, which records the current evaluator configuration:

- `mode`
- `calibration_version`
- `calibration_examples`
- `dual_review_requested`
- `dual_review_active`
- `layered_mode`
- `fallback_used`
- `evaluator_fallbacks`

This does not yet represent a research-grade calibration system. It simply makes current evaluator configuration auditable.

## Benchmark context

Each V2 row can also carry `benchmark_context`:

- `pack_id`
- `pack_type`
- `suite_type`
- `suite_tier`
- `case_count`
- `rounds`
- `questions_per_round`
- `case_distribution`
- `case_manifest`

Current suite types are:

- `profile_sweep`
- `routing_compare`
- `smoke_pk`
- `ab_regression`

`smoke_pk` is explicitly labeled as smoke coverage and should not be treated as an official benchmark suite.

The new `case_manifest` carries:

- `manifest_id`
- `manifest_version`
- `pack_version`
- `recipe_version`
- `suite_label`
- `suite_tier`
- `flavor`
- `replayable`
- `replay_mode`
- optional `replica_group`
- optional `replica_id`

This is still a recipe-level manifest, not a frozen benchmark dataset. It is meant to identify comparable runs, not to claim full dataset replay.

## Artifact refs

Experiment reports now write a sibling benchmark-manifest artifact and expose it through `artifact_refs`.

Current experiment output therefore includes:

- the main `experiment-*.json`,
- the legacy `experiment-*.csv`,
- a sibling `experiment-*.benchmark-manifest.json`.

This keeps the main report backward-compatible while making suite identity explicit.

## Rerun stability

P1 adds rerun-stability summaries at the aggregate layer.

The current stability labels are:

- `stable`
- `provisional`
- `volatile`
- `insufficient_evidence`

PK aggregates now emit both:

- `observed_rerun_stability`
- `official_rerun_stability`

They are derived from repeated-run spread on:

- quality
- coverage
- contradiction rate
- duplication rate

P1 deliberately keeps rerun stability out of the single-run contamination classifier. A run does not become `rerun_mismatch` by itself. Instead, mismatch and volatility are summarized when multiple replicas are available.

## PK smoke aggregation changes

The PK flow now preserves V2 row metadata through:

- `scripts/run-input-routing-pk.mjs`
- `scripts/build-pk-aggregate.mjs`
- `src/core/training/pk-aggregate.ts`

Two aggregate views are produced:

- observed aggregate: all successful runs,
- official aggregate: clean runs only.

Variant aggregates now include:

- `run_quality_counts`
- `observed_scorecard`
- `official_scorecard`
- `observed_rerun_stability`
- `official_rerun_stability`
- explicit excluded-run details and reason counts

Routing-decision aggregation also excludes any non-clean run before applying the older fallback-outlier heuristic.

The PK scripts now also preserve:

- `replica_group_id`
- benchmark manifests collected from child runs
- `rerun_stability_by_variant`

## Workbench compatibility

Workbench experiments still start with a placeholder report path:

```text
<outputDir>/experiment-report.json
```

The CLI still writes:

```text
<outputDir>/experiment-<slug>-<timestamp>.json
```

V2 fixes this mismatch in `WorkbenchService` by resolving the latest timestamped experiment artifact when:

- inferring final run status,
- reading the stored report for display or API use.

This keeps the existing workbench flow working without changing the CLI artifact naming contract.

## Current limitations

P1 is still deliberately conservative.

It does not yet provide:

- a calibrated human-labeled benchmark pack,
- true paper-style multi-judge scoring,
- automated benchmark-suite versioning,
- formal significance testing,
- benchmark governance UI.

Those belong to later phases.

## Recommended next steps

### P2

- move from recipe-level manifests to frozen benchmark case manifests,
- add stronger homogeneity checks across suite identity, pack version, and provider/runtime freeze,
- feed stability into routing-decision confidence rather than only surfacing it.

### P3

- add calibrated judge prompts and judge disagreement reporting,
- separate proxy scorecards from benchmark scorecards,
- add stronger benchmark context for provenance and replay.

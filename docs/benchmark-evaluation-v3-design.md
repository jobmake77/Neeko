# Benchmark Evaluation V3 Design

Updated: 2026-04-22
Status: Proposed
Owner: Main agent

## 1. Objective

This design upgrades the current Evaluation V2 stack into a benchmark-oriented evaluation system that is suitable for:

- official benchmark packs checked into the repository,
- case-level benchmark judging in addition to proxy scorecards,
- repeated measurement with lightweight significance checks,
- governance-grade promotion decisions in CLI and workbench surfaces,
- small-scale human-calibrated benchmark packs.

The design intentionally extends the current stack instead of replacing it.

## 2. Current Baseline

The repository already provides a strong V2 foundation:

- clean vs contaminated vs failed vs inconclusive run-quality separation,
- benchmark manifest and frozen case manifest replay,
- A/B regression gate using clean rows only,
- PK aggregate with rerun stability and homogeneity checks,
- Web gating for default-profile promotion.

Current documented limitations remain:

- no human-labeled benchmark pack,
- no paper-style multi-judge scoring,
- no formal significance testing,
- no benchmark governance UI.

## 3. Design Principles

1. Preserve backward compatibility for existing `experiment-*.json` consumers.
2. Keep proxy scorecards for observability, but never confuse them with benchmark labels.
3. Treat benchmark pack identity as a first-class asset, not an incidental byproduct of runtime-generated questions.
4. Make official promotion depend on clean runs, homogeneous benchmark identity, and statistically stable evidence.
5. Keep every major step replayable and auditable.

## 4. Non-goals

This design does not introduce:

- a separate online evaluation service,
- a full annotation platform,
- heavyweight statistical tooling beyond lightweight paired significance checks,
- any direct write path into Soul or long-term persona assets.

## 5. Proposed Architecture

### 5.1 Benchmark Pack Registry

Add a checked-in benchmark pack registry under:

```text
benchmarks/
  packs/
    <pack-id>/
      pack.json
      cases.jsonl
      labels.jsonl
      rubric.md
      README.md
```

`pack.json` is the source of truth for pack identity and governance metadata.

Proposed fields:

```json
{
  "pack_id": "persona-core-v1",
  "pack_version": "2026-04-22",
  "manifest_version": "benchmark-pack-registry-v1",
  "suite_type": "official_benchmark",
  "suite_tier": "official",
  "domain": "persona_training",
  "description": "Core official benchmark for persona fidelity and writeback safety.",
  "owner": "neeko",
  "status": "draft",
  "replayable": true,
  "default_replicas": 3,
  "min_clean_replicas": 2,
  "significance_method": "paired_bootstrap",
  "dimensions": [
    "persona_fidelity",
    "voice_authenticity",
    "groundedness",
    "boundary_safety",
    "writeback_safety",
    "consistency_under_pressure"
  ]
}
```

`cases.jsonl` contains immutable benchmark cases. Each case is stable and reviewable.

Proposed fields:

```json
{
  "case_id": "persona-core-v1-001",
  "prompt": "What principle guides your toughest product decisions?",
  "strategy": "scenario",
  "target_dimension": "values",
  "difficulty": "medium",
  "tags": ["decision-making", "values"],
  "expected_failure_modes": ["generic_answer", "style_drift"],
  "evaluation_mode": "single_turn"
}
```

`labels.jsonl` contains the benchmark expectations and optional human references.

Proposed fields:

```json
{
  "case_id": "persona-core-v1-001",
  "expected_outcome": {
    "must_include": ["principled reasoning", "tradeoff awareness"],
    "must_avoid": ["generic assistant phrasing"],
    "target_verdict": "pass"
  },
  "golden_reference": {
    "summary": "Grounded, principle-first answer with concrete tradeoff framing.",
    "notes": ["Do not require lexical overlap."]
  },
  "label_source": "human",
  "label_version": "1"
}
```

### 5.2 Benchmark Judge Layer

Keep the existing proxy evaluator path, but add a benchmark judge path.

New source files:

- `src/core/training/benchmark-pack.ts`
- `src/core/training/benchmark-judge.ts`
- `src/core/training/significance.ts`

The benchmark judge returns case-level outputs.

Proposed shape:

```ts
interface BenchmarkCaseJudgment {
  case_id: string;
  pass: boolean;
  abstained: boolean;
  confidence: number;
  overall_score: number;
  dimension_scores: Record<string, number>;
  primary_verdict: 'pass' | 'fail' | 'abstain';
  failure_modes: string[];
  rationale: string;
  evidence_spans: string[];
}
```

The judge result is not a replacement for `EvaluationScorecard`. Both must coexist:

- `proxy_scorecard`: derived from runtime metrics, compatible with current V2 flows,
- `benchmark_scorecard`: aggregated from case-level benchmark judgments.

### 5.3 Multi-judge and Disagreement Reporting

The current dual review merges disagreements by averaging. That is not sufficient for governance-grade benchmarking.

Add explicit disagreement metadata:

```ts
interface BenchmarkJudgeDisagreement {
  active: boolean;
  judge_count: number;
  disagreement_rate: number;
  verdict_conflicts: number;
  high_delta_cases: string[];
}
```

Each benchmark run should keep:

- primary judge outputs,
- optional secondary judge outputs,
- disagreement summary,
- final adjudicated outputs.

For P1, adjudication can remain simple:

- if both judges agree: accept,
- if one abstains and the other is confident: accept confident result,
- if they conflict materially: mark case as disputed and lower official confidence.

### 5.4 Significance Layer

Current rerun stability is useful but not enough for official promotion.

Add a lightweight significance layer:

```ts
interface BenchmarkSignificanceSummary {
  method: 'paired_bootstrap';
  replicas_a: number;
  replicas_b: number;
  metric: 'benchmark_overall';
  delta_mean: number;
  ci_low: number;
  ci_high: number;
  significant: boolean;
  favors: 'a' | 'b' | 'neither';
}
```

Initial method:

- paired bootstrap over replica-level benchmark overall score,
- default `10_000` bootstrap samples,
- promotion-safe interpretation:
  - improvement requires `ci_low > 0`,
  - regression alarm requires `ci_high < 0`,
  - otherwise mark as not significant.

### 5.5 Governance Status Model

Extend `evaluation_v2` into a benchmark-governance summary.

Proposed additions:

```json
{
  "benchmark_governance": {
    "version": "benchmark-governance-v1",
    "pack_id": "persona-core-v1",
    "pack_version": "2026-04-22",
    "judge_mode": "benchmark_dual",
    "official_benchmark_status": "available",
    "promotion_readiness": "provisional",
    "clean_replica_count": 3,
    "benchmark_homogeneous": true,
    "significance_status": "not_significant",
    "judge_disagreement_rate": 0.08
  }
}
```

Allowed values:

- `official_benchmark_status`: `available | unavailable`
- `promotion_readiness`: `blocked | provisional | promotable`
- `significance_status`: `improved | regressed | not_significant | insufficient_evidence`

### 5.6 Benchmark Artifacts

Keep existing artifacts and add benchmark-specific siblings.

New files per run:

```text
experiment-<slug>-<timestamp>.benchmark-judgments.json
experiment-<slug>-<timestamp>.benchmark-summary.json
ab-regression-<slug>-<timestamp>.benchmark-summary.json
```

The main experiment report remains backward-compatible and references the new artifacts from `artifact_refs`.

## 6. Proposed Data Model Changes

### 6.1 New Benchmark Suite Types

Extend suite typing:

- keep existing `profile_sweep`, `routing_compare`, `smoke_pk`, `ab_regression`,
- add `official_benchmark`.

### 6.2 New Report Fields

Add the following optional top-level fields to experiment reports:

- `benchmark_pack`
- `benchmark_scorecards`
- `benchmark_judge_summary`
- `benchmark_significance`
- `benchmark_governance`

Add the following optional row-level fields:

- `benchmark_scorecard`
- `benchmark_case_summary`
- `benchmark_judge_disagreement`

### 6.3 New Type Modules

New files:

- `src/core/training/benchmark-pack.ts`
- `src/core/training/benchmark-judge.ts`
- `src/core/training/significance.ts`

Touched files:

- `src/core/training/evaluation-v2.ts`
- `src/core/training/ab-report.ts`
- `src/core/training/pk-aggregate.ts`
- `src/core/training/routing-decision.ts`
- `src/cli/commands/experiment.ts`
- `src/cli/commands/ab-regression.ts`
- `src/cli/index.ts`
- `web/app/api/experiments/[slug]/route.ts`
- `web/app/training/page.tsx`

## 7. CLI Surface

### 7.1 `nico experiment`

Add:

- `--official-pack <pack-id-or-path>`
- `--judge-mode <mode>` where `mode = proxy | benchmark_single | benchmark_dual | both`
- `--replicas <n>`
- `--significance`

Rules:

- without `--official-pack`, current V2 behavior remains the default,
- with `--official-pack`, the run loads checked-in pack cases instead of generated ad hoc cases,
- `--judge-mode both` emits both proxy and benchmark outputs,
- `--replicas` repeats the same pack and judge config under the same freeze identity.

### 7.2 `nico ab-regression`

Add:

- `--official-pack <pack-id-or-path>`
- `--judge-mode <mode>`
- `--replicas <n>`
- `--significance`

Rules:

- A/B with official pack becomes the promotion-grade comparison path,
- if significance is requested but replicas are too low, report `insufficient_evidence` instead of fabricating confidence.

### 7.3 New Optional Utility Commands

These commands are helpful but not required in the first implementation cut:

- `nico benchmark-pack validate <pack-path>`
- `nico benchmark-pack list`
- `nico benchmark-pack show <pack-id>`

## 8. Web / Workbench Governance Changes

The current Web page already blocks `smoke` and `regression` reports from becoming defaults. Extend that logic:

- only allow default promotion when `promotion_readiness=promotable`,
- show pack id and pack version,
- show judge mode and disagreement rate,
- show significance result,
- clearly separate `proxy scorecard` from `benchmark scorecard`.

The UI should never display internal training jargon beyond what is required for governance.

## 9. Phase Plan

### P0: Benchmark Pack Registry and Contract

Deliverables:

- checked-in `benchmarks/packs/` registry,
- benchmark pack schema loader and validator,
- official pack wiring in `experiment` and `ab-regression`,
- backward-compatible report fields and artifact refs,
- design-compatible documentation.

Acceptance:

- a checked-in pack can be loaded by id or path,
- `experiment --official-pack` replays stable checked-in cases,
- report records pack id/version in a stable way,
- existing experiment consumers do not break.

### P1: Benchmark Judge and Disagreement

Deliverables:

- benchmark judge implementation,
- benchmark scorecard aggregation,
- explicit disagreement reporting,
- case-level benchmark artifact emission.

Acceptance:

- one run produces both proxy and benchmark outputs when requested,
- dual judge no longer silently averages away disagreement,
- report surfaces disputed cases and disagreement rate.

### P2: Replicas and Significance

Deliverables:

- repeated official benchmark execution,
- paired bootstrap significance summary,
- promotion gating upgraded from threshold-only to benchmark-aware governance.

Acceptance:

- repeated official benchmark runs yield reproducible aggregate summaries,
- significance summary is emitted only when evidence is sufficient,
- promotion gate can block on non-significant or regressed benchmark outcomes.

### P3: Governance Surface and Human Calibration

Deliverables:

- Web / workbench governance surfacing,
- human-labeled benchmark seed pack,
- pack status flow: `draft -> candidate -> official`.

Acceptance:

- UI clearly distinguishes observed, official, and promotable states,
- at least one small human-labeled pack exists in repo,
- official promotion path requires governance status instead of raw score alone.

## 10. Testing Strategy

### Unit Tests

Add or extend:

- `test/benchmark-pack.test.mjs`
- `test/benchmark-judge.test.mjs`
- `test/significance.test.mjs`
- `test/evaluation-v2.test.mjs`
- `test/ab-report.test.mjs`
- `test/pk-aggregate.test.mjs`

### Golden / Fixture Tests

Add fixtures under:

```text
test/fixtures/benchmarks/
```

Include:

- valid pack fixture,
- invalid pack fixture,
- disputed dual-judge fixture,
- significance edge-case fixture.

### End-to-end CLI Validation

Target commands:

```bash
npm run build
node dist/cli/index.js experiment <slug> --official-pack <pack> --judge-mode both --replicas 3
node dist/cli/index.js ab-regression <slug> --official-pack <pack> --judge-mode both --replicas 3 --significance
```

## 11. Agent Split

Three agents will be used after this design is accepted.

### Agent A: Development

Scope:

- `src/core/training/**`
- `src/cli/commands/**`
- `src/cli/index.ts`

Responsibilities:

- implement pack registry,
- implement benchmark judge and significance logic,
- wire CLI/report outputs.

### Agent B: Testing

Scope:

- `test/**`
- `benchmarks/packs/**` fixtures if needed for tests only

Responsibilities:

- add unit tests and golden fixtures,
- verify backward compatibility and failure cases,
- report missing coverage and flaky assumptions.

### Agent C: Governance / Control

Scope:

- `web/app/api/experiments/[slug]/route.ts`
- `web/app/training/page.tsx`
- `docs/**` related acceptance and rollout notes

Responsibilities:

- keep rollout aligned with this design,
- wire governance fields into surface behavior,
- maintain the acceptance checklist for P0-P3.

## 12. Delivery Order

Execution will proceed in the following order:

1. P0 contract and registry
2. P1 benchmark judge
3. P2 significance and promotion governance
4. P3 UI governance and human-calibrated pack seed

The implementation should keep the repository usable at the end of each phase.

## 13. Risks and Mitigations

### Risk: benchmark fields break existing report readers

Mitigation:

- additive fields only,
- preserve existing top-level names,
- keep proxy scorecards intact.

### Risk: dual-judge latency becomes too high

Mitigation:

- benchmark judge is opt-in,
- allow `benchmark_single` mode,
- keep current proxy path for smoke and ad hoc evaluation.

### Risk: significance adds noise instead of clarity

Mitigation:

- use significance only for official pack flows,
- emit `insufficient_evidence` instead of overclaiming,
- keep raw replica summaries visible.

### Risk: pack maintenance becomes messy

Mitigation:

- pack id/version/status live in checked-in `pack.json`,
- pack schema validation is part of tests,
- official promotion requires human-reviewed labels.

## 14. Acceptance Gate for This Design

This design is considered accepted for implementation if:

1. the repository gains checked-in official benchmark pack support,
2. benchmark judging stays additive to current V2 proxy scoring,
3. promotion gating becomes benchmark-aware by P2,
4. governance UI only blocks or promotes based on official benchmark evidence.

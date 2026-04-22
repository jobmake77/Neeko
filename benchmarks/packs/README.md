# Benchmark Pack Registry

This directory contains checked-in benchmark packs for Neeko evaluation.

Registry layout:

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

Rules:

- `pack.json` is the source of truth for pack identity and governance metadata.
- `cases.jsonl` contains immutable benchmark cases.
- `labels.jsonl` contains reviewed expectations for each case.
- `rubric.md` documents how benchmark judges should interpret the pack.
- Each pack README records scope, limitations, and rollout status.

Current status:

- `persona-core-v1` is a P0 seed pack for registry and governance wiring.
- It is intentionally marked `draft` and should not be treated as a human-calibrated official pack yet.

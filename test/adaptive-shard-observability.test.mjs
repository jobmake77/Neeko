import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidencePacks,
} from '../dist/testing/dynamic-scaling-test-entry.js';
import {
  materializeAdaptiveShardPacks,
  planAdaptiveShards,
} from '../dist/testing/shard-distillation-test-entry.js';
import {
  buildDynamicScalingMetrics,
} from '../dist/testing/dynamic-scaling-test-entry.js';

function item(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    raw_document_id: crypto.randomUUID(),
    source_type: 'twitter',
    modality: 'text',
    content: 'Stable systems emerge from repeated first-principles reasoning, clear interfaces, and explicit documentation of tradeoffs.',
    speaker_role: 'target',
    speaker_name: 'target',
    target_confidence: 0.97,
    scene: 'public',
    window_role: 'standalone',
    context_before: [],
    context_after: [],
    evidence_kind: 'statement',
    stability_hints: {
      repeated_count: 1,
      repeated_in_sessions: 1,
      cross_session_stable: true,
    },
    metadata: {},
    ...overrides,
  };
}

function pack(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    persona_slug: 'tester',
    source_type: 'twitter',
    modality: 'text',
    scene_profile: 'public',
    time_window: {
      started_at: '2026-03-01T00:00:00.000Z',
      ended_at: '2026-03-01T00:00:00.000Z',
      days_span: 0,
    },
    item_ids: [crypto.randomUUID()],
    raw_document_ids: [crypto.randomUUID()],
    conversation_ids: [],
    session_ids: [],
    primary_speaker_role: 'target',
    topic_signature: ['systems', 'scaling', 'training'],
    stats: {
      item_count: 2,
      raw_doc_count: 1,
      total_chars: 400,
      estimated_tokens: 180,
      avg_item_chars: 200,
      target_ratio: 1,
      cross_session_stable_ratio: 1,
    },
    scores: {
      quality: 0.7,
      novelty: 0.7,
      stability: 0.7,
      risk: 0.1,
      target_relevance: 0.95,
      duplication_pressure: 0.1,
      value: 0.72,
    },
    routing_projection: {
      soul_candidate_items: 1,
      memory_candidate_items: 1,
      discard_candidate_items: 0,
    },
    metadata: {},
    ...overrides,
  };
}

test('dynamic scaling metrics stay bounded and reflect pack set', () => {
  const packs = buildEvidencePacks([
    item({ timestamp_start: '2026-03-01T00:00:00.000Z' }),
    item({
      timestamp_start: '2026-03-12T00:00:00.000Z',
      content: 'Teams compound quality when they revisit the same design principles over long horizons instead of optimizing only for short-term speed.',
    }),
  ]).packs;

  const metrics = buildDynamicScalingMetrics(packs);
  assert.equal(metrics.seed_maturity >= 0 && metrics.seed_maturity <= 1, true);
  assert.equal(metrics.stable_topic_growth >= 0 && metrics.stable_topic_growth <= 1, true);
});

test('adaptive shard plan preserves pack assignment and aggregates metadata', () => {
  const packResult = buildEvidencePacks([
    item({ timestamp_start: '2026-03-01T00:00:00.000Z' }),
    item({ timestamp_start: '2026-03-05T00:00:00.000Z' }),
    item({
      timestamp_start: '2026-04-10T00:00:00.000Z',
      scene: 'work',
      content: 'Hiring quality, team communication, and engineering judgment shape how product systems evolve over time.',
    }),
  ]);

  const plan = planAdaptiveShards(packResult.packs, {
    maxEstimatedTokens: 1200,
    maxEstimatedChunks: 4,
    maxPackCount: 2,
    maxTopicalEntropy: 0.8,
    maxRuntimeCostHint: 1.5,
  });

  const materialized = materializeAdaptiveShardPacks(packResult.packs, plan);
  assert.equal(plan.totals.pack_count, packResult.packs.length);
  assert.equal(plan.shards.every((shard) => shard.pack_count >= 1), true);
  assert.equal(materialized.every((entry) => entry.packs.length === entry.shard.pack_count), true);
  assert.equal(plan.shards.every((shard) => shard.topic_signatures.length >= 1), true);
});

test('adaptive shard planner isolates unrelated topic clusters even without budget pressure', () => {
  const plan = planAdaptiveShards([
    pack({
      topic_signature: ['systems', 'training', 'scaling'],
      time_window: {
        started_at: '2026-03-01T00:00:00.000Z',
        ended_at: '2026-03-01T00:00:00.000Z',
        days_span: 0,
      },
    }),
    pack({
      topic_signature: ['systems', 'inference', 'efficiency'],
      time_window: {
        started_at: '2026-03-03T00:00:00.000Z',
        ended_at: '2026-03-03T00:00:00.000Z',
        days_span: 0,
      },
    }),
    pack({
      topic_signature: ['gardening', 'soil', 'plants'],
      time_window: {
        started_at: '2026-03-04T00:00:00.000Z',
        ended_at: '2026-03-04T00:00:00.000Z',
        days_span: 0,
      },
    }),
  ], {
    maxEstimatedTokens: 3000,
    maxEstimatedChunks: 10,
    maxPackCount: 6,
    maxTopicalEntropy: 1,
    maxRuntimeCostHint: 2,
  });

  assert.equal(plan.shards.length, 2);
  assert.deepEqual(plan.shards.map((shard) => shard.pack_count).sort((a, b) => a - b), [1, 2]);
  assert.equal(plan.shards.every((shard) => shard.dominant_topic_concentration >= 0.5), true);
});

test('adaptive shard planner can carry compatible clusters into one shard', () => {
  const plan = planAdaptiveShards([
    pack({
      topic_signature: ['systems', 'training', 'scaling'],
      metadata: {
        topic_families: ['family:ml_training'],
      },
      time_window: {
        started_at: '2026-03-01T00:00:00.000Z',
        ended_at: '2026-03-01T00:00:00.000Z',
        days_span: 0,
      },
    }),
    pack({
      topic_signature: ['training', 'inference', 'efficiency'],
      metadata: {
        topic_families: ['family:ml_training'],
      },
      time_window: {
        started_at: '2026-03-20T00:00:00.000Z',
        ended_at: '2026-03-20T00:00:00.000Z',
        days_span: 0,
      },
    }),
  ], {
    planningBucketDays: 14,
    maxEstimatedTokens: 3000,
    maxEstimatedChunks: 10,
    maxPackCount: 6,
    maxTopicalEntropy: 1,
    maxRuntimeCostHint: 2,
  });

  assert.equal(plan.shards.length, 1);
  assert.equal(plan.shards[0].pack_count, 2);
});

test('adaptive shard planner can use topic family metadata as a weak similarity signal', () => {
  const plan = planAdaptiveShards([
    pack({
      topic_signature: ['cuda', 'gpu', 'kernel'],
      metadata: {
        topic_families: ['family:ml_infra'],
      },
      time_window: {
        started_at: '2026-03-01T00:00:00.000Z',
        ended_at: '2026-03-01T00:00:00.000Z',
        days_span: 0,
      },
    }),
    pack({
      topic_signature: ['memory', 'attention', 'throughput'],
      metadata: {
        topic_families: ['family:ml_infra'],
      },
      time_window: {
        started_at: '2026-03-18T00:00:00.000Z',
        ended_at: '2026-03-18T00:00:00.000Z',
        days_span: 0,
      },
    }),
  ], {
    planningBucketDays: 14,
    maxEstimatedTokens: 3000,
    maxEstimatedChunks: 10,
    maxPackCount: 6,
    maxTopicalEntropy: 1,
    maxRuntimeCostHint: 2,
  });

  assert.equal(plan.shards.length, 1);
  assert.equal(plan.shards[0].pack_count, 2);
});

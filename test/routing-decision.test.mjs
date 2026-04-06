import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutingDecisionRecord } from '../dist/testing/routing-decision-test-entry.js';

function row(overrides = {}) {
  return {
    label: 'full+legacy+off',
    input_routing: 'legacy',
    requested_training_seed_mode: 'off',
    training_seed_mode: 'off',
    avgQuality: 0.91,
    coverage: 0.5333,
    contradictionRate: 0,
    duplicationRate: 0,
    observability: {
      raw_docs: 1700,
      clean_docs: 1600,
      chunks: 1800,
      soul_docs: 1200,
      memory_docs: 180,
      discard_docs: 70,
      filtered_low_quality_docs: 50,
    },
    scaling_observability: {
      pack_count: 80,
      avg_pack_tokens: 600,
      stable_topic_growth: 0.93,
      duplication_pressure: 0.11,
      seed_maturity: 0.8,
      adaptive_shard_count: 60,
      adaptive_avg_pack_per_shard: 1.3,
      adaptive_avg_tokens_per_shard: 720,
      dynamic_scaling_state: 'explore',
      dynamic_scaling_action: 'continue_expand',
      dynamic_scaling_confidence: 0.9,
      dynamic_scaling_reason: 'still growing',
    },
    runtime_observability: {
      trainer_fallbacks: 0,
      persona_fallbacks: 0,
      evaluator_fallbacks: 0,
      director_fallbacks: 0,
    },
    ...overrides,
  };
}

test('routing decision record promotes v2 for stable persona expression runs', () => {
  const record = buildRoutingDecisionRecord({
    rows: [
      row({ label: 'full+legacy+off' }),
      row({
        label: 'full+v2+off',
        input_routing: 'v2',
        avgQuality: 0.923,
        coverage: 0.5347,
        observability: {
          raw_docs: 1700,
          clean_docs: 1600,
          chunks: 1500,
          soul_docs: 820,
          memory_docs: 420,
          discard_docs: 210,
          filtered_low_quality_docs: 50,
        },
      }),
    ],
    routingRecommendation: {
      recommendedStrategy: 'v2',
      shape: 'balanced_mixed',
      confidence: 0.74,
      reason: 'v2 keeps a useful memory/discard lane at scale',
      metrics: {
        legacyChunkLoad: 1.24,
        v2ChunkLoad: 1.03,
        v2SoulRetention: 0.57,
        v2MemoryRetention: 0.29,
        v2DiscardRatio: 0.14,
        v2ChunkCompression: 0.83,
      },
    },
    dynamicScalingRecommendation: {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      state: 'explore',
      recommended_action: 'continue_expand',
      confidence: 0.92,
      reason: 'still growing',
      metrics_snapshot: {
        stable_topic_growth: 0.93,
        marginal_coverage_gain: 0.93,
        duplication_pressure: 0.11,
        conflict_pressure: 0.16,
        runtime_pressure: 0.32,
        seed_maturity: 0.8,
      },
      shard_snapshot: {
        shard_count: 6,
        pack_count: 80,
        avg_packs_per_shard: 1.2,
        avg_tokens_per_shard: 720,
        avg_topical_entropy: 0.3,
        avg_dominant_topic_concentration: 0.7,
        avg_runtime_cost_hint: 0.4,
        max_days_span: 30,
      },
    },
    currentGrayPathRecommendation: {
      safe_default: { input_routing: 'legacy', training_seed_mode: 'off' },
      recommended_gray_path: { input_routing: 'v2', training_seed_mode: 'off' },
    },
  });

  assert.equal(record.account_type, 'stable_persona_expression');
  assert.equal(record.stage_type, 'dense_large_corpus');
  assert.deepEqual(record.recommended_routing, { input_routing: 'v2', training_seed_mode: 'off' });
  assert.equal(record.excluded_runs.length, 0);
});

test('routing decision record excludes fallback-contaminated outliers', () => {
  const record = buildRoutingDecisionRecord({
    rows: [
      row({ label: 'full+legacy+off', avgQuality: 0.91, coverage: 0.5333 }),
      row({
        label: 'full+v2+off',
        input_routing: 'v2',
        avgQuality: 0.15,
        coverage: 0.3135,
        runtime_observability: {
          trainer_fallbacks: 0,
          persona_fallbacks: 1,
          evaluator_fallbacks: 0,
          director_fallbacks: 0,
        },
      }),
    ],
    routingRecommendation: {
      recommendedStrategy: 'legacy',
      shape: 'balanced_mixed',
      confidence: 0.7,
      reason: 'legacy is safer here',
      metrics: {
        legacyChunkLoad: 1.24,
        v2ChunkLoad: 1.02,
        v2SoulRetention: 0.42,
        v2MemoryRetention: 0.33,
        v2DiscardRatio: 0.21,
        v2ChunkCompression: 0.82,
      },
    },
    dynamicScalingRecommendation: null,
    currentGrayPathRecommendation: {
      safe_default: { input_routing: 'legacy', training_seed_mode: 'off' },
      recommended_gray_path: { input_routing: 'v2', training_seed_mode: 'off' },
    },
  });

  assert.equal(record.stage_type, 'noise_limited');
  assert.equal(record.excluded_runs.length, 1);
  assert.match(record.excluded_runs[0].reason, /fallback-contaminated outlier/);
  assert.deepEqual(record.recommended_routing, { input_routing: 'legacy', training_seed_mode: 'off' });
});

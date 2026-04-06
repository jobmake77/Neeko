import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __packBuilderTestables,
  buildEvidencePacks,
  materializeAdaptiveShardPacks,
  planAdaptiveShards,
  recommendDynamicScaling,
} from '../dist/testing/dynamic-scaling-test-entry.js';

function item(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    raw_document_id: crypto.randomUUID(),
    source_type: 'twitter',
    modality: 'text',
    content: 'I keep returning to first principles because stable engineering quality compounds over time when teams explain tradeoffs clearly and keep the same standard across projects.',
    speaker_role: 'target',
    speaker_name: 'target',
    target_confidence: 0.98,
    scene: 'public',
    window_role: 'standalone',
    context_before: [],
    context_after: [],
    evidence_kind: 'statement',
    stability_hints: {
      repeated_count: 2,
      repeated_in_sessions: 2,
      cross_session_stable: true,
    },
    metadata: {},
    ...overrides,
  };
}

test('buildEvidencePacks groups evidence into scored packs', () => {
  const result = buildEvidencePacks([
    item({ timestamp_start: '2026-03-01T00:00:00.000Z' }),
    item({ timestamp_start: '2026-03-03T00:00:00.000Z' }),
    item({
      timestamp_start: '2026-04-15T00:00:00.000Z',
      content: 'Training systems benefit from repeated documentation, clear interfaces, and a deep respect for long-term quality over short-term convenience.',
    }),
  ], {
    personaSlug: 'tester',
  });

  assert.equal(result.packs.length >= 2, true);
  assert.equal(result.stats.raw_item_count, 3);
  assert.equal(result.metrics.seed_maturity > 0, true);
  assert.equal(result.packs.every((pack) => pack.scores.value >= 0 && pack.scores.value <= 1), true);
});

test('pack builder derives tighter buckets for dense evidence streams', () => {
  const denseItems = Array.from({ length: 20 }, (_, index) =>
    item({
      timestamp_start: `2026-03-${String((index % 5) + 1).padStart(2, '0')}T00:00:00.000Z`,
    })
  );
  assert.equal(__packBuilderTestables.deriveBucketDays(denseItems), 14);
  assert.equal(__packBuilderTestables.deriveTargetTokensPerPack(denseItems), 1400);
});

test('pack builder learns dynamic skip tokens from highly repeated corpus noise', () => {
  const noisyItems = Array.from({ length: 40 }, (_, index) =>
    item({
      content: `Actually teams improve when they document tradeoffs clearly and revisit systems design ${index}.`,
      timestamp_start: `2026-03-${String((index % 10) + 1).padStart(2, '0')}T00:00:00.000Z`,
    })
  );

  const dynamicSkipTokens = __packBuilderTestables.buildDynamicSkipTokens(noisyItems);
  assert.equal(dynamicSkipTokens.has('actually'), true);
  assert.equal(dynamicSkipTokens.has('teams'), true);
});

test('pack builder stores normalized topic roots for downstream shard planning', () => {
  const result = buildEvidencePacks([
    item({
      content: 'Training systems improve when models learn efficient inference and better network behavior.',
      timestamp_start: '2026-03-01T00:00:00.000Z',
    }),
  ]);

  const topicRoots = result.packs[0].metadata.topic_roots;
  assert.equal(Array.isArray(topicRoots), true);
  assert.equal(topicRoots.includes('training'), true);
  assert.equal(topicRoots.includes('model'), true);
  assert.equal(topicRoots.includes('inference'), true);
  assert.equal(topicRoots.includes('network'), true);
});

test('pack builder derives topic families from repeated ml roots', () => {
  const result = buildEvidencePacks([
    item({
      content: 'Training models with pytorch on gpu systems improves inference and network behavior.',
      timestamp_start: '2026-03-01T00:00:00.000Z',
    }),
    item({
      content: 'Inference on gpu memory stacks and pytorch kernels changes model training performance.',
      timestamp_start: '2026-03-03T00:00:00.000Z',
    }),
  ]);

  const topicFamilies = result.packs.flatMap((pack) => pack.metadata.topic_families ?? []);
  assert.equal(topicFamilies.includes('family:ml_training') || topicFamilies.includes('family:ml_infra'), true);
});

test('adaptive shard planner respects pack budgets and materializes packs', () => {
  const packResult = buildEvidencePacks([
    item({ timestamp_start: '2026-03-01T00:00:00.000Z' }),
    item({
      timestamp_start: '2026-03-08T00:00:00.000Z',
      content: 'I think the deepest product advantage comes from repeated clarity of thought and careful iteration over many cycles.',
    }),
    item({
      timestamp_start: '2026-04-10T00:00:00.000Z',
      content: 'Neural networks reward careful experimentation, and teams improve faster when they can explain the reason behind each design decision.',
    }),
    item({
      timestamp_start: '2026-05-10T00:00:00.000Z',
      content: 'Hiring, training, and communication style shape how engineering systems evolve over time.',
      scene: 'work',
    }),
  ]);

  const plan = planAdaptiveShards(packResult.packs, {
    maxEstimatedTokens: 900,
    maxEstimatedChunks: 3,
    maxPackCount: 2,
    maxTopicalEntropy: 0.9,
    maxRuntimeCostHint: 1.2,
  });

  assert.equal(plan.shards.length >= 2, true);
  assert.equal(plan.totals.pack_count, packResult.packs.length);
  const materialized = materializeAdaptiveShardPacks(packResult.packs, plan);
  assert.equal(materialized.length, plan.shards.length);
  assert.equal(materialized.every((entry) => entry.packs.length === entry.shard.pack_count), true);
});

test('dynamic scaling recommends compress under duplication and runtime pressure', () => {
  const packBuild = buildEvidencePacks(Array.from({ length: 48 }, (_, index) =>
    item({
      content: `Actually teams improve when they document tradeoffs clearly and revisit systems design ${index}.`,
      timestamp_start: `2026-03-${String((index % 12) + 1).padStart(2, '0')}T00:00:00.000Z`,
      stability_hints: {
        repeated_count: 5,
        repeated_in_sessions: 4,
        cross_session_stable: true,
      },
    })
  ));
  const plan = planAdaptiveShards(packBuild.packs, {
    maxEstimatedTokens: 1000,
    maxEstimatedChunks: 2,
    maxPackCount: 2,
    maxRuntimeCostHint: 0.8,
  });
  const pressureMetrics = {
    ...packBuild.metrics,
    stable_topic_growth: 0.22,
    marginal_coverage_gain: 0.34,
    duplication_pressure: 0.73,
    conflict_pressure: 0.26,
    runtime_pressure: 0.81,
    seed_maturity: 0.41,
  };

  const recommendation = recommendDynamicScaling(pressureMetrics, plan, { personaSlug: 'tester' });
  assert.equal(recommendation.state, 'compress');
  assert.equal(recommendation.recommended_action, 'repack_and_dedup');
});

test('dynamic scaling recommends align for mature coherent seed sets', () => {
  const matureMetrics = {
    stable_topic_growth: 0.2,
    marginal_coverage_gain: 0.28,
    duplication_pressure: 0.18,
    conflict_pressure: 0.14,
    runtime_pressure: 0.22,
    seed_maturity: 0.84,
  };
  const plan = planAdaptiveShards([
    {
      ...buildEvidencePacks([
        item({
          content: 'I keep returning to first principles and the same clear engineering principles across projects.',
          timestamp_start: '2026-03-01T00:00:00.000Z',
        }),
      ]).packs[0],
      topic_signature: ['principles', 'engineering', 'clarity'],
      metadata: {
        topic_roots: ['principles', 'engineering', 'clarity'],
        topic_families: ['family:systems'],
      },
    },
    {
      ...buildEvidencePacks([
        item({
          content: 'Stable systems come from repeated clarity, careful iteration, and coherent engineering standards.',
          timestamp_start: '2026-03-15T00:00:00.000Z',
        }),
      ]).packs[0],
      topic_signature: ['principles', 'engineering', 'clarity'],
      metadata: {
        topic_roots: ['principles', 'engineering', 'clarity'],
        topic_families: ['family:systems'],
      },
    },
  ], {
    maxEstimatedTokens: 4000,
    maxEstimatedChunks: 8,
    maxPackCount: 6,
    maxTopicalEntropy: 0.95,
    maxRuntimeCostHint: 2.0,
  });

  const recommendation = recommendDynamicScaling(matureMetrics, plan, { personaSlug: 'tester' });
  assert.equal(recommendation.state, 'align');
  assert.equal(recommendation.recommended_action, 'train_on_seeds');
});

test('dynamic scaling recommends explore when coverage growth remains healthy', () => {
  const exploratoryMetrics = {
    stable_topic_growth: 0.68,
    marginal_coverage_gain: 0.74,
    duplication_pressure: 0.21,
    conflict_pressure: 0.24,
    runtime_pressure: 0.26,
    seed_maturity: 0.39,
  };
  const plan = planAdaptiveShards(buildEvidencePacks([
    item({
      content: 'Product strategy, hiring, infrastructure, and model design all create new angles on the system.',
      timestamp_start: '2026-03-01T00:00:00.000Z',
    }),
    item({
      content: 'Network effects, chip constraints, and research iteration keep opening up fresh areas of coverage.',
      timestamp_start: '2026-04-01T00:00:00.000Z',
    }),
    item({
      content: 'The operating cadence of a team matters as much as the technical architecture over long cycles.',
      timestamp_start: '2026-05-01T00:00:00.000Z',
    }),
  ]).packs, {
    maxEstimatedTokens: 5000,
    maxEstimatedChunks: 10,
    maxPackCount: 5,
    maxTopicalEntropy: 0.95,
    maxRuntimeCostHint: 2.4,
  });

  const recommendation = recommendDynamicScaling(exploratoryMetrics, plan, { personaSlug: 'tester' });
  assert.equal(recommendation.state, 'explore');
  assert.equal(recommendation.recommended_action, 'continue_expand');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCorpusSnapshot,
  buildInputRunManifest,
  materializeShardDocs,
  planCorpusShards,
  writeShardCorpusAssets,
} from '../dist/testing/corpus-plan-test-entry.js';

function makeDoc(id, publishedAt, content) {
  return {
    id,
    source_type: 'twitter',
    source_platform: 'twitter',
    content,
    author: 'tester',
    author_handle: '@tester',
    published_at: publishedAt,
    fetched_at: new Date().toISOString(),
    metadata: {},
  };
}

test('buildCorpusSnapshot summarizes corpus boundaries and hash', () => {
  const docs = [
    makeDoc('a', '2026-01-01T00:00:00.000Z', 'alpha content here'),
    makeDoc('b', '2026-01-02T00:00:00.000Z', 'beta content here'),
  ];

  const snapshot = buildCorpusSnapshot(docs, { personaSlug: 'tester' });
  assert.equal(snapshot.raw_doc_count, 2);
  assert.equal(snapshot.persona_slug, 'tester');
  assert.equal(snapshot.oldest_published_at, '2026-01-01T00:00:00.000Z');
  assert.equal(snapshot.newest_published_at, '2026-01-02T00:00:00.000Z');
  assert.equal(typeof snapshot.content_hash, 'string');
  assert.equal(snapshot.content_hash.length > 0, true);
});

test('planCorpusShards splits high-volume corpora into bounded shards', () => {
  const docs = Array.from({ length: 9 }, (_, index) =>
    makeDoc(
      `doc-${index}`,
      `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      `tweet ${index} `.repeat(120)
    )
  );

  const plan = planCorpusShards(docs, {
    personaSlug: 'tester',
    targetDocsPerShard: 3,
    maxDocsPerShard: 4,
    targetTokensPerShard: 120,
    maxTokensPerShard: 240,
    targetWindowDays: 3,
    maxWindowDays: 5,
  });

  assert.equal(plan.persona_slug, 'tester');
  assert.equal(plan.shards.length >= 2, true);
  assert.equal(plan.totals.raw_doc_count, docs.length);
  assert.equal(new Set(plan.shards.map((item) => item.shard_id)).size, plan.shards.length);
});

test('buildInputRunManifest freezes routing runtime and shard metadata', () => {
  const docs = [
    makeDoc('a', '2026-01-01T00:00:00.000Z', 'alpha content here'),
    makeDoc('b', '2026-01-02T00:00:00.000Z', 'beta content here'),
  ];
  const snapshot = buildCorpusSnapshot(docs, { personaSlug: 'tester' });
  const shardPlan = planCorpusShards(docs, { personaSlug: 'tester' });
  const manifest = buildInputRunManifest({
    personaSlug: 'tester',
    snapshot,
    shardPlan,
    selectedInputRouting: 'v2',
    selectedKimiStabilityMode: 'hybrid',
    provider: 'kimi',
    requestedRounds: 2,
    trainingProfile: 'full',
    recommendation: {
      recommendedStrategy: 'v2',
      shape: 'dense_noisy_stream',
      confidence: 0.81,
      reason: 'filtered noisy stream',
      metrics: {
        legacyChunkLoad: 1,
        v2ChunkLoad: 0.5,
        v2SoulRetention: 0.3,
        v2MemoryRetention: 0.2,
        v2DiscardRatio: 0.5,
        v2ChunkCompression: 0.5,
      },
    },
    dynamicScalingRecommendation: {
      schema_version: 1,
      generated_at: '2026-04-05T00:00:00.000Z',
      persona_slug: 'tester',
      state: 'stabilize',
      recommended_action: 'merge_and_canonicalize',
      confidence: 0.72,
      reason: 'stable topics are consolidating',
      metrics_snapshot: {
        stable_topic_growth: 0.41,
        marginal_coverage_gain: 0.45,
        duplication_pressure: 0.3,
        conflict_pressure: 0.22,
        runtime_pressure: 0.28,
        seed_maturity: 0.68,
      },
      shard_snapshot: {
        shard_count: 2,
        pack_count: 4,
        avg_packs_per_shard: 2,
        avg_tokens_per_shard: 1200,
        avg_topical_entropy: 0.42,
        avg_dominant_topic_concentration: 0.66,
        avg_runtime_cost_hint: 0.7,
        max_days_span: 40,
      },
    },
  });

  assert.equal(manifest.selected_input_routing, 'v2');
  assert.equal(manifest.selected_kimi_stability_mode, 'hybrid');
  assert.equal(manifest.shard_plan.shard_count, shardPlan.shards.length);
  assert.equal(manifest.recommendation?.strategy, 'v2');
  assert.equal(manifest.dynamic_scaling_recommendation?.state, 'stabilize');
  assert.equal(manifest.dynamic_scaling_recommendation?.action, 'merge_and_canonicalize');
});

test('materializeShardDocs keeps shard boundaries aligned with plan order', () => {
  const docs = Array.from({ length: 7 }, (_, index) =>
    makeDoc(
      `doc-${index}`,
      `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      `payload ${index} `.repeat(80)
    )
  );

  const shardPlan = planCorpusShards(docs, {
    personaSlug: 'tester',
    targetDocsPerShard: 3,
    maxDocsPerShard: 3,
    targetTokensPerShard: 1_000,
    maxTokensPerShard: 1_000,
    targetWindowDays: 90,
    maxWindowDays: 90,
  });

  const materialized = materializeShardDocs(docs, shardPlan);
  assert.equal(materialized.length, shardPlan.shards.length);
  assert.deepEqual(
    materialized.map((item) => item.docs.length),
    shardPlan.shards.map((item) => item.raw_doc_count)
  );
  assert.equal(materialized[0].docs[0].id, 'doc-0');
  assert.equal(materialized.at(-1)?.docs.at(-1)?.id, 'doc-6');
});

test('writeShardCorpusAssets writes per-shard raw docs and metadata', () => {
  const docs = Array.from({ length: 5 }, (_, index) =>
    makeDoc(
      `doc-${index}`,
      `2026-03-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      `content ${index} `.repeat(100)
    )
  );
  const shardPlan = planCorpusShards(docs, {
    personaSlug: 'tester',
    targetDocsPerShard: 2,
    maxDocsPerShard: 2,
    targetTokensPerShard: 1_000,
    maxTokensPerShard: 1_000,
    targetWindowDays: 90,
    maxWindowDays: 90,
  });
  const dir = mkdtempSync(join(tmpdir(), 'neeko-corpus-plan-'));

  try {
    writeShardCorpusAssets(dir, docs, shardPlan);
    for (const shard of shardPlan.shards) {
      const shardDir = join(dir, 'shards', shard.shard_id);
      const rawDocs = JSON.parse(readFileSync(join(shardDir, 'raw-docs.json'), 'utf-8'));
      const meta = JSON.parse(readFileSync(join(shardDir, 'meta.json'), 'utf-8'));
      assert.equal(rawDocs.length, shard.raw_doc_count);
      assert.equal(meta.shard_id, shard.shard_id);
      assert.equal(meta.raw_doc_count, shard.raw_doc_count);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

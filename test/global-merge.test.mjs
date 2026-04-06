import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  distillCorpusShards,
  mergeShardDistillationResults,
  planCorpusShards,
  writeGlobalMergeAssets,
} from '../dist/testing/global-merge-test-entry.js';

function makeDoc(id, publishedAt, content, metadata = {}) {
  return {
    id,
    source_type: 'twitter',
    source_platform: 'twitter',
    content,
    author: 'Karpathy',
    author_handle: '@karpathy',
    published_at: publishedAt,
    fetched_at: new Date().toISOString(),
    metadata,
  };
}

function evidence(scene = 'public') {
  return {
    evidence: {
      scene,
      speaker_role: 'target',
      target_confidence: 0.95,
      evidence_kind: 'statement',
      stability_hints: {
        cross_session_stable: scene !== 'conflict',
        repeated_in_sessions: scene === 'public' || scene === 'work' ? 3 : 1,
      },
    },
    likes: 900,
    views: 42000,
  };
}

test('mergeShardDistillationResults promotes cross-shard stable signals into global soul seed', () => {
  const docs = Array.from({ length: 60 }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, '0');
    const month = index < 30 ? '03' : '05';
    const id = `00000000-0000-0000-0000-${String(101 + index).padStart(12, '0')}`;
    const stableContent =
      index % 10 === 0
        ? 'Practical evaluation and repeated iteration are the core of good engineering. Practical tooling keeps research honest and reliable over time.'
        : 'Practical evaluation matters. Repeated iteration and practical engineering discipline are how robust systems are built in real teams.';
    return makeDoc(
      id,
      `2026-${month}-${day}T00:00:00.000Z`,
      stableContent,
      evidence(index % 7 === 0 ? 'work' : 'public')
    );
  });

  const shardPlan = planCorpusShards(docs, {
    personaSlug: 'karpathy',
    targetDocsPerShard: 50,
    maxDocsPerShard: 50,
    targetTokensPerShard: 20000,
    maxTokensPerShard: 20000,
    targetWindowDays: 30,
    maxWindowDays: 30,
  });
  const shardResults = distillCorpusShards(docs, shardPlan, {
    strategy: 'v2',
    targetSignals: ['karpathy'],
    strategyDecision: {
      optimizationMode: 'combined',
      prioritizeTopSoulChunks: true,
      maxSoulChunks: 5,
    },
  });

  const merged = mergeShardDistillationResults(shardResults, {
    strategy: 'v2',
    minShardsForStableSignal: 2,
  });

  assert.equal(merged.soulSeed.strategy, 'v2');
  assert.equal(shardResults.length >= 2, true);
  assert.equal(merged.soulSeed.stable_signal_count >= 1, true);
  assert.equal(merged.soulSeed.stable_signals.some((item) => item.signal_type === 'phrase'), true);
  assert.equal(merged.soulSeed.topic_cluster_count >= 1, true);
  assert.equal(merged.soulSeed.topic_clusters.some((item) => item.member_signals.length >= 2), true);
  assert.equal(
    merged.trainingSeed.stable_keywords.some((item) => item.includes('practical evaluation') || item.includes('repeated iteration')),
    true
  );
  assert.equal(merged.trainingSeed.stable_topics.length >= 1, true);
  assert.equal(merged.trainingSeed.stable_topic_roots.length >= 1, true);
  assert.equal(merged.trainingSeed.stable_topics.some((item) => item.startsWith('family:')), false);
  assert.equal(
    merged.trainingSeed.stable_topics.some((item) =>
      merged.trainingSeed.stable_keywords.includes(item) || merged.trainingSeed.stable_topic_roots.includes(item)
    ),
    true
  );
  assert.equal(Array.isArray(merged.soulSeed.topic_clusters[0].topic_roots), true);
  assert.equal(merged.trainingSeed.stable_signal_count, merged.soulSeed.stable_signal_count);
  assert.equal(merged.trainingSeed.topic_cluster_count, merged.soulSeed.topic_cluster_count);
  assert.equal(merged.memoryCandidates.candidate_count >= 0, true);
});

test('mergeShardDistillationResults derives topic families for global seed', () => {
  const shardResults = [
    {
      shard: { shard_id: 'shard-1', index: 0, doc_ids: [], raw_doc_count: 0, estimated_tokens: 0, estimated_chunks: 0, source_type_counts: {} },
      routing: {},
      soulSummary: {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        shard_id: 'shard-1',
        strategy: 'v2',
        raw_doc_count: 0,
        clean_doc_count: 0,
        chunk_count: 0,
        selected_soul_chunk_count: 1,
        doc_ids: [],
        top_keywords: ['training', 'model'],
        top_phrases: ['model training', 'inference systems'],
        top_signals: [
          {
            document_id: 'doc-1',
            chunk_id: 'chunk-1',
            score: 0.9,
            excerpt: 'Model training and inference systems benefit from strong GPU memory planning.',
            keywords: ['training', 'model', 'gpu', 'memory'],
            phrases: ['model training', 'inference systems'],
          },
        ],
      },
      memorySummary: {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        shard_id: 'shard-1',
        strategy: 'v2',
        memory_doc_count: 0,
        discard_doc_count: 0,
        memory_doc_ids: [],
        top_keywords: [],
        context_examples: [],
      },
      observabilityReport: {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        shard_id: 'shard-1',
        strategy: 'v2',
        observability: {},
      },
    },
    {
      shard: { shard_id: 'shard-2', index: 1, doc_ids: [], raw_doc_count: 0, estimated_tokens: 0, estimated_chunks: 0, source_type_counts: {} },
      routing: {},
      soulSummary: {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        shard_id: 'shard-2',
        strategy: 'v2',
        raw_doc_count: 0,
        clean_doc_count: 0,
        chunk_count: 0,
        selected_soul_chunk_count: 1,
        doc_ids: [],
        top_keywords: ['training', 'network'],
        top_phrases: ['model training', 'network inference'],
        top_signals: [
          {
            document_id: 'doc-2',
            chunk_id: 'chunk-2',
            score: 0.88,
            excerpt: 'Training larger models requires better network throughput and inference discipline.',
            keywords: ['training', 'network', 'inference'],
            phrases: ['model training', 'network inference'],
          },
        ],
      },
      memorySummary: {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        shard_id: 'shard-2',
        strategy: 'v2',
        memory_doc_count: 0,
        discard_doc_count: 0,
        memory_doc_ids: [],
        top_keywords: [],
        context_examples: [],
      },
      observabilityReport: {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        shard_id: 'shard-2',
        strategy: 'v2',
        observability: {},
      },
    },
  ];

  const merged = mergeShardDistillationResults(shardResults, {
    strategy: 'v2',
    minShardsForStableSignal: 2,
  });

  assert.equal(merged.trainingSeed.stable_topic_roots.includes('training'), true);
  assert.equal(merged.trainingSeed.stable_topic_families.includes('family:ml_training'), true);
  assert.equal(merged.trainingSeed.stable_topics.includes('ml training systems'), true);
  assert.equal(merged.trainingSeed.stable_topics.includes('family:ml_training'), false);
});

test('writeGlobalMergeAssets persists global seed, memory candidates, conflicts, and training seed', () => {
  const docs = [
    makeDoc(
      '00000000-0000-0000-0000-000000000201',
      '2026-04-01T00:00:00.000Z',
      'Simple training loops and practical evaluation should stay central. Repeated iteration produces reliable engineering outcomes.',
      evidence('public')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000202',
      '2026-04-02T00:00:00.000Z',
      'Practical evaluation, repeated iteration, and clear tooling make engineering stronger over time and reduce hidden instability.',
      evidence('public')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000203',
      '2026-04-20T00:00:00.000Z',
      'This private context note is operational and short-lived. It belongs in memory if needed, not in the durable soul layer.',
      evidence('private')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000204',
      '2026-04-21T00:00:00.000Z',
      'This conflict fragment is sharp but situational, so it should remain quarantined rather than shape the long-term persona.',
      evidence('conflict')
    ),
  ];
  const shardPlan = planCorpusShards(docs, {
    personaSlug: 'karpathy',
    targetDocsPerShard: 2,
    maxDocsPerShard: 2,
    targetTokensPerShard: 1000,
    maxTokensPerShard: 1000,
    targetWindowDays: 30,
    maxWindowDays: 30,
  });
  const shardResults = distillCorpusShards(docs, shardPlan, {
    strategy: 'v2',
    targetSignals: ['karpathy'],
    strategyDecision: {
      optimizationMode: 'combined',
      prioritizeTopSoulChunks: true,
      maxSoulChunks: 5,
    },
  });
  const merged = mergeShardDistillationResults(shardResults, {
    strategy: 'v2',
    minShardsForStableSignal: 2,
  });

  const dir = mkdtempSync(join(tmpdir(), 'neeko-global-merge-'));
  try {
    writeGlobalMergeAssets(dir, merged);
    const soulSeed = JSON.parse(readFileSync(join(dir, 'global-soul-seed.json'), 'utf-8'));
    const memoryCandidates = JSON.parse(readFileSync(join(dir, 'global-memory-candidates.json'), 'utf-8'));
    const conflicts = JSON.parse(readFileSync(join(dir, 'global-conflicts.json'), 'utf-8'));
    const trainingSeed = JSON.parse(readFileSync(join(dir, 'training-seed.json'), 'utf-8'));

    assert.equal(soulSeed.strategy, 'v2');
    assert.equal(typeof soulSeed.stable_signal_count, 'number');
    assert.equal(typeof soulSeed.topic_cluster_count, 'number');
    assert.equal(Array.isArray(soulSeed.topic_clusters), true);
    assert.equal(Array.isArray(memoryCandidates.candidates), true);
    assert.equal(typeof conflicts.conflict_count, 'number');
    assert.equal(trainingSeed.stable_signal_count, soulSeed.stable_signal_count);
    assert.equal(trainingSeed.topic_cluster_count, soulSeed.topic_cluster_count);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

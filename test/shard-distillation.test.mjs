import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  distillCorpusShards,
  distillShardDocs,
  planCorpusShards,
  writeShardDistillationAssets,
} from '../dist/testing/shard-distillation-test-entry.js';

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

function makeEvidenceMetadata(scene = 'public', speakerRole = 'target') {
  return {
    evidence: {
      scene,
      speaker_role: speakerRole,
      target_confidence: 0.96,
      evidence_kind: 'statement',
      stability_hints: {
        cross_session_stable: scene !== 'conflict',
        repeated_in_sessions: scene === 'public' || scene === 'work' ? 3 : 1,
      },
    },
    likes: 1200,
    views: 58000,
  };
}

test('distillShardDocs builds soul and memory summaries from routed shard evidence', () => {
  const docs = [
    makeDoc(
      '00000000-0000-0000-0000-000000000001',
      '2026-01-01T00:00:00.000Z',
      'I believe durable intelligence comes from building systems that can reason, learn, and iterate in the open. Research should stay practical and grounded in real capability building.',
      makeEvidenceMetadata('public')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000002',
      '2026-01-02T00:00:00.000Z',
      'At work we repeatedly choose simple training loops, measure failure modes, and tighten the runtime until the model becomes reliable under pressure. Good engineering is repeated disciplined iteration.',
      makeEvidenceMetadata('work')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000003',
      '2026-01-03T00:00:00.000Z',
      'This private scheduling note is mostly about coordinating a call later tonight and does not reflect a stable worldview, only logistics for the next few hours.',
      makeEvidenceMetadata('private')
    ),
  ];

  const shard = {
    shard_id: 'shard-001',
    index: 0,
    raw_doc_count: docs.length,
    estimated_tokens: 200,
    estimated_chunks: 3,
  };

  const result = distillShardDocs(shard, docs, {
    strategy: 'v2',
    targetSignals: ['karpathy'],
    strategyDecision: {
      optimizationMode: 'combined',
      prioritizeTopSoulChunks: true,
      maxSoulChunks: 6,
    },
  });

  assert.equal(result.soulSummary.shard_id, 'shard-001');
  assert.equal(result.soulSummary.strategy, 'v2');
  assert.equal(result.soulSummary.selected_soul_chunk_count >= 1, true);
  assert.equal(result.soulSummary.top_signals.length >= 1, true);
  assert.equal(result.memorySummary.memory_doc_count >= 1, true);
  assert.equal(result.observabilityReport.observability.clean_docs, 3);
});

test('distillCorpusShards and writeShardDistillationAssets persist per-shard summaries', () => {
  const docs = [
    makeDoc(
      '00000000-0000-0000-0000-000000000011',
      '2026-02-01T00:00:00.000Z',
      'We should make neural network tooling easier to inspect, simpler to teach, and robust enough that researchers can trust what they are seeing in practice.',
      makeEvidenceMetadata('public')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000012',
      '2026-02-02T00:00:00.000Z',
      'I like building small feedback loops, checking the evidence, and then growing the system only after we understand the failure mode clearly.',
      makeEvidenceMetadata('public')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000013',
      '2026-02-10T00:00:00.000Z',
      'At work the best teams document tradeoffs early, reduce ambiguity, and expose runtime instability instead of hiding it behind a polished demo.',
      makeEvidenceMetadata('work')
    ),
    makeDoc(
      '00000000-0000-0000-0000-000000000014',
      '2026-02-11T00:00:00.000Z',
      'This conflict fragment is emotionally charged and specific to a short-term dispute, so it should stay contextual rather than shape the durable soul profile.',
      makeEvidenceMetadata('conflict')
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

  const results = distillCorpusShards(docs, shardPlan, {
    strategy: 'v2',
    targetSignals: ['karpathy'],
    strategyDecision: {
      optimizationMode: 'combined',
      prioritizeTopSoulChunks: true,
      maxSoulChunks: 5,
    },
  });

  assert.equal(results.length, shardPlan.shards.length);
  assert.equal(results.every((item) => item.soulSummary.strategy === 'v2'), true);

  const dir = mkdtempSync(join(tmpdir(), 'neeko-shard-distill-'));
  try {
    writeShardDistillationAssets(dir, results);
    for (const shard of shardPlan.shards) {
      const shardDir = join(dir, 'shards', shard.shard_id);
      const soul = JSON.parse(readFileSync(join(shardDir, 'shard-soul-summary.json'), 'utf-8'));
      const memory = JSON.parse(readFileSync(join(shardDir, 'shard-memory-summary.json'), 'utf-8'));
      const observability = JSON.parse(readFileSync(join(shardDir, 'shard-observability.json'), 'utf-8'));

      assert.equal(soul.shard_id, shard.shard_id);
      assert.equal(memory.shard_id, shard.shard_id);
      assert.equal(observability.shard_id, shard.shard_id);
      assert.equal(typeof soul.selected_soul_chunk_count, 'number');
      assert.equal(typeof memory.memory_doc_count, 'number');
      assert.equal(observability.observability.raw_docs >= 1, true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

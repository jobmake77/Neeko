import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SpeakerResolver,
  SceneClassifier,
  buildChatEvidenceBatchFromFile,
  buildStandaloneEvidenceBatch,
  buildVideoTranscriptEvidenceBatch,
  convertEvidenceItemsToDocuments,
  writeEvidenceArtifacts,
} from '../dist/testing/evidence-layer-test-entry.js';

function manifest() {
  return {
    target_name: 'Alice',
    target_aliases: ['Alice', '@alice'],
    self_aliases: ['Bob', 'Me'],
    known_other_aliases: ['Carol'],
    default_scene: 'private',
  };
}

test('SpeakerResolver maps target self and other aliases correctly', () => {
  const resolver = new SpeakerResolver(manifest());
  assert.deepEqual(resolver.resolveSpeaker('Alice').role, 'target');
  assert.deepEqual(resolver.resolveSpeaker('Bob').role, 'self');
  assert.deepEqual(resolver.resolveSpeaker('Carol').role, 'other');
  assert.deepEqual(resolver.resolveSpeaker('Unknown').role, 'unknown');
});

test('SceneClassifier favors work and conflict signals', () => {
  const classifier = new SceneClassifier(manifest());
  assert.equal(classifier.classify({ content: 'deadline is tomorrow and we need a deploy plan' }, 'feishu'), 'work');
  assert.equal(classifier.classify({ content: 'I love you and miss you so much' }, 'wechat'), 'intimate');
  assert.equal(classifier.classify({ content: 'you should shut up right now' }, 'wechat'), 'conflict');
});

test('buildChatEvidenceBatchFromFile creates target-centered windows with context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'neeko-evidence-'));
  const filePath = join(dir, 'chat.json');
  writeFileSync(filePath, JSON.stringify([
    { sender: 'Bob', content: 'What do you think about quality?', timestamp: '2026-04-01T10:00:00Z' },
    { sender: 'Alice', content: 'I think quality compounds when teams keep the bar stable.', timestamp: '2026-04-01T10:01:00Z' },
    { sender: 'Carol', content: 'Makes sense.', timestamp: '2026-04-01T10:01:20Z' },
    { sender: 'Alice', content: 'We should document tradeoffs as well.', timestamp: '2026-04-01T10:01:40Z' },
    { sender: 'Bob', content: 'Noted.', timestamp: '2026-04-01T10:02:00Z' },
  ]), 'utf-8');

  const batch = await buildChatEvidenceBatchFromFile(filePath, {
    manifest: manifest(),
    sourceType: 'wechat',
    sourceUrl: filePath,
  });

  assert.equal(batch.stats.sessions, 1);
  assert.equal(batch.stats.target_windows, 2);
  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[0].context_before.length, 1);
  assert.equal(batch.items[0].context_after.length, 1);
  assert.equal(batch.items[1].content.includes('document tradeoffs'), true);
});

test('standalone and video evidence batches convert into routable documents', () => {
  const docs = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      source_type: 'video',
      source_url: '/tmp/example.mp4',
      source_platform: 'local',
      content: 'We should reason from constraints before choosing a tool.',
      author: 'Alice',
      published_at: '2026-04-01T00:00:00.000Z',
      fetched_at: '2026-04-01T00:00:00.000Z',
      metadata: {
        speaker_segments: [],
        segment_start_ms: 0,
        segment_end_ms: 4000,
        nonverbal_signals: [],
      },
    },
  ];
  const batch = buildVideoTranscriptEvidenceBatch(docs, manifest());
  const routedDocs = convertEvidenceItemsToDocuments(batch.items, docs);
  assert.equal(batch.items[0].modality, 'transcript');
  assert.equal(routedDocs[0].metadata.evidence.modality, 'transcript');
});

test('writeEvidenceArtifacts writes audit files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neeko-evidence-write-'));
  const batch = buildStandaloneEvidenceBatch([
    {
      id: '11111111-1111-4111-8111-111111111111',
      source_type: 'twitter',
      source_url: 'https://x.com/example/status/1',
      source_platform: 'twitter',
      content: 'I believe in patient compounding.',
      author: 'Alice',
      author_handle: '@alice',
      published_at: '2026-04-01T00:00:00.000Z',
      fetched_at: '2026-04-01T00:00:00.000Z',
      metadata: {},
    },
  ], { manifest: manifest() });
  const paths = writeEvidenceArtifacts(dir, batch, manifest());
  assert.equal(readFileSync(paths.evidence_stats_path, 'utf-8').includes('"raw_messages"'), true);
  assert.equal(readFileSync(paths.target_manifest_path, 'utf-8').includes('"target_name": "Alice"'), true);
});

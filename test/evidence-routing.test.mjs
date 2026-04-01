import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __evidenceRoutingTestables,
  normalizeInputRoutingStrategy,
  routeEvidenceDocuments,
} from '../dist/testing/evidence-routing-test-entry.js';

const { scoreClarity, looksEphemeral } = __evidenceRoutingTestables;

function doc(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    source_type: 'twitter',
    content: 'I believe long-term product quality compounds over time, and I keep repeating that principle across projects because strong systems are built by protecting the details, documenting decisions, and sticking to the same standard even when the short-term incentive is to move faster.',
    author: 'target',
    author_handle: '@target',
    published_at: '2026-03-31T00:00:00.000Z',
    fetched_at: '2026-03-31T00:00:00.000Z',
    ...overrides,
  };
}

test('normalizeInputRoutingStrategy defaults to legacy', () => {
  assert.equal(normalizeInputRoutingStrategy(undefined), 'legacy');
  assert.equal(normalizeInputRoutingStrategy('v2'), 'v2');
  assert.equal(normalizeInputRoutingStrategy('unknown'), 'legacy');
});

test('legacy routing keeps cleaned docs for soul extraction', () => {
  const result = routeEvidenceDocuments([doc()], {
    strategy: 'legacy',
    targetSignals: ['target'],
  });
  assert.equal(result.soulDocs.length, 1);
  assert.equal(result.memoryDocs.length, 0);
  assert.equal(result.discardDocs.length, 0);
});

test('v2 routing sends stable first-party text to soul', () => {
  const result = routeEvidenceDocuments([doc()], {
    strategy: 'v2',
    targetSignals: ['target', '@target'],
  });
  assert.equal(result.soulDocs.length, 1);
  assert.equal(result.memoryDocs.length, 0);
  assert.equal(result.discardDocs.length, 0);
});

test('v2 routing discards low-context noisy fragments', () => {
  const result = routeEvidenceDocuments([
    doc({
      content: 'lol',
      author: 'unknown',
      author_handle: undefined,
      published_at: undefined,
    }),
  ], {
    strategy: 'v2',
    targetSignals: ['target'],
  });
  assert.equal(result.soulDocs.length, 0);
  assert.equal(result.memoryDocs.length, 0);
  assert.equal(result.observability.discard_docs >= 1, true);
});

test('helper scoring reflects clarity and ephemeral cues', () => {
  assert.equal(looksEphemeral('lol this week we will see'), true);
  assert.ok(scoreClarity('This is a reasonably complete sentence with enough context and a clear ending.') > scoreClarity('a'));
});

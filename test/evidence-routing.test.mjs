import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __evidenceRoutingTestables,
  normalizeInputRoutingStrategy,
  routeEvidenceDocuments,
  routeEvidenceItems,
  SemanticChunker,
} from '../dist/testing/evidence-routing-test-entry.js';

const {
  deriveCorpusRoutingHints,
  scoreClarity,
  looksEphemeral,
  desiredSoulDocCount,
  qualifiesAsShortFormSoulSignal,
  shouldKeepAsMemoryInLargeCorpus,
} = __evidenceRoutingTestables;

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
  assert.equal(
    looksEphemeral('Today I think the long-term direction matters more than short-term convenience because durable systems compound through careful choices, repeated standards, and a team culture that keeps documenting tradeoffs instead of improvising every important decision under deadline pressure.'),
    false
  );
  assert.ok(scoreClarity('This is a reasonably complete sentence with enough context and a clear ending.') > scoreClarity('a'));
});

test('v2 promotes enough soul docs for tiny corpora', () => {
  const result = routeEvidenceDocuments([
    doc(),
    doc({ id: '22222222-2222-4222-8222-222222222222', content: 'We should repeatedly revisit first-principles tradeoffs because constraints shape the system more than taste does in the long run.' }),
    doc({ id: '33333333-3333-4333-8333-333333333333', content: 'Short contextual note about shipping velocity versus quality and what gets lost when teams only optimize for speed.' }),
    doc({ id: '44444444-4444-4444-8444-444444444444', content: 'lol' }),
  ], {
    strategy: 'v2',
    targetSignals: ['target', '@target'],
  });
  assert.equal(result.soulDocs.length >= 2, true);
  assert.equal(result.observability.promoted_to_soul_docs >= 0, true);
  assert.equal(desiredSoulDocCount(4), 2);
});

test('short high-engagement first-party tweets can still shape soul in v2', () => {
  const tweet = doc({
    content: 'Neuralink enables people with ALS to speak again',
    metadata: {
      likes: 66758,
      views: '11985698',
    },
  });
  assert.equal(
    qualifiesAsShortFormSoulSignal(tweet, tweet.content, 0.92, 0.66, 0.35, deriveCorpusRoutingHints([tweet])),
    true
  );
  const result = routeEvidenceDocuments([tweet], {
    strategy: 'v2',
    targetSignals: ['target', '@target'],
  });
  assert.equal(result.soulDocs.length, 1);
});

test('short-form soul promotion stays off for long-form dominant corpora', () => {
  const longFormCorpus = [
    doc(),
    doc({
      id: '22222222-2222-4222-8222-222222222222',
      content: 'I think a lot about the structure of learning systems, and the reason I keep returning to first principles is that abstractions only become powerful after you understand the constraints that produced them in the first place.',
    }),
  ];
  const shortTweet = doc({
    id: '33333333-3333-4333-8333-333333333333',
    content: 'nanoGPT - the first LLM to train and inference in space. It begins.',
    metadata: { likes: 1000, views: 100000 },
  });

  assert.equal(
    qualifiesAsShortFormSoulSignal(
      shortTweet,
      shortTweet.content,
      0.92,
      0.66,
      0.35,
      deriveCorpusRoutingHints([...longFormCorpus, shortTweet])
    ),
    false
  );
});

test('large corpora keep lightweight reply tweets in memory even when they are clear', () => {
  const corpus = Array.from({ length: 320 }, (_, index) => doc({
    id: `${String(index + 1).padStart(12, '0')}-1111-4111-8111-111111111111`,
    content: `Long-form training note ${index}. I believe stable engineering taste compounds when teams repeat the same standards across projects and explain the tradeoffs clearly every time.`,
  }));
  const replyTweet = doc({
    id: '99999999-9999-4999-8999-999999999999',
    content: '@someone yeah exactly, love this direction a lot and I think it is pretty exciting overall.',
    metadata: { likes: 3, views: 1200 },
  });
  const hints = deriveCorpusRoutingHints([...corpus, replyTweet]);

  assert.equal(shouldKeepAsMemoryInLargeCorpus(replyTweet, replyTweet.content, 0.86, 0.7, hints), true);

  const result = routeEvidenceDocuments([...corpus, replyTweet], {
    strategy: 'v2',
    targetSignals: ['target', '@target'],
  });
  assert.equal(result.soulDocs.some((item) => item.id === replyTweet.id), false);
  assert.equal(result.memoryDocs.some((item) => item.id === replyTweet.id), true);
});

test('large clear temporal essays are still allowed into soul', () => {
  const result = routeEvidenceDocuments([
    doc({
      content: 'Today I spent a few hours revisiting the training stack, and the main lesson still seems durable: strong systems come from insisting on clean interfaces, clear ownership, and repeated first-principles reasoning even when the schedule is tight.',
    }),
  ], {
    strategy: 'v2',
    targetSignals: ['target', '@target'],
  });
  assert.equal(result.soulDocs.length, 1);
});

test('routeEvidenceItems keeps private target evidence in memory and blocks conflict soul writes', () => {
  const base = {
    source_type: 'wechat',
    modality: 'chat',
    speaker_role: 'target',
    speaker_name: 'target',
    target_confidence: 0.99,
    conversation_id: 'chat-1',
    window_role: 'target_centered',
    context_before: [{ speaker_name: 'me', speaker_role: 'self', content: 'what do you think?' }],
    context_after: [],
    evidence_kind: 'statement',
    stability_hints: { repeated_count: 2, repeated_in_sessions: 2, cross_session_stable: true },
    metadata: {},
  };
  const result = routeEvidenceItems([
    {
      id: '11111111-1111-4111-8111-111111111111',
      raw_document_id: '11111111-1111-4111-8111-111111111111',
      ...base,
      content: 'I think the long-term direction matters more than the short-term convenience in most product decisions.',
      scene: 'private',
      timestamp_start: '2026-03-31T00:00:00.000Z',
      timestamp_end: '2026-03-31T00:00:05.000Z',
      session_id: 's1',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      raw_document_id: '22222222-2222-4222-8222-222222222222',
      ...base,
      content: 'I am furious and you should just shut up right now.',
      scene: 'conflict',
      timestamp_start: '2026-03-31T01:00:00.000Z',
      timestamp_end: '2026-03-31T01:00:05.000Z',
      session_id: 's2',
    },
  ], {
    strategy: 'v2',
    targetSignals: ['target'],
  });
  assert.equal(result.soulDocs.length, 0);
  assert.equal(result.memoryDocs.length >= 1, true);
  assert.equal(result.discardDocs.length, 0);
});

test('semantic chunker splits oversized single-paragraph text into bounded chunks', () => {
  const chunker = new SemanticChunker({ maxTokens: 120, overlapTokens: 20 });
  const longText = '这是一段非常长的连续文本。'.repeat(120);
  const chunks = chunker.chunk({
    id: 'chunk-doc',
    source_type: 'twitter',
    content: longText,
    author: 'target',
    author_handle: '@target',
    published_at: '2026-03-31T00:00:00.000Z',
    fetched_at: '2026-03-31T00:00:00.000Z',
  });

  assert.equal(chunks.length > 1, true);
  assert.equal(chunks.every((chunk) => chunk.token_count <= 140), true);
});

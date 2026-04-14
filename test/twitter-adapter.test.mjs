import test from 'node:test';
import assert from 'node:assert/strict';
import { __twitterAdapterTestables } from '../dist/testing/twitter-adapter-test-entry.js';

const {
  filterTweetsByHandle,
  computeNextUntilDate,
} = __twitterAdapterTestables;

test('filterTweetsByHandle keeps only exact handle matches', () => {
  const filtered = filterTweetsByHandle([
    { id: '1', author: 'signulll', text: 'one', created_at: '2026-04-01T00:00:00.000Z' },
    { id: '2', author: '@signulll', text: 'two', created_at: '2026-03-31T00:00:00.000Z' },
    { id: '3', author: 'other', text: 'three', created_at: '2026-03-30T00:00:00.000Z' },
    { id: '4', author: 'signulll', text: '   ', created_at: '2026-03-29T00:00:00.000Z' },
  ], 'signulll');

  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((item) => item.id), ['1', '2']);
});

test('computeNextUntilDate anchors pagination on oldest matched tweet date', () => {
  const nextUntil = computeNextUntilDate([
    { id: '1', author: 'signulll', text: 'one', created_at: 'Tue Dec 31 16:55:30 +0000 2024' },
    { id: '2', author: 'signulll', text: 'two', created_at: 'Mon Jan 06 10:12:00 +0000 2025' },
    { id: '3', author: 'signulll', text: 'three', created_at: 'Wed Jan 01 09:00:00 +0000 2025' },
  ]);

  assert.equal(nextUntil, '2024-12-31');
});

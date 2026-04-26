import test from 'node:test';
import assert from 'node:assert/strict';
import { __trainTestables } from '../dist/testing/train-test-entry.js';

const { validateRemoteSourceDocumentsForPersona } = __trainTestables;

test('article attribution rejects pages that clearly belong to a different person', () => {
  const outcome = validateRemoteSourceDocumentsForPersona('garrytan-test', {
    id: 'source-1',
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://garrytan.com',
    links: [],
    target_aliases: [],
    enabled: true,
    status: 'idle',
  }, [
    {
      id: '11111111-1111-4111-8111-111111111111',
      source_type: 'article',
      source_url: 'https://garrytan.com/',
      source_platform: 'garrytan.com',
      content: "Hey! I'm Anthony Fu, a fanatical open sourceror and design engineer.",
      author: 'unknown',
      fetched_at: '2026-04-26T00:00:00.000Z',
      metadata: {
        title: 'Anthony Fu',
        fetched_via: 'opencli_web_read',
      },
    },
  ]);

  assert.equal(outcome.results[0].status, 'rejected');
  assert.equal(outcome.accepted.length, 0);
  assert.match(outcome.results[0].summary, /Anthony Fu/);
});

test('article attribution accepts pages with explicit first-party identity signals', () => {
  const outcome = validateRemoteSourceDocumentsForPersona('garrytan-test', {
    id: 'source-1',
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://garrytan.com',
    links: [],
    target_aliases: [],
    enabled: true,
    status: 'idle',
  }, [
    {
      id: '22222222-2222-4222-8222-222222222222',
      source_type: 'article',
      source_url: 'https://garrytan.com/about',
      source_platform: 'garrytan.com',
      content: "I'm Garry Tan. I invest in founders and write about startups, software, and communities.",
      author: 'Garry Tan',
      fetched_at: '2026-04-26T00:00:00.000Z',
      metadata: {
        title: 'Garry Tan',
        fetched_via: 'opencli_web_read',
      },
    },
  ]);

  assert.equal(outcome.results[0].status, 'accepted');
  assert.equal(outcome.accepted.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { __trainTestables } from '../dist/testing/train-test-entry.js';
import { WorkbenchService } from '../dist/testing/train-test-entry.js';

const { validateRemoteSourceDocumentsForPersona } = __trainTestables;

function makeRemoteArticleSource() {
  return {
    id: 'source-preview-1',
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://example.com/profile',
    links: ['https://example.com/profile'],
    target_aliases: [],
    enabled: true,
    status: 'idle',
  };
}

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
      content: "Hey! I'm Anthony Fu, a fanatical open sourceror and design engineer. This page is Anthony's profile page, where he introduces his own open source work, design engineering interests, and the projects he maintains. It is clearly centered on Anthony Fu rather than Garry Tan, so the attribution layer should reject it.",
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
      content: "I'm Garry Tan. I invest in founders and write about startups, software, and communities. This page explains my background, the kinds of founders I work with, the software topics I care about, and the broader communities I participate in. It is a first-party about page with explicit identity signals tied to Garry Tan.",
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

test('source preview returns localized error state when preview target times out', async () => {
  const service = new WorkbenchService();
  service.withPreviewTimeout = async () => {
    throw new Error('source preview https://example.com/profile timeout after 20ms');
  };

  const preview = await service.previewPersonaSource({
    persona_name: 'garrytan-test',
    source: makeRemoteArticleSource(),
  });

  assert.equal(preview.status, 'error');
  assert.equal(preview.summary, '当前来源暂时无法给出有效预览，请稍后重试。');
  assert.equal(preview.target_results.length, 1);
  assert.equal(preview.target_results[0].status, 'error');
  assert.match(preview.target_results[0].error ?? '', /timeout/i);
});

test('source preview returns localized error state when remote provider fetch fails', async () => {
  const service = new WorkbenchService();
  service.fetchPreviewDocumentsForTarget = async () => {
    throw new Error('provider unavailable');
  };

  const preview = await service.previewPersonaSource({
    persona_name: 'garrytan-test',
    source: makeRemoteArticleSource(),
  });

  assert.equal(preview.status, 'error');
  assert.equal(preview.summary, '当前来源暂时无法给出有效预览，请稍后重试。');
  assert.equal(preview.target_results.length, 1);
  assert.equal(preview.target_results[0].status, 'error');
  assert.match(preview.target_results[0].error ?? '', /provider unavailable/i);
});

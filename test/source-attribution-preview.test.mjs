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

test('article attribution rejects aggregator and directory style pages before they enter cultivation', () => {
  const outcome = validateRemoteSourceDocumentsForPersona('garrytan-test', {
    id: 'source-aggregator-1',
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://garrytan.com/archive',
    links: ['https://garrytan.com/archive'],
    target_aliases: [],
    enabled: true,
    status: 'idle',
  }, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      source_type: 'article',
      source_url: 'https://garrytan.com/archive',
      source_platform: 'garrytan.com',
      content: 'All posts, archives, categories, and tags for founder essays, startup notes, and community writing.',
      author: 'Garry Tan',
      fetched_at: '2026-04-26T00:00:00.000Z',
      metadata: {
        title: 'All Posts Archive',
        fetched_via: 'opencli_web_read',
      },
    },
  ]);

  assert.equal(outcome.results[0].status, 'rejected');
  assert.equal(outcome.results[0].reason_code, 'article_aggregator_page');
  assert.equal(outcome.accepted.length, 0);
});

test('article attribution quarantines weakly related background pages instead of accepting them as first-party sources', () => {
  const outcome = validateRemoteSourceDocumentsForPersona('garrytan-test', {
    id: 'source-weak-1',
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://example.com/ai-infra-landscape',
    links: ['https://example.com/ai-infra-landscape'],
    target_aliases: [],
    enabled: true,
    status: 'idle',
  }, [
    {
      id: '55555555-5555-4555-8555-555555555555',
      source_type: 'article',
      source_url: 'https://example.com/ai-infra-landscape',
      source_platform: 'example.com',
      content: 'A broad landscape analysis of AI infra companies, startup ecosystems, and cloud tooling. The page mentions Garry Tan once as one of many investors, but the body is mostly about the market rather than a page owned by him.',
      author: '',
      fetched_at: '2026-04-26T00:00:00.000Z',
      metadata: {
        title: 'ai infra market map',
        fetched_via: 'opencli_web_read',
      },
    },
  ]);

  assert.equal(outcome.results[0].status, 'quarantined');
  assert.equal(outcome.results[0].reason_code, 'article_identity_weak');
  assert.equal(outcome.quarantined.length, 1);
});

test('source preview keeps reason code aligned with the ingest-time article validator', async () => {
  const source = {
    id: 'source-preview-stable-1',
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://garrytan.com/about',
    links: ['https://garrytan.com/about'],
    target_aliases: ['Garry Tan'],
    enabled: true,
    status: 'idle',
  };
  const docs = [
    {
      id: '66666666-6666-4666-8666-666666666666',
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
  ];
  const ingest = validateRemoteSourceDocumentsForPersona('garrytan-test', source, docs);

  const service = new WorkbenchService();
  service.fetchPreviewDocumentsForTarget = async () => docs;

  const preview = await service.previewPersonaSource({
    persona_name: 'garrytan-test',
    source,
  });

  assert.equal(preview.status, 'accepted');
  assert.equal(preview.target_results[0].status, ingest.results[0].status);
  assert.equal(preview.target_results[0].reason_code, ingest.results[0].reason_code);
});

test('preview and ingest keep the same structured reason bucket for source relevance', async () => {
  const source = {
    id: 'source-bucket-1',
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://garrytan.com/about',
    links: ['https://garrytan.com/about'],
    target_aliases: [],
    enabled: true,
    status: 'idle',
  };
  const docs = [
    {
      id: '66666666-6666-4666-8666-666666666666',
      source_type: 'article',
      source_url: 'https://garrytan.com/about',
      source_platform: 'garrytan.com',
      content: "I'm Garry Tan. I invest in founders and write about startups, software, and communities. This page explains my background, the kinds of founders I work with, the software topics I care about, and the broader communities I participate in.",
      author: 'Garry Tan',
      fetched_at: '2026-04-26T00:00:00.000Z',
      metadata: {
        title: 'About Garry Tan',
        fetched_via: 'opencli_web_read',
      },
    },
  ];
  const ingest = validateRemoteSourceDocumentsForPersona('garrytan-test', source, docs);

  const service = new WorkbenchService();
  service.fetchPreviewDocumentsForTarget = async () => docs;

  const preview = await service.previewPersonaSource({
    persona_name: 'garrytan-test',
    source,
  });

  assert.equal(preview.status, 'rejected');
  assert.equal(preview.target_results[0].status, ingest.results[0].status);
  assert.equal(preview.target_results[0].reason_code, ingest.results[0].reason_code);
  assert.equal(preview.target_results[0].relevance_bucket, ingest.results[0].relevance_bucket);
  assert.equal(preview.target_results[0].relevance_bucket, 'strong_related');
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

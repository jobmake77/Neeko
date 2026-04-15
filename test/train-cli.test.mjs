import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __trainTestables } from '../dist/testing/train-test-entry.js';

const { loadTrainingRawDocs } = __trainTestables;
const { resolveTrackStageTimeoutMs, resolveTrackBudgetMs } = __trainTestables;

test('loadTrainingRawDocs prefers prep documents over empty persona cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neeko-train-'));
  const prepDir = join(dir, 'prep');
  mkdirSync(prepDir, { recursive: true });

  writeFileSync(join(dir, 'raw-docs.json'), '[]', 'utf-8');
  writeFileSync(
    join(prepDir, 'documents.json'),
    JSON.stringify([
      {
        id: 'doc-1',
        source_type: 'twitter',
        source_url: 'https://x.com/signulll/status/1',
        source_platform: 'twitter',
        content: 'test corpus',
        author: 'signulll',
        author_handle: '@signulll',
        published_at: '2026-04-14T00:00:00.000Z',
      },
    ]),
    'utf-8'
  );

  const docs = loadTrainingRawDocs(dir, {
    prep_documents_path: join(prepDir, 'documents.json'),
  });

  assert.equal(docs.length, 1);
  assert.equal(docs[0].author_handle, '@signulll');
});

test('loadTrainingRawDocs falls back to persona raw-docs cache when prep is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neeko-train-'));
  writeFileSync(
    join(dir, 'raw-docs.json'),
    JSON.stringify([
      {
        id: 'doc-cache',
        source_type: 'twitter',
        source_url: 'https://x.com/signulll/status/2',
        source_platform: 'twitter',
        content: 'cached corpus',
        author: 'signulll',
        author_handle: '@signulll',
        published_at: '2026-04-13T00:00:00.000Z',
      },
    ]),
    'utf-8'
  );

  const docs = loadTrainingRawDocs(dir);

  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, 'doc-cache');
});

test('resolveTrackStageTimeoutMs scales up for large persona_extract corpora', () => {
  assert.equal(resolveTrackStageTimeoutMs(495, 'persona_extract'), 480000);
  assert.equal(resolveTrackStageTimeoutMs(530, 'persona_extract'), 720000);
  assert.equal(resolveTrackStageTimeoutMs(530, 'work_execute'), 600000);
});

test('resolveTrackBudgetMs stays above per-attempt timeout budget', () => {
  assert.equal(resolveTrackBudgetMs(530, 'persona_extract', 2), 2220000);
  assert.equal(resolveTrackBudgetMs(20, 'persona_extract', 2), 600000);
});

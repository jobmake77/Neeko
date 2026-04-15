import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __trainTestables } from '../dist/testing/train-test-entry.js';

const {
  loadTrainingRawDocs,
  resolveTrackStageTimeoutMs,
  resolveTrackBudgetMs,
  resolveInProcessRetryLimit,
  mergeDocumentCollections,
  deriveEvaluationPassed,
  buildCollectionContinuationDecision,
} = __trainTestables;

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
  assert.equal(resolveTrackStageTimeoutMs(495, 'persona_extract'), 600000);
  assert.equal(resolveTrackStageTimeoutMs(530, 'persona_extract'), 900000);
  assert.equal(resolveTrackStageTimeoutMs(530, 'work_execute'), 720000);
});

test('resolveTrackBudgetMs stays above per-attempt timeout budget', () => {
  assert.equal(resolveTrackBudgetMs(530, 'persona_extract', 2), 2760000);
  assert.equal(resolveTrackBudgetMs(20, 'persona_extract', 2), 600000);
});

test('resolveInProcessRetryLimit disables same-run timeout retry for large tracks', () => {
  assert.equal(resolveInProcessRetryLimit('generation_timeout', 2, 495, 'persona_extract'), 0);
  assert.equal(resolveInProcessRetryLimit('generation_timeout', 2, 20, 'persona_extract'), 1);
  assert.equal(resolveInProcessRetryLimit('structured_output_failure', 2, 495, 'persona_extract'), 1);
});

test('mergeDocumentCollections keeps cache baseline while deduping overlaps', () => {
  const merged = mergeDocumentCollections(
    [
      {
        id: 'remote-1',
        source_type: 'twitter',
        source_url: 'https://x.com/onevcat/status/1',
        source_platform: 'twitter',
        content: 'remote corpus 1',
        author: 'onevcat',
        author_handle: '@onevcat',
        published_at: '2026-04-14T00:00:00.000Z',
      },
    ],
    [
      {
        id: 'cache-1',
        source_type: 'twitter',
        source_url: 'https://x.com/onevcat/status/1',
        source_platform: 'twitter',
        content: 'remote corpus 1',
        author: 'onevcat',
        author_handle: '@onevcat',
        published_at: '2026-04-14T00:00:00.000Z',
      },
      {
        id: 'cache-2',
        source_type: 'twitter',
        source_url: 'https://x.com/onevcat/status/2',
        source_platform: 'twitter',
        content: 'cache-only corpus',
        author: 'onevcat',
        author_handle: '@onevcat',
        published_at: '2026-04-13T00:00:00.000Z',
      },
    ],
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.id).sort(), ['cache-2', 'remote-1']);
});

test('deriveEvaluationPassed prefers acceptance verdict when available', () => {
  assert.equal(deriveEvaluationPassed({ state: 'running' }), undefined);
  assert.equal(deriveEvaluationPassed({ state: 'completed' }), true);
  assert.equal(deriveEvaluationPassed({ state: 'interrupted' }), false);
  assert.equal(deriveEvaluationPassed({ state: 'running', acceptance: { pass: false } }), false);
});

test('buildCollectionContinuationDecision continues below threshold and after failed evaluation', () => {
  assert.equal(buildCollectionContinuationDecision({
    cleanDocumentCount: 275,
    trainingThreshold: 500,
    evaluationPassed: undefined,
    historyExhausted: false,
    providerExhausted: false,
    collectionCycle: 1,
    hasActiveRun: false,
  }).shouldContinue, true);

  assert.equal(buildCollectionContinuationDecision({
    cleanDocumentCount: 620,
    trainingThreshold: 500,
    evaluationPassed: false,
    historyExhausted: false,
    providerExhausted: false,
    collectionCycle: 2,
    hasActiveRun: false,
  }).shouldContinue, true);

  const exhausted = buildCollectionContinuationDecision({
    cleanDocumentCount: 620,
    trainingThreshold: 500,
    evaluationPassed: false,
    historyExhausted: true,
    providerExhausted: true,
    collectionCycle: 3,
    hasActiveRun: false,
  });
  assert.equal(exhausted.shouldContinue, false);
  assert.equal(exhausted.blockedReason, 'exhausted_retry_limit');
});

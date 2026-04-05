import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadTrainingSeedHints,
  normalizeTrainingSeedMode,
} from '../dist/testing/training-seed-test-entry.js';

test('normalizeTrainingSeedMode keeps default off and accepts known modes', () => {
  assert.equal(normalizeTrainingSeedMode(undefined), 'off');
  assert.equal(normalizeTrainingSeedMode('topics'), 'topics');
  assert.equal(normalizeTrainingSeedMode('signals'), 'signals');
  assert.equal(normalizeTrainingSeedMode('weird'), 'off');
});

test('loadTrainingSeedHints returns empty hints when disabled or missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neeko-training-seed-'));

  try {
    const disabled = loadTrainingSeedHints(dir, 'off');
    assert.deepEqual(disabled.hints, []);
    assert.equal(disabled.reason, 'training-seed mode disabled');

    const missing = loadTrainingSeedHints(dir, 'topics');
    assert.deepEqual(missing.hints, []);
    assert.equal(missing.reason, 'training-seed.json not found');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTrainingSeedHints loads stable topics and signals safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neeko-training-seed-'));

  try {
    writeFileSync(
      join(dir, 'training-seed.json'),
      JSON.stringify({
        stable_keywords: ['llm training', 'attention', ''],
        stable_topics: ['model scaling', 'data quality'],
        stable_signal_count: 2,
        topic_cluster_count: 2,
      }, null, 2),
      'utf-8'
    );

    const topics = loadTrainingSeedHints(dir, 'topics');
    assert.deepEqual(topics.hints, ['model scaling', 'data quality']);
    assert.equal(topics.reason, 'loaded 2 topic clusters');

    const signals = loadTrainingSeedHints(dir, 'signals');
    assert.deepEqual(signals.hints, ['model scaling', 'data quality', 'llm training', 'attention']);
    assert.equal(signals.reason, 'loaded 2 stable signals');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTrainingSeedHints prioritizes more specific signal hints and dedupes roots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neeko-training-seed-'));

  try {
    writeFileSync(
      join(dir, 'training-seed.json'),
      JSON.stringify({
        stable_topics: ['llm training', 'prompt design', 'model behavior'],
        stable_keywords: [
          'model',
          'agent systems',
          'agent',
          'context engineering',
          'context',
          'data flywheel',
          'data',
          'agent systems',
          'usually',
        ],
        stable_signal_count: 8,
      }, null, 2),
      'utf-8'
    );

    const signals = loadTrainingSeedHints(dir, 'signals', 4);
    assert.deepEqual(signals.hints, [
      'llm training',
      'prompt design',
      'context engineering',
      'agent systems',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

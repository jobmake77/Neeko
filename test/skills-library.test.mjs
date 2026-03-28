import test from 'node:test';
import assert from 'node:assert/strict';
import { __skillLibraryTestables } from '../dist/testing/skills-test-entry.js';

const {
  similarityByTokenOverlap,
  dedupeOrigins,
  mergeOrigins,
  mergeExpandedSkills,
  computeCoverageByOrigin,
} = __skillLibraryTestables;

function origin(id, name, confidence = 0.7, evidenceCount = 2) {
  return {
    id,
    name,
    why: `${name} why`,
    how: `${name} how`,
    confidence,
    evidence: Array.from({ length: evidenceCount }, (_, i) => ({
      quote: `${name} quote ${i + 1}`,
      source: 'tweet',
    })),
  };
}

function expanded(id, originId, name, confidence = 0.7, similarity = 0.7, sourceRef = '') {
  return {
    id,
    origin_id: originId,
    name,
    similarity,
    source_platform: 'twitter',
    source_ref: sourceRef || `@${name.toLowerCase().replace(/\s+/g, '')}`,
    transferable_summary: `${name} summary`,
    confidence,
  };
}

test('similarityByTokenOverlap returns high score for close phrases', () => {
  const score = similarityByTokenOverlap('growth hacking strategy', 'growth strategy');
  assert.ok(score >= 0.66);
});

test('dedupeOrigins keeps one origin for semantically similar names', () => {
  const result = dedupeOrigins([
    origin('o1', 'Growth Strategy', 0.65),
    origin('o2', 'Growth   strategy', 0.88),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'o2');
});

test('mergeOrigins preserves existing and upgrades confidence/evidence', () => {
  const prev = [origin('o1', 'Storytelling', 0.6, 2)];
  const incoming = [origin('o2', 'Storytelling', 0.9, 3), origin('o3', 'Positioning', 0.7, 2)];
  const merged = mergeOrigins(prev, incoming);

  assert.equal(merged.length, 2);
  const storytelling = merged.find((x) => x.name.toLowerCase().includes('storytelling'));
  assert.ok(storytelling);
  assert.equal(storytelling.confidence, 0.9);
  assert.ok(storytelling.evidence.length >= 3);
});

test('mergeExpandedSkills enforces max 3 expansions per origin with best scores', () => {
  const origins = [origin('o1', 'Negotiation', 0.8)];
  const prev = [
    expanded('e1', 'o1', 'Anchoring', 0.6, 0.6, '@a1'),
    expanded('e2', 'o1', 'Framing', 0.6, 0.6, '@f1'),
  ];
  const incoming = [
    expanded('e3', 'o1', 'BATNA', 0.92, 0.8, '@b1'),
    expanded('e4', 'o1', 'Concession Strategy', 0.85, 0.79, '@c1'),
    expanded('e5', 'o1', 'Decision Tree', 0.83, 0.78, '@d1'),
  ];
  const merged = mergeExpandedSkills(prev, incoming, origins);
  assert.equal(merged.length, 3);
  const names = merged.map((x) => x.name);
  assert.ok(names.includes('BATNA'));
  assert.ok(names.includes('Concession Strategy'));
});

test('computeCoverageByOrigin ranks lower coverage first', () => {
  const library = {
    origin_skills: [origin('o1', 'Negotiation'), origin('o2', 'Storytelling')],
    expanded_skills: [expanded('e1', 'o2', 'Narrative Arc'), expanded('e2', 'o2', 'Audience Design')],
  };
  const result = computeCoverageByOrigin(library);
  assert.equal(result.length, 2);
  assert.equal(result[0].origin_id, 'o1');
  assert.equal(result[0].missing_slots, 3);
  assert.equal(result[1].origin_id, 'o2');
  assert.equal(result[1].missing_slots, 1);
});

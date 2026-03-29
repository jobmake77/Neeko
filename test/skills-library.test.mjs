import test from 'node:test';
import assert from 'node:assert/strict';
import { __skillLibraryTestables } from '../dist/testing/skills-test-entry.js';

const {
  similarityByTokenOverlap,
  dedupeOrigins,
  mergeOrigins,
  computeCoverageByOrigin,
  gateCandidateSkill,
  selectFinalDistilledSkills,
  clusterOrigins,
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
      source: i % 2 === 0 ? 'tweet' : 'blog',
    })),
  };
}

function distilled(id, name, score = 0.8) {
  return {
    id,
    name,
    central_thesis: `${name} thesis`,
    why: `${name} why`,
    how_steps: ['step 1', 'step 2'],
    boundaries: ['only when context fits'],
    trigger_signals: ['signal 1'],
    anti_patterns: [],
    evidence_refs: [
      { source: '@a', source_platform: 'twitter', snippet: 's1', similarity: 0.8 },
      { source: 'https://x.com', source_platform: 'blog', snippet: 's2', similarity: 0.7 },
      { source: '@b', source_platform: 'twitter', snippet: 's3', similarity: 0.6 },
      { source: 'https://y.com', source_platform: 'blog', snippet: 's4', similarity: 0.6 },
    ],
    confidence: 0.8,
    contradiction_risk: 0.1,
    method_completeness: 0.9,
    coverage_tags: [name],
    quality_score: score,
    source_origin_ids: ['o1'],
    last_validated_at: null,
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

test('gateCandidateSkill rejects low-evidence skill', () => {
  const lowEvidence = {
    ...distilled('d1', 'Weak Skill', 0.5),
    evidence_refs: [{ source: '@a', source_platform: 'twitter', snippet: 'x', similarity: 0.5 }],
  };
  const result = gateCandidateSkill(lowEvidence);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.some((r) => r.includes('evidence_count')));
});

test('selectFinalDistilledSkills keeps dynamic 3-6 with quality priority', () => {
  const accepted = [
    distilled('d1', 'A', 0.95),
    distilled('d2', 'B', 0.9),
    distilled('d3', 'C', 0.85),
    distilled('d4', 'D', 0.8),
    distilled('d5', 'E', 0.75),
    distilled('d6', 'F', 0.7),
    distilled('d7', 'G', 0.65),
  ];
  const selected = selectFinalDistilledSkills(accepted, []);
  assert.equal(selected.distilled.length, 6);
  assert.equal(selected.distilled[0].name, 'A');
});

test('clusterOrigins merges semantically similar origins', () => {
  const clusters = clusterOrigins([
    origin('o1', 'Negotiation Strategy', 0.8),
    origin('o2', 'Negotiation Strategies', 0.7),
    origin('o3', 'Story Design', 0.7),
  ]);
  assert.ok(clusters.length <= 2);
});

test('computeCoverageByOrigin ranks lower coverage first', () => {
  const library = {
    origin_skills: [origin('o1', 'Negotiation'), origin('o2', 'Storytelling')],
    distilled_skills: [
      { ...distilled('d1', 'Narrative Arc'), source_origin_ids: ['o2'] },
      { ...distilled('d2', 'Audience Design'), source_origin_ids: ['o2'] },
    ],
  };
  const result = computeCoverageByOrigin(library);
  assert.equal(result.length, 2);
  assert.equal(result[0].origin_id, 'o1');
  assert.equal(result[0].missing_slots, 1);
  assert.equal(result[1].origin_id, 'o2');
  assert.equal(result[1].missing_slots, 0);
});

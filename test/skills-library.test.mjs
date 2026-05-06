import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __skillLibraryTestables,
  buildSkillLibraryFromEvidence,
} from '../dist/testing/skills-test-entry.js';

const {
  similarityByTokenOverlap,
  dedupeOrigins,
  mergeOrigins,
  selectAcceptedOriginCandidates,
  computeCoverageByOrigin,
  gateCandidateSkill,
  selectFinalDistilledSkills,
  clusterOrigins,
} = __skillLibraryTestables;

function persona() {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'HiTw93',
    slug: 'hitw93',
    handle: '@HiTw93',
    mode: 'single',
    source_targets: ['@HiTw93'],
    soul_path: 'soul.yaml',
    memory_collection: 'nico_hitw93',
    status: 'training',
    training_rounds: 0,
    memory_node_count: 0,
    doc_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function soul() {
  return {
    version: 1,
    target_name: 'HiTw93',
    target_handle: '@HiTw93',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    data_sources: [],
    total_chunks_processed: 0,
    language_style: {
      vocabulary_preferences: [],
      sentence_patterns: [],
      formality_level: 0.5,
      avg_sentence_length: 'medium',
      punctuation_quirks: [],
      frequent_phrases: [],
      languages_used: [],
    },
    values: { core_beliefs: [], priorities: [], known_stances: {} },
    thinking_patterns: {
      reasoning_style: [],
      decision_frameworks: [],
      cognitive_biases: [],
      problem_solving_approach: '',
      first_principles_tendency: 0.5,
      analogy_usage: 'occasional',
    },
    behavioral_traits: {
      social_patterns: [],
      stress_responses: [],
      signature_behaviors: [],
      humor_style: 'none',
      controversy_handling: 'engages-carefully',
    },
    knowledge_domains: { expert: [], familiar: [], blind_spots: [] },
    overall_confidence: 0,
    coverage_score: 0,
    training_rounds_completed: 0,
  };
}

function rawDoc(content, i, source = 'twitter') {
  return {
    id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    source_type: 'twitter',
    source_platform: source,
    source_url: `https://x.com/HiTw93/status/${i}`,
    content,
    author: 'HiTw93',
    author_handle: '@HiTw93',
    fetched_at: '2026-01-01T00:00:00.000Z',
  };
}

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

test('selectAcceptedOriginCandidates keeps transferable method candidates and defers weak ones', () => {
  const result = selectAcceptedOriginCandidates([
    {
      name: 'Optionality Mapping',
      why: 'Maps decisions by preserving upside while limiting irreversible downside.',
      how: 'List branches, remove irreversible downside, then rank by retained upside.',
      confidence: 0.78,
      evidence_quotes: ['quote 1', 'quote 2', 'quote 3'],
      transferable: true,
      evidence_strength: 0.8,
      method_specificity: 0.82,
    },
    {
      name: 'AI',
      why: 'Likes AI',
      how: 'Talks about AI',
      confidence: 0.4,
      evidence_quotes: ['quote 1'],
      transferable: false,
      evidence_strength: 0.2,
      method_specificity: 0.1,
    },
  ]);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.pending.length, 1);
  assert.equal(result.accepted[0].name, 'Optionality Mapping');
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

test('evidence-first skill build extracts Waza-style methods without memory signals', async () => {
  const docs = [
    rawDoc('/think 是我用来做方案设计的 skill。动手前先质疑问题本身，压测方案，再让 AI 执行。', 1, 'twitter'),
    rawDoc('A good engineer should think before coding: question the problem, stress-test the plan, and make architecture clear.', 2, 'blog'),
    rawDoc('/hunt 的核心规则是没有一句话说清根因之前不许碰代码。先复现、加观测、验证假设，再修。', 3, 'twitter'),
    rawDoc('Debugging should avoid patch churn. Find root cause first, then make the smallest fix and verify it.', 4, 'blog'),
    rawDoc('/check 是 code review skill。先审 diff，把能自动修的修掉，需要判断的归拢，用证据验证。', 5, 'twitter'),
    rawDoc('/read 是读一手资料，把 URL 或 PDF 转成干净 Markdown，保留来源，不依赖二手总结。', 6, 'blog'),
    rawDoc('/write 帮技术写作。先明确受众和目的，再组织论证，最后打磨表达。', 7, 'twitter'),
    rawDoc('/learn 用输出驱动学习。收集、消化、提纲、初稿、打磨、发布。', 8, 'blog'),
    rawDoc('/health 用来检查 CLAUDE.md、rules、hooks、MCP 这些工具链配置。', 9, 'twitter'),
  ];
  const result = await buildSkillLibraryFromEvidence(persona(), soul(), { docs }, undefined);
  assert.equal(result.library.origin_skills.length > 0, true);
  assert.equal(result.report.status === 'ready' || result.report.status === 'pending', true);
  assert.equal(result.library.distilled_skills.length + result.library.candidate_skill_pool.length > 0, true);
  assert.ok(
    result.library.origin_skills.some((item) => /debug|root|hunt|排查|根因/i.test(`${item.name} ${item.why} ${item.how}`))
  );
});

test('evidence-first skill build keeps weak generic corpus pending instead of fabricating distilled skills', async () => {
  const docs = [
    rawDoc('今天喝了咖啡，天气不错。', 21),
    rawDoc('这个项目挺有意思，之后再看看。', 22),
  ];
  const result = await buildSkillLibraryFromEvidence(persona(), soul(), { docs }, undefined);
  assert.equal(result.report.status, 'pending');
  assert.equal(result.library.distilled_skills.length, 0);
});

test('evidence-first skill build does not use memory signals as the only source', async () => {
  const result = await buildSkillLibraryFromEvidence(persona(), soul(), {
    docs: [],
    memorySignals: [
      '/hunt 的核心规则是没有一句话说清根因之前不许碰代码。先复现、加观测、验证假设，再修。',
      '/check 是 code review skill。先审 diff，把能自动修的修掉，需要判断的归拢，用证据验证。',
    ],
  }, undefined);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.failureReason, 'no_skill_evidence_docs');
  assert.equal(result.library.origin_skills.length, 0);
  assert.equal(result.library.distilled_skills.length, 0);
});

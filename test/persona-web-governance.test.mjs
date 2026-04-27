import test from 'node:test';
import assert from 'node:assert/strict';
import { __personaWebTestables } from '../dist/testing/persona-web-test-entry.js';

const {
  buildPersonaWebArtifacts,
  assessCandidateProvenance,
  detectChatKnowledgeLayer,
  buildNetworkPriorityContext,
} = __personaWebTestables;

test('persona web builder compiles relation and seed hints from anchored evidence', () => {
  const result = buildPersonaWebArtifacts({
    personaSlug: 'garrytan-test',
    targetName: 'Garry Tan',
    documents: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        source_type: 'twitter',
        author: 'Garry Tan',
        source_url: 'https://x.com/garrytan/status/1',
        content: 'I built Bookface and I write about startups, founders, and open source developer tools.',
        fetched_at: '2026-04-25T00:00:00.000Z',
        published_at: '2026-04-24T00:00:00.000Z',
      },
    ],
    evidenceItems: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        raw_document_id: '11111111-1111-1111-1111-111111111111',
        source_type: 'twitter',
        modality: 'text',
        content: 'I built Bookface and I care about helping founders move faster with better tools.',
        speaker_role: 'target',
        speaker_name: 'Garry Tan',
        target_confidence: 0.98,
        scene: 'public',
        window_role: 'target_centered',
        context_before: [],
        context_after: [],
        evidence_kind: 'statement',
        stability_hints: {
          repeated_count: 1,
          repeated_in_sessions: 1,
          cross_session_stable: true,
        },
        metadata: {},
      },
    ],
  });

  assert.ok(result.graph.relations.length > 0);
  assert.ok(result.trainingSeedV3.relationship_hints.length > 0);
  assert.ok(result.trainingSeedV3.topics.some((item) => /bookface|founders|tools/i.test(item)));
  assert.ok(result.trainingSeedV3.dominant_domains.some((item) => /developer tools|open source|startups/i.test(item)));
});

test('network priority context consumes training-seed-v3 hints for relation questions', () => {
  const layer = detectChatKnowledgeLayer('你和谁合作过？你跟哪些组织有关？');
  const context = buildNetworkPriorityContext(
    layer,
    {
      entity_count: 12,
      relation_count: 6,
      context_pack_count: 3,
      pending_candidate_count: 1,
      dominant_domains: ['startups', 'developer-tools'],
      arc_count: 2,
    },
    {
      topics: ['Bookface', 'YC'],
      signals: ['founder network', 'developer tools'],
      relationship_hints: ['Garry Tan collaborates with founders and YC companies'],
      context_hints: ['public: startup advice and fundraising'],
      identity_hints: ['He frames himself as a builder-investor'],
      provenance_guardrails: ['Do not turn pending related-context candidates into first-person facts'],
    },
    '你和谁合作过？'
  );

  assert.match(context, /Anchored relation hints:/);
  assert.match(context, /Garry Tan collaborates with founders and YC companies/);
  assert.match(context, /pending related-context candidates/i);
});

test('provenance guardrails block unsupported first-person background claims', () => {
  const assessment = assessCandidateProvenance(
    {
      summary: '我主导这家公司的股票策略和整个市场周期判断。',
      category: 'fact',
      soul_dimension: 'knowledge_domains',
      confidence: 0.82,
    },
    {
      coverage_score: 0.41,
      topics: ['SaaS', 'developer tools'],
      signals: ['startup investing'],
      relationship_hints: [],
      context_hints: ['public: startup advice and fundraising'],
      identity_hints: ['builder-investor'],
      guardrail_notes: ['Do not collapse background context into fabricated personal experience'],
    }
  );

  assert.equal(assessment.status, 'blocked');
  assert.match(assessment.reasons.join(' '), /background|first-person/i);
});

test('provenance guardrails support anchored first-person project claims', () => {
  const assessment = assessCandidateProvenance(
    {
      summary: '我做过 Bookface，也长期给 founder 和 developer tools 相关的话题写东西。',
      category: 'fact',
      soul_dimension: 'knowledge_domains',
      confidence: 0.86,
    },
    {
      coverage_score: 0.79,
      topics: ['Bookface', 'developer tools'],
      signals: ['founder network'],
      relationship_hints: ['Garry Tan builds products for founders'],
      context_hints: ['public: startup advice and fundraising'],
      identity_hints: ['builder-investor'],
      guardrail_notes: ['Prefer anchored self facts over background summaries'],
    }
  );

  assert.ok(['supported', 'verified'].includes(assessment.status));
  assert.ok(assessment.matched_cues.length > 0);
});

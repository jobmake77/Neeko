import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  __trainTestables,
  WorkbenchService,
  WorkbenchStore,
} from '../dist/testing/train-test-entry.js';
import { withTempDataDir } from './helpers/with-temp-data-dir.mjs';

const serial = { concurrency: false };

const {
  buildCollectionContinuationDecision,
  buildGraphClaimCandidates,
  buildProjectEvidenceHits,
  buildProjectHitClaimCandidates,
  dedupeClaimCandidates,
  compileAnswerPlan,
  buildNetworkPriorityContext,
  detectChatKnowledgeLayer,
  shouldUseClaimPlanFallback,
  validateRemoteSourceDocumentsForPersona,
} = __trainTestables;

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function makeArticleSource(id = 'article-source-1') {
  return {
    id,
    type: 'article',
    mode: 'remote_url',
    platform: 'web',
    handle_or_url: 'https://example.com/about',
    links: ['https://example.com/about'],
    target_aliases: [],
    enabled: true,
    status: 'idle',
  };
}

function makeSocialSource(id = 'social-source-1') {
  return {
    id,
    type: 'social',
    mode: 'handle',
    platform: 'x',
    handle_or_url: '@onevcat',
    links: [],
    target_aliases: [],
    sync_strategy: 'deep_window',
    horizon_mode: 'deep_archive',
    horizon_years: 5,
    batch_limit: 100,
    enabled: true,
    status: 'idle',
  };
}

function makeAcceptedArticleDoc() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    source_type: 'article',
    source_url: 'https://example.com/about',
    source_platform: 'example.com',
    content: "I'm onevcat. I build tools and write about Swift, Apple platforms, and software craftsmanship. This page explains my long-term focus on engineering quality, product taste, and sustainable software systems. I regularly document how I approach open source, maintain macOS and iOS tooling, and think about developer experience over time.",
    author: 'onevcat',
    fetched_at: '2026-04-27T00:00:00.000Z',
    metadata: {
      title: 'About onevcat',
      fetched_via: 'opencli_web_read',
    },
  };
}

function makeWeakArticleDoc() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    source_type: 'article',
    source_url: 'https://example.com/notes/field-journal',
    source_platform: 'example.com',
    content: 'Collected notes about software taste, engineering tradeoffs, and long-term systems design. This page reads like a field journal rather than a clear first-party profile. It talks about engineering decisions, long-term systems thinking, and product tradeoffs, but it does not clearly identify who owns the page or whether it belongs to the target persona.',
    author: '',
    fetched_at: '2026-04-27T00:00:00.000Z',
    metadata: {
      title: 'field journal',
      fetched_via: 'opencli_web_read',
    },
  };
}

function makeRejectedArticleDoc() {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    source_type: 'article',
    source_url: 'https://example.com/about',
    source_platform: 'example.com',
    content: "Hey! I'm Anthony Fu, a fanatical open sourcerer and design engineer. This page is clearly about Anthony Fu, his open source work, his design engineering practice, and his own projects. It is not a page authored by onevcat and should be rejected by the identity and ownership checks.",
    author: 'Anthony Fu',
    fetched_at: '2026-04-27T00:00:00.000Z',
    metadata: {
      title: 'Anthony Fu',
      fetched_via: 'opencli_web_read',
    },
  };
}

test('source preview keeps unified accepted and quarantined summaries for remote article previews', serial, async () => {
  const acceptedService = new WorkbenchService();
  acceptedService.fetchPreviewDocumentsForTarget = async () => [makeAcceptedArticleDoc()];

  const accepted = await acceptedService.previewPersonaSource({
    persona_name: 'onevcat',
    source: makeArticleSource('accepted-preview'),
  });

  assert.equal(accepted.status, 'accepted');
  assert.match(accepted.summary, /培养来源|入池/u);
  assert.equal(accepted.target_results[0].status, 'accepted');
  assert.equal(accepted.target_results[0].reason_code, 'article_identity_match');
  assert.match(accepted.target_results[0].relevance_reason, /入池|强相关/u);
  assert.ok(Array.isArray(accepted.target_results[0].related_entities));

  const quarantinedService = new WorkbenchService();
  quarantinedService.fetchPreviewDocumentsForTarget = async () => [makeWeakArticleDoc()];

  const quarantined = await quarantinedService.previewPersonaSource({
    persona_name: 'onevcat',
    source: makeArticleSource('quarantined-preview'),
  });

  assert.equal(quarantined.status, 'quarantined');
  assert.equal(quarantined.summary, '当前来源抓到了内容，但归属信号不足，建议先人工确认。');
  assert.equal(quarantined.target_results[0].status, 'quarantined');
  assert.equal(quarantined.target_results[0].reason_code, 'article_identity_weak');
  assert.equal(quarantined.target_results[0].relevance_reason, '抓到了内容，但它更像弱关联页面，建议先人工确认。');
});

test('extraction quality gate keeps accepted rejected and quarantined counts distinct', serial, () => {
  const validation = validateRemoteSourceDocumentsForPersona(
    'onevcat',
    makeArticleSource('quality-gate-source'),
    [
      makeAcceptedArticleDoc(),
      makeRejectedArticleDoc(),
      makeWeakArticleDoc(),
    ],
  );

  assert.equal(validation.accepted.length, 1);
  assert.equal(validation.rejected.length, 1);
  assert.equal(validation.quarantined.length, 1);
  assert.deepEqual(validation.summary, {
    accepted_count: 1,
    rejected_count: 1,
    quarantined_count: 1,
    latest_summary: '网页内容没有给出足够的目标归属信号，已隔离等待人工确认。',
  });
});

test('chat knowledge routing keeps project relation background hybrid and self lanes stable', serial, () => {
  assert.equal(detectChatKnowledgeLayer('你做过哪些开源项目？'), 'project');
  assert.equal(detectChatKnowledgeLayer('再回答一次：请严格分成直接做过、参与过、只是提到过三类。'), 'project');
  assert.equal(detectChatKnowledgeLayer('你和谁合作过？'), 'relation');
  assert.equal(detectChatKnowledgeLayer('你怎么看 AI infra 这条赛道？'), 'background');
  assert.equal(detectChatKnowledgeLayer('为什么你会从工程转向写作，再慢慢形成自己的长期主义判断？'), 'hybrid');
  assert.equal(detectChatKnowledgeLayer('你最近在想什么？'), 'self');

  const backgroundContext = buildNetworkPriorityContext(
    'background',
    {
      entity_count: 3,
      relation_count: 2,
      context_pack_count: 1,
      pending_candidate_count: 0,
      dominant_domains: ['swift', 'product'],
      arc_count: 1,
    },
    {
      topics: ['Swift tooling'],
      signals: ['engineering taste'],
      relationship_hints: [],
      context_hints: ['public: Apple platform tooling and product tradeoffs'],
      identity_hints: ['builder-writer'],
      provenance_guardrails: ['Do not collapse background context into fabricated personal experience'],
    },
    '你怎么看 AI infra 这条赛道？',
  );

  assert.match(backgroundContext, /Background\/context hints:/);
  assert.match(backgroundContext, /Do not collapse domain background into fabricated personal experience/);
});

test('claim planning compiles first-person project claims and blocks weak background claims', serial, async () => {
  await withTempDataDir('neeko-workbench-p1-', async (dataDir) => {
    const slug = 'claim-persona';
    const personaDir = join(dataDir, 'personas', slug);
    mkdirSync(personaDir, { recursive: true });
    const graph = {
      schema_version: 1,
      generated_at: '2026-04-27T00:00:00.000Z',
      persona_slug: slug,
      target_name: 'Claim Persona',
      source: {},
      stats: {
        document_count: 1,
        evidence_count: 1,
        entity_count: 3,
        relation_count: 2,
        context_count: 0,
        identity_arc_count: 0,
        high_confidence_entity_count: 2,
        high_confidence_relation_count: 2,
      },
      entities: [
        {
          id: 'entity:self',
          canonical_name: 'Claim Persona',
          entity_type: 'person',
          aliases: [],
          handles: ['@claimpersona'],
          normalized_urls: [],
          confidence: 0.98,
          salience: 0.98,
          evidence_refs: [],
          metadata: {},
        },
        {
          id: 'entity:project',
          canonical_name: 'Pake',
          entity_type: 'project',
          aliases: [],
          handles: [],
          normalized_urls: ['https://github.com/example/pake'],
          confidence: 0.88,
          salience: 0.8,
          evidence_refs: [],
          background_summary: 'A lightweight packaging project.',
          metadata: {},
        },
        {
          id: 'entity:topic',
          canonical_name: 'AI infra',
          entity_type: 'topic',
          aliases: [],
          handles: [],
          normalized_urls: [],
          confidence: 0.76,
          salience: 0.68,
          evidence_refs: [],
          background_summary: 'A background domain topic.',
          metadata: {},
        },
      ],
      relations: [
        {
          id: 'relation:1',
          source_entity_id: 'entity:self',
          target_entity_id: 'entity:project',
          relation_type: 'builds',
          semantic_type: 'built',
          direction: 'directed',
          valence: 'positive',
          confidence: 0.9,
          ownership_signals: {
            first_person_count: 1,
            profile_claim_count: 0,
            repeated_support_count: 1,
            multi_source_count: 1,
          },
          context_frame_ids: [],
          evidence_refs: [
            {
              raw_document_id: 'doc:1',
              source_url: 'https://x.com/claim/status/1',
              excerpt: 'I built Pake as a lightweight Rust packaging tool.',
              confidence: 0.92,
            },
          ],
          summary: 'Builds Pake',
        },
        {
          id: 'relation:2',
          source_entity_id: 'entity:self',
          target_entity_id: 'entity:topic',
          relation_type: 'teaches',
          semantic_type: 'speaks_about',
          direction: 'directed',
          valence: 'neutral',
          confidence: 0.7,
          ownership_signals: {
            first_person_count: 0,
            profile_claim_count: 0,
            repeated_support_count: 0,
            multi_source_count: 1,
          },
          context_frame_ids: [],
          evidence_refs: [
            {
              raw_document_id: 'doc:2',
              source_url: 'https://x.com/claim/status/2',
              excerpt: 'I often write about AI infra and model tooling.',
              confidence: 0.7,
            },
          ],
          summary: 'Shares about AI infra',
        },
      ],
      context_frames: [],
      identity_arcs: [],
    };
    const trainingSeed = {
      schema_version: 3,
      generated_at: '2026-04-27T00:00:00.000Z',
      persona_slug: slug,
      target_name: 'Claim Persona',
      summary: 'Builds Pake | Shares about AI infra',
      stats: {
        entity_count: 3,
        relation_count: 2,
        context_count: 0,
        identity_arc_count: 0,
        provenance_coverage_score: 0.8,
        verified_relation_count: 2,
        guarded_claim_count: 2,
      },
      dominant_domains: ['developer tools'],
      topics: ['Pake', 'AI infra'],
      signals: ['builder'],
      relationship_hints: ['Builds Pake'],
      context_hints: ['public: tool building'],
      identity_hints: [],
      entity_cards: [],
      relation_summaries: [],
      high_confidence_claims: [
        { claim: 'Builds Pake', ownership: 'self_owned', confidence: 0.9 },
      ],
      provenance_guardrails: ['Do not collapse background context into fabricated personal experience'],
    };
    const provenance = {
      schema_version: 1,
      generated_at: '2026-04-27T00:00:00.000Z',
      persona_slug: slug,
      target_name: 'Claim Persona',
      coverage_score: 0.8,
      verified_entity_count: 2,
      verified_relation_count: 2,
      low_confidence_entity_count: 0,
      low_confidence_relation_count: 0,
      guardrail_notes: [],
    };
    saveJson(join(personaDir, 'persona-web-entities.json'), graph.entities);
    saveJson(join(personaDir, 'persona-web-relations.json'), graph.relations);
    saveJson(join(personaDir, 'persona-web-contexts.json'), []);
    saveJson(join(personaDir, 'persona-web-identity-arcs.json'), []);
    saveJson(join(personaDir, 'persona-web-graph.json'), graph);
    saveJson(join(personaDir, 'training-seed-v3.json'), trainingSeed);
    saveJson(join(personaDir, 'persona-web-provenance-report.json'), provenance);

    const claims = buildGraphClaimCandidates(slug, '你做过哪些项目？你怎么看 AI infra？', {
      knowledge_layer: 'hybrid',
      claim_intent: 'hybrid',
      required_entity_types: ['project', 'topic'],
      ownership_sensitive: true,
      use_memory: true,
      use_network: true,
      use_project_facts: true,
      use_relation_fallback: false,
      use_community_summary: true,
      use_attachments: false,
      grounding_required: true,
    });
    const plan = compileAnswerPlan(claims, 'Open-source builder context');

    assert.ok(claims.some((item) => item.object_label === 'Pake' && item.first_person_allowed));
    assert.ok(claims.some((item) => item.object_label === 'AI infra' && item.ownership === 'self_mentioned'));
    assert.ok(plan.owned_self_claims.some((item) => item.object_label === 'Pake'));
    assert.ok(plan.mentioned_only_claims.some((item) => item.object_label === 'AI infra'));
    assert.ok(plan.primary_claims.some((item) => item.object_label === 'Pake'));
    assert.equal(plan.recommended_voice, 'mixed');
  });
});

test('project claim fallback triggers when draft answer mixes owned and mentioned claims without ownership distinction', serial, () => {
  const plan = compileAnswerPlan([
    {
      id: 'claim-owned',
      subject_entity_id: 'persona:self',
      predicate: 'built',
      object_entity_id: 'entity:pake',
      object_label: 'Pake',
      claim_type: 'project',
      source_layer: 'graph',
      confidence: 0.91,
      ownership: 'self_owned',
      first_person_allowed: true,
      provenance_scope: 'public',
      stable_key: 'project:built:pake',
      support_score: 0.88,
      ownership_score: 0.94,
      support_source_count: 2,
      evidence_refs: ['x-1'],
      support_summary: 'Built Pake as a desktop packaging tool.',
    },
    {
      id: 'claim-mentioned',
      subject_entity_id: 'persona:self',
      predicate: 'speaks_about',
      object_entity_id: 'entity:chat2db',
      object_label: 'Chat2DB',
      claim_type: 'project',
      source_layer: 'community_summary',
      confidence: 0.44,
      ownership: 'self_mentioned',
      first_person_allowed: false,
      provenance_scope: 'public',
      stable_key: 'project:mentioned:chat2db',
      support_score: 0.34,
      ownership_score: 0.24,
      support_source_count: 1,
      evidence_refs: ['x-2'],
      support_summary: 'Mentioned Chat2DB while discussing SQL tools.',
    },
  ]);

  assert.equal(
    shouldUseClaimPlanFallback('你做过哪些开源项目？', '我做过 Pake、Chat2DB 这些项目。', plan),
    true,
  );
  assert.equal(
    shouldUseClaimPlanFallback('你做过哪些开源项目？', '直接做过的是 Pake；公开提到过的是 Chat2DB。', plan),
    false,
  );
});

test('project evidence hits classify non-owner snippets as mentioned-only instead of self-owned', serial, () => {
  const claims = buildProjectHitClaimCandidates([
    {
      label: 'Chat2DB',
      snippet: '#工程师工具 在 Github 上面看到一个智能的通用数据库 SQL 客户端和报表工具「Chat2DB」，之前我们在内部也有一些类似的实践，用于解决非专业同学写 SQL 跑数据的问题，这个思路挺好的，有兴趣可以玩玩看。',
      sourceType: 'twitter',
      sourceUrl: 'https://x.com/HiTw93/status/1676953545499877376',
      publishedAt: '2023-07-06T13:57:36.000Z',
      score: 8.7,
    },
    {
      label: 'Pake',
      snippet: '业余时间在开源妙言的主线上，起了两个支线任务，一个是 Pake，一个是潮流周刊。',
      sourceType: 'twitter',
      sourceUrl: 'https://x.com/HiTw93/status/1584047699623485440',
      publishedAt: '2022-10-23T05:02:56.000Z',
      score: 8.7,
    },
  ]);

  const chat2db = claims.find((item) => item.object_label === 'Chat2DB');
  const pake = claims.find((item) => item.object_label === 'Pake');
  assert.equal(chat2db?.ownership, 'self_mentioned');
  assert.equal(chat2db?.first_person_allowed, false);
  assert.equal(pake?.ownership, 'self_owned');
  assert.equal(pake?.first_person_allowed, true);
});

test('strict ownership split queries keep mentioned project evidence available for the third bucket', serial, () => {
  const hits = buildProjectEvidenceHits(
    '你做过哪些开源项目？请严格分成直接做过、参与过、只是提到过三类，不要把提到过的项目算成我做过。',
    [
      {
        id: 'doc-1',
        type: 'text',
        source_type: 'twitter',
        source_url: 'https://x.com/HiTw93/status/1676953545499877376',
        content: '#工程师工具 在 Github 上面看到一个智能的通用数据库 SQL 客户端和报表工具「Chat2DB」，之前我们在内部也有一些类似的实践，用于解决非专业同学写 SQL 跑数据的问题，这个思路挺好的，有兴趣可以玩玩看。',
        source_metadata: {},
        raw_content: null,
        created_at: '2023-07-06T13:57:36.000Z',
        published_at: '2023-07-06T13:57:36.000Z',
      },
      {
        id: 'doc-2',
        type: 'text',
        source_type: 'twitter',
        source_url: 'https://x.com/HiTw93/status/1584047699623485440',
        content: '业余时间在开源妙言的主线上，起了两个支线任务，一个是 Pake，一个是潮流周刊。',
        source_metadata: {},
        raw_content: null,
        created_at: '2022-10-23T05:02:56.000Z',
        published_at: '2022-10-23T05:02:56.000Z',
      },
    ],
  );

  assert.ok(hits.some((item) => item.label === 'Chat2DB'));
  assert.ok(hits.some((item) => item.label === 'Pake'));
  assert.equal(hits.filter((item) => item.label === 'Pake').length, 1);
});

test('mentioned-only claims prefer query affinity and recency when ordering the third bucket', serial, () => {
  const plan = compileAnswerPlan([
    {
      id: 'mentioned-chat2db',
      subject_entity_id: 'persona:self',
      predicate: 'project_evidence',
      object_label: 'Chat2DB',
      claim_type: 'project',
      source_layer: 'project_hits',
      confidence: 0.42,
      ownership: 'self_mentioned',
      first_person_allowed: false,
      provenance_scope: 'public',
      stable_key: 'project:mentioned:chat2db',
      semantic_type: 'project_evidence',
      support_score: 0.31,
      ownership_score: 0.22,
      support_source_count: 1,
      evidence_refs: ['x-chat2db'],
      support_summary: '看到一个智能数据库客户端 Chat2DB，觉得思路不错。',
      last_seen_published_at: '2023-07-06T13:57:36.000Z',
    },
    {
      id: 'mentioned-oss-insight',
      subject_entity_id: 'persona:self',
      predicate: 'project_evidence',
      object_label: 'OSS Insight',
      claim_type: 'project',
      source_layer: 'project_hits',
      confidence: 0.8,
      ownership: 'self_mentioned',
      first_person_allowed: false,
      provenance_scope: 'public',
      stable_key: 'project:mentioned:oss-insight',
      semantic_type: 'project_evidence',
      support_score: 0.7,
      ownership_score: 0.26,
      support_source_count: 1,
      evidence_refs: ['x-oss-insight'],
      support_summary: '看到一个很不错的 GitHub 洞察工具 OSS Insight。',
      last_seen_published_at: '2022-03-01T00:00:00.000Z',
    },
  ], undefined, '你做过哪些开源项目？请严格分成直接做过、参与过、只是提到过三类，不要把提到过的项目算成我做过。');

  assert.equal(plan.mentioned_only_claims[0]?.object_label, 'Chat2DB');
});

test('project evidence hit selection prefers clean labels over malformed fragments when scores are close', serial, () => {
  const hits = buildProjectEvidenceHits(
    '你做过哪些开源项目？请严格分成直接做过、参与过、只是提到过三类，不要把提到过的项目算成我做过。',
    [
      {
        id: 'doc-clean',
        type: 'text',
        source_type: 'twitter',
        source_url: 'https://x.com/HiTw93/status/chat2db',
        content: '#工程师工具 在 Github 上面看到一个智能的通用数据库 SQL 客户端和报表工具「Chat2DB」，这个思路挺好的，有兴趣可以玩玩看。',
        source_metadata: {},
        raw_content: null,
        created_at: '2023-07-06T13:57:36.000Z',
        published_at: '2023-07-06T13:57:36.000Z',
      },
      {
        id: 'doc-noisy',
        type: 'text',
        source_type: 'twitter',
        source_url: 'https://x.com/HiTw93/status/noisy',
        content: '#工程师工具 看到一个很牛逼的 Github 洞察工具，提供了实时查看和分析 GitHub 趋势的能力。',
        source_metadata: {},
        raw_content: null,
        created_at: '2023-07-07T13:57:36.000Z',
        published_at: '2023-07-07T13:57:36.000Z',
      },
    ],
  );

  assert.equal(hits[0]?.label, 'Chat2DB');
});

test('grounded claims suppress persona meta deflection in the final saved assistant message', serial, async () => {
  await withTempDataDir('neeko-workbench-p1-', async (dataDir) => {
    const slug = 'grounded-claims-persona';
    const now = '2026-04-27T14:00:00.000Z';
    const personaDir = join(dataDir, 'personas', slug);
    mkdirSync(personaDir, { recursive: true });
    saveJson(join(personaDir, 'persona-web-graph.json'), {
      schema_version: 1,
      generated_at: now,
      persona_slug: slug,
      target_name: 'Grounded Claims Persona',
      entities: [
        {
          id: 'entity:self',
          canonical_name: 'Grounded Claims Persona',
          entity_type: 'person',
        },
        {
          id: 'entity:project',
          canonical_name: 'Pake',
          entity_type: 'project',
          background_summary: 'A packaging tool for turning web apps into desktop apps.',
        },
      ],
      relations: [
        {
          id: 'relation:project-1',
          source_entity_id: 'entity:self',
          target_entity_id: 'entity:project',
          relation_type: 'builds',
          semantic_type: 'built',
          confidence: 0.94,
          ownership_signals: {
            first_person_count: 2,
            multi_source_count: 2,
          },
          evidence_refs: [
            {
              raw_document_id: 'doc:project-1',
              source_url: 'https://x.com/example/status/1',
              excerpt: 'I built Pake as a desktop packaging tool.',
              speaker_role: 'self',
            },
          ],
          summary: 'Built Pake as a desktop packaging tool.',
        },
      ],
    });
    saveJson(join(personaDir, 'persona-community-summary.json'), {
      summary: 'Open-source builder context.',
      communities: ['Desktop app tooling'],
    });
    saveJson(join(personaDir, 'persona-evidence-map.json'), {
      entities: [
        { canonical_name: 'Pake', summary: 'Pake -> desktop packaging tool' },
      ],
      relations: [],
      context_frames: [],
      identity_arcs: [],
    });

    const store = new WorkbenchStore(join(dataDir, 'workbench'));
    const conversationId = '77777777-7777-4777-8777-777777777777';
    store.saveConversation({
      id: conversationId,
      persona_slug: slug,
      title: 'New Thread',
      created_at: now,
      updated_at: now,
      status: 'active',
      message_count: 0,
      last_message_preview: '',
    });

    const service = new WorkbenchService(store, process.execPath, '/Users/a77/Desktop/Neeko');
    service.loadPersonaAssets = () => ({
      persona: {
        slug,
        name: 'Grounded Claims Persona',
        status: 'available',
        doc_count: 12,
        memory_node_count: 4,
        training_rounds: 1,
        updated_at: now,
      },
      soul: {
        language_style: { frequent_phrases: [] },
        values: { core_beliefs: [] },
        knowledge_domains: { expert: [] },
        coverage_score: 0,
      },
    });
    service.generateReply = async () => ({
      text: '作为一个虚拟人物，我没有真实做过什么项目。',
      triggeredSkills: [],
      normalizedQuery: '你做过哪些项目？',
      retrievedMemories: [],
      personaDimensions: ['knowledge_domains'],
      orchestration: {
        mode: 'answer',
        intent: 'factual',
        persona_stability: 'balanced',
        answer_style: 'normal',
        disclosure_protected: false,
      },
    });

    const bundle = await service.sendMessage(conversationId, '你做过哪些项目？');
    const assistant = bundle.messages.at(-1);

    assert.equal(assistant.role, 'assistant');
    assert.doesNotMatch(assistant.content, /虚拟人物|模拟/u);
    assert.match(assistant.content, /Pake/);
    assert.equal(assistant.network_answer_pack?.grounding_status, 'fallback');
    assert.ok(assistant.network_answer_pack?.answer_plan?.primary_claims.some((item) => item.object_label === 'Pake'));
  });
});

test('cultivation detail keeps unhealthy source counts without letting one cooldown source erase healthy peers', serial, async () => {
  await withTempDataDir('neeko-workbench-p1-', async (dataDir) => {
    const slug = 'multi-source-health-persona';
    const now = '2026-04-27T15:00:00.000Z';
    const socialSource = {
      ...makeSocialSource('social-cooldown-source'),
      health: {
        status: 'cooldown',
        consecutive_failures: 2,
        failure_class: 'network_unreachable',
        cooldown_minutes: 30,
        last_checked_at: now,
        summary: 'Temporary network cooldown.',
      },
    };
    const articleSource = {
      ...makeArticleSource('article-healthy-source'),
      health: {
        status: 'healthy',
        consecutive_failures: 0,
        failure_class: 'none',
        last_checked_at: now,
        summary: 'Source is healthy.',
      },
    };
    const store = new WorkbenchStore(join(dataDir, 'workbench'));

    store.savePersonaConfig({
      persona_slug: slug,
      name: 'Multi Source Health Persona',
      sources: [socialSource, articleSource],
      update_policy: {
        auto_check_remote: true,
        check_interval_minutes: 60,
        strategy: 'incremental',
        current_operation: 'incremental_sync',
        current_source_label: '@onevcat',
      },
      updated_at: now,
    });

    const handle = 'onevcat';
    saveJson(join(dataDir, 'source-sync', handle, `${handle}-${socialSource.id}.json.state.json`), {
      handle,
      count: 24,
      updated_at: now,
      last_heartbeat_at: now,
      current_window: {
        source_id: socialSource.id,
        source_label: '@onevcat',
        status: 'cooldown',
        new_count: 0,
        updated_at: now,
      },
    });

    const service = new WorkbenchService(store, process.execPath, '/Users/a77/Desktop/Neeko');
    const detail = service.getCultivationDetail(slug);

    assert.equal(detail.source_health_summary.unhealthy_sources, 1);
    assert.equal(detail.source_health_summary.cooling_down_sources, 1);
    assert.equal(detail.source_health_summary.blocked_sources, 0);
    assert.equal(detail.source_items.length, 2);
    assert.equal(detail.source_items.some((item) => item.source_id === articleSource.id && item.health?.status === 'healthy'), true);
  });
});

test('claim aggregation merges graph, project hits, and community context under one stable claim key', serial, () => {
  const claims = dedupeClaimCandidates([
    {
      id: 'graph-1',
      subject_entity_id: 'persona:self',
      predicate: 'built',
      object_entity_id: 'entity:pake',
      object_label: 'Pake',
      claim_type: 'project',
      source_layer: 'graph',
      confidence: 0.92,
      ownership: 'self_owned',
      first_person_allowed: true,
      provenance_scope: 'mixed',
      stable_key: 'project:built:entity:pake',
      semantic_type: 'built',
      support_score: 0.84,
      ownership_score: 0.94,
      support_source_count: 1,
      evidence_refs: ['x-status-1'],
      support_summary: 'Built Pake as a desktop packaging tool.',
    },
    {
      id: 'project-hit-1',
      subject_entity_id: 'persona:self',
      predicate: 'project_evidence',
      object_entity_id: 'entity:pake',
      object_label: 'Pake',
      claim_type: 'project',
      source_layer: 'project_hits',
      confidence: 0.74,
      ownership: 'self_owned',
      first_person_allowed: true,
      provenance_scope: 'public',
      stable_key: 'project:built:entity:pake',
      semantic_type: 'project_evidence',
      support_score: 0.66,
      ownership_score: 0.7,
      support_source_count: 1,
      evidence_refs: ['repo-readme'],
      support_summary: 'Pake packages web apps into desktop apps.',
    },
    {
      id: 'community-1',
      subject_entity_id: 'persona:self',
      predicate: 'community_context',
      object_entity_id: 'entity:pake',
      object_label: 'Pake',
      claim_type: 'project',
      source_layer: 'community_summary',
      confidence: 0.4,
      ownership: 'third_party_background',
      first_person_allowed: false,
      provenance_scope: 'public',
      stable_key: 'project:built:entity:pake',
      semantic_type: 'community_context',
      support_score: 0.35,
      ownership_score: 0.12,
      support_source_count: 1,
      evidence_refs: ['community-summary'],
      support_summary: 'Open-source builder context around Pake.',
    },
  ]);

  assert.equal(claims.length, 1);
  assert.equal(claims[0].object_label, 'Pake');
  assert.equal(claims[0].ownership, 'self_owned');
  assert.equal(claims[0].first_person_allowed, true);
  assert.equal(claims[0].support_source_count >= 3, true);
  assert.equal(claims[0].evidence_refs.length, 3);
  assert.match(claims[0].support_summary ?? '', /Built Pake/);
  assert.match(claims[0].support_summary ?? '', /desktop apps/);
});

test('cultivation continuation exposes a stable next_action contract from source-level scheduling state', serial, () => {
  const waitForCooldown = buildCollectionContinuationDecision({
    cleanDocumentCount: 120,
    trainingThreshold: 500,
    evaluationPassed: false,
    retrainReady: false,
    historyExhausted: false,
    providerExhausted: false,
    collectionCycle: 1,
    hasActiveRun: false,
    sourceHealthSummary: {
      enabledRemoteSources: 2,
      healthySources: 0,
      degradedSources: 0,
      cooldownSources: 2,
      blockedSources: 0,
    },
  });
  assert.equal(waitForCooldown.shouldContinue, false);
  assert.equal(waitForCooldown.nextAction, 'wait_for_cooldown');

  const switchSource = buildCollectionContinuationDecision({
    cleanDocumentCount: 180,
    trainingThreshold: 500,
    evaluationPassed: false,
    retrainReady: false,
    historyExhausted: false,
    providerExhausted: false,
    collectionCycle: 1,
    hasActiveRun: false,
    sourceHealthSummary: {
      enabledRemoteSources: 3,
      healthySources: 1,
      degradedSources: 1,
      cooldownSources: 1,
      blockedSources: 0,
    },
  });
  assert.equal(switchSource.shouldContinue, true);
  assert.equal(switchSource.nextAction, 'switch_source');

  const softCloseCandidate = buildCollectionContinuationDecision({
    cleanDocumentCount: 780,
    trainingThreshold: 500,
    evaluationPassed: false,
    retrainReady: false,
    historyExhausted: true,
    providerExhausted: false,
    collectionCycle: 3,
    hasActiveRun: false,
    sourceHealthSummary: {
      enabledRemoteSources: 1,
      healthySources: 0,
      degradedSources: 0,
      cooldownSources: 0,
      blockedSources: 1,
    },
  });
  assert.equal(softCloseCandidate.shouldContinue, false);
  assert.equal(softCloseCandidate.nextAction, 'soft_close_candidate');
});

test('discovered podcast candidates require stronger identity matches for handle-like personas', serial, async () => {
  const service = new WorkbenchService();
  service.fetchDiscoveryPageMeta = async () => ({
    title: 'Whitto and Herbie - hit93.1 Riverina',
    description: 'A radio podcast episode page unrelated to HiTw93.',
    siteName: 'Pod Paradise',
  });

  const candidate = await service.buildDiscoveredCandidate(
    'hitw93',
    'https://www.podparadise.com/Podcast/784254135',
    'Listen To Whitto and Herbie - hit93.1 Riverina Podcast Online',
    'HiTw93 guest podcast',
    'HiTw93',
    ['@HiTw93'],
  );

  assert.equal(candidate, null);
});

test('network answer grounding persists citation items into the saved assistant message', serial, async () => {
  const store = new WorkbenchStore(mkdtempSync(join(tmpdir(), 'neeko-grounding-store-')));
  const service = new WorkbenchService(store);
  const now = '2026-04-27T10:00:00.000Z';
  const conversationId = '44444444-4444-4444-8444-444444444444';

  store.saveConversation({
    id: conversationId,
    persona_slug: 'grounded-persona',
    title: 'New Thread',
    created_at: now,
    updated_at: now,
    status: 'active',
    message_count: 0,
    last_message_preview: '',
  });

  service.loadPersonaAssets = () => ({
    persona: {
      slug: 'grounded-persona',
      name: 'Grounded Persona',
      status: 'available',
      doc_count: 0,
      memory_node_count: 0,
      training_rounds: 0,
      updated_at: now,
    },
    soul: {
      language_style: { frequent_phrases: [] },
      values: { core_beliefs: [] },
      knowledge_domains: { expert: [] },
      coverage_score: 0,
    },
  });
  service.generateReply = async () => ({
    text: '我和这些团队合作过，判断主要基于公开关系线索。',
    triggeredSkills: [],
    normalizedQuery: '你和谁合作过？',
    retrievedMemories: [
      {
        id: 'memory-rel-1',
        summary: 'Worked with founders through public startup communities.',
        category: 'fact',
        soul_dimension: 'relationships',
        confidence: 0.82,
      },
      {
        id: 'memory-rel-2',
        summary: 'Writes frequently about developer tools and founder workflows.',
        category: 'context',
        soul_dimension: 'knowledge_domains',
        confidence: 0.76,
      },
    ],
    personaDimensions: ['relationships'],
    orchestration: {
      mode: 'answer',
      intent: 'relationship',
      persona_stability: 'balanced',
      answer_style: 'normal',
      disclosure_protected: false,
    },
  });

  try {
    const bundle = await service.sendMessage(conversationId, '你和谁合作过？');
    const assistant = bundle.messages.at(-1);

    assert.equal(assistant.role, 'assistant');
    assert.deepEqual(assistant.retrieved_memory_ids, ['memory-rel-1', 'memory-rel-2']);
    assert.deepEqual(
      assistant.citation_items.map((item) => ({ id: item.id, summary: item.summary })),
      [
        { id: 'memory-rel-1', summary: 'Worked with founders through public startup communities.' },
        { id: 'memory-rel-2', summary: 'Writes frequently about developer tools and founder workflows.' },
      ],
    );
  } finally {
    rmSync(store.baseDir, { recursive: true, force: true });
  }
});

test('network answer pack normalizes non-ISO published_at before persisting assistant message', serial, async () => {
  const store = new WorkbenchStore(mkdtempSync(join(tmpdir(), 'neeko-network-pack-store-')));
  const service = new WorkbenchService(store);
  const now = '2026-04-27T10:30:00.000Z';
  const conversationId = '55555555-5555-4555-8555-555555555556';

  store.saveConversation({
    id: conversationId,
    persona_slug: 'network-pack-persona',
    title: 'New Thread',
    created_at: now,
    updated_at: now,
    status: 'active',
    message_count: 0,
    last_message_preview: '',
  });

  service.loadPersonaAssets = () => ({
    persona: {
      slug: 'network-pack-persona',
      name: 'Network Pack Persona',
      status: 'available',
      doc_count: 0,
      memory_node_count: 0,
      training_rounds: 0,
      updated_at: now,
    },
    soul: {
      language_style: { frequent_phrases: [] },
      values: { core_beliefs: [] },
      knowledge_domains: { expert: [] },
      coverage_score: 0,
    },
  });
  service.generateReply = async () => ({
    text: '我和这些项目的关系最深，主要是我自己做过并长期维护的那几条线。',
    triggeredSkills: [],
    normalizedQuery: '你和哪些项目或协作对象关系最深？',
    retrievedMemories: [],
    personaDimensions: ['knowledge_domains'],
    orchestration: {
      mode: 'answer',
      intent: 'factual',
      persona_stability: 'balanced',
      answer_style: 'normal',
      disclosure_protected: false,
    },
    networkAnswerPack: {
      retrieval_plan: {
        knowledge_layer: 'project',
        should_expand_network: true,
        grounding_required: true,
        rationale: 'Project facts should override generic memories for this turn.',
      },
      network_summary: {
        entity_count: 4,
        relation_count: 3,
        context_pack_count: 2,
        pending_candidate_count: 0,
        dominant_domains: ['oss'],
        arc_count: 1,
      },
      project_hits: [
        {
          label: 'Pake',
          snippet: 'I built Pake as a lightweight Rust desktop packaging tool.',
          source_type: 'twitter',
          source_url: 'https://x.com/hitw93/status/1',
          published_at: 'Fri Apr 26 2026 12:00:00 GMT+0800',
          score: 9.1,
        },
      ],
      relation_fallbacks: [],
      evidence_map_hits: ['Pake -> builder'],
      community_summary: 'Open-source builder circle.',
      grounding_status: 'grounded',
      grounding_summary: 'Grounded by project evidence.',
      missing_signals: [],
    },
  });

  try {
    const bundle = await service.sendMessage(conversationId, '你和哪些项目或协作对象关系最深？');
    const assistant = bundle.messages.at(-1);

    assert.equal(assistant.role, 'assistant');
    assert.equal(assistant.network_answer_pack.project_hits.length, 1);
    assert.match(
      assistant.network_answer_pack.project_hits[0].published_at,
      /^\d{4}-\d{2}-\d{2}T/,
    );
  } finally {
    rmSync(store.baseDir, { recursive: true, force: true });
  }
});

test('source health detail keeps heartbeat and retry-pending status visible without collapsing into ready', serial, async () => {
  await withTempDataDir('neeko-workbench-p1-', async (dataDir) => {
    const slug = 'health-persona';
    const now = '2026-04-27T12:00:00.000Z';
    const source = makeSocialSource('health-source');
    const store = new WorkbenchStore(join(dataDir, 'workbench'));

    store.savePersonaConfig({
      persona_slug: slug,
      name: 'Health Persona',
      sources: [source],
      update_policy: {
        auto_check_remote: true,
        check_interval_minutes: 60,
        strategy: 'incremental',
        current_operation: 'incremental_sync',
        current_source_label: '@onevcat',
        collection_cycle: 2,
        collection_stop_reason: 'history_retry_pending',
        history_exhausted: true,
        provider_exhausted: false,
        latest_result: '当前素材不足，等待下一轮继续拉取',
      },
      updated_at: now,
    });

    const handle = 'onevcat';
    saveJson(join(dataDir, 'source-sync', handle, `${handle}-${source.id}.json.state.json`), {
      handle,
      count: 24,
      updated_at: now,
      last_heartbeat_at: now,
      history_exhausted: true,
      provider_exhausted: false,
      completed_windows: 3,
      estimated_total_windows: 5,
      current_window: {
        source_id: source.id,
        source_label: '@onevcat',
        status: 'running',
        new_count: 2,
        updated_at: now,
      },
    });

    const service = new WorkbenchService(store, process.execPath, '/Users/a77/Desktop/Neeko');
    const detail = service.getCultivationDetail(slug);

    assert.equal(detail.source_summary.phase, 'incremental_syncing');
    assert.equal(detail.source_summary.collection_stop_reason, 'history_retry_pending');
    assert.equal(detail.source_summary.history_exhausted, true);
    assert.equal(detail.source_summary.last_heartbeat_at, now);
    assert.equal(detail.source_summary.active_window?.status, 'running');
    assert.equal(detail.source_items[0].active_window?.status, 'running');
    assert.equal(detail.source_items[0].last_heartbeat_at, now);
  });
});

test('collection continuation and checkpoint recovery stay conservative around cooldown-like retry states', serial, async () => {
  const decision = buildCollectionContinuationDecision({
    cleanDocumentCount: 620,
    trainingThreshold: 500,
    evaluationPassed: false,
    retrainReady: true,
    historyExhausted: false,
    providerExhausted: false,
    collectionCycle: 2,
    hasActiveRun: false,
  });
  assert.equal(decision.shouldContinue, false);
  assert.equal(decision.blockedReason, 'retrain_ready');

  await withTempDataDir('neeko-workbench-p1-', async (dataDir) => {
    const slug = 'checkpoint-persona';
    const personaDir = join(dataDir, 'personas', slug);
    mkdirSync(personaDir, { recursive: true });
    saveJson(join(personaDir, 'checkpoint_index.json'), {
      schema_version: 1,
      checkpoints: [
        {
          track: 'persona_extract',
          round: 3,
          created_at: '2026-04-27T08:00:00.000Z',
          path: join(personaDir, 'checkpoints', 'persona_extract-round-3.json'),
        },
      ],
    });
    saveJson(join(personaDir, 'training-report.json'), {
      total_rounds: 1,
      generated_at: '2026-04-27T09:00:00.000Z',
    });

    const store = new WorkbenchStore(join(dataDir, 'workbench'));
    const service = new WorkbenchService(store, process.execPath, '/Users/a77/Desktop/Neeko');

    const shouldResume = service.shouldResumeCollectionContinuation({
      cleanDocumentCount: 120,
      threshold: {
        training_threshold: 500,
        training_threshold_met: false,
        training_block_reason: '当前已接入 120 条素材，未达到自动训练门槛（500 条），系统将继续深抓取',
        progress_label: '当前素材 120 / 500',
        summary: '当前已接入 120 条素材，未达到自动训练门槛（500 条），系统将继续深抓取',
      },
      evaluationPassed: false,
      softClosed: false,
      stopReason: 'history_retry_pending',
    });
    assert.equal(shouldResume, true);

    const shouldSoftClose = service.shouldSoftCloseCollection(
      slug,
      {
        evaluationPassed: false,
        threshold: { training_threshold_met: true, training_threshold: 500 },
        retrain: { retrainReady: false },
        historyExhausted: true,
        stopReason: 'search_horizon_reached',
        collectionCycle: 2,
      },
      2,
    );
    assert.equal(shouldSoftClose, true);

    const recovery = service.planAutomaticRecovery({
      runId: '55555555-5555-4555-8555-555555555555',
      type: 'train',
      personaSlug: slug,
      summaryLabel: 'train',
      attemptNumber: 1,
      maxRecoveryAttempts: 2,
      logPath: join(dataDir, 'missing-train.log'),
      args: ['train', slug, '--track', 'work_execute'],
    });

    assert.ok(recovery);
    assert.deepEqual(recovery.extraArgs, ['--track', 'persona_extract', '--from-checkpoint', 'latest']);
    assert.match(recovery.userSummary, /saved progress/i);
  });
});

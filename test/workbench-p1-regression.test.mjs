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
  buildNetworkPriorityContext,
  detectChatKnowledgeLayer,
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
    content: "I'm onevcat. I build tools and write about Swift, Apple platforms, and software craftsmanship.",
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
    content: 'Collected notes about software taste, engineering tradeoffs, and long-term systems design.',
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
    content: "Hey! I'm Anthony Fu, a fanatical open sourcerer and design engineer.",
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
  assert.equal(accepted.summary, '当前来源预览已通过归属检查，可继续作为培养来源。');
  assert.equal(accepted.target_results[0].status, 'accepted');
  assert.equal(accepted.target_results[0].reason_code, 'article_identity_match');

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

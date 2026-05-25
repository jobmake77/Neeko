import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __trainTestables,
  settings,
  WorkbenchService,
  WorkbenchStore,
} from '../dist/testing/train-test-entry.js';

const serial = { concurrency: false };

const runtimeTestables = __trainTestables.personaChatAgentRuntime ?? __trainTestables;

function requireRuntimeTestable(name) {
  const value = runtimeTestables[name];
  assert.ok(
    value,
    `Missing PersonaChatAgent Runtime testable "${name}". Export it from src/testing/train-test-entry.ts once the runtime implementation lands.`,
  );
  return value;
}

function makeConversation(id, personaSlug, now) {
  return {
    id,
    persona_slug: personaSlug,
    title: 'Runtime test thread',
    created_at: now,
    updated_at: now,
    status: 'active',
    message_count: 0,
    last_message_preview: '',
  };
}

function makeMessage(id, conversationId, role, content, now, extras = {}) {
  return {
    id,
    conversation_id: conversationId,
    role,
    content,
    created_at: now,
    retrieved_memory_ids: [],
    persona_dimensions: [],
    citation_items: [],
    writeback_candidate_ids: [],
    attachments: [],
    ...extras,
  };
}

function makeTrace({ conversationId, personaSlug, userMessageId, assistantMessageId, traceId, now }) {
  return {
    id: traceId,
    conversation_id: conversationId,
    persona_slug: personaSlug,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    started_at: now,
    finished_at: now,
    model: {
      provider: 'mock',
      model: 'mock-chat',
    },
    stages: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'context_assembled',
        at: now,
        summary: 'Context assembled for a deterministic runtime test.',
        metadata: {
          history_count: 1,
          attachment_count: 0,
        },
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'llm_called',
        at: now,
        summary: 'Mock model call completed.',
        metadata: {
          provider: 'mock',
          model: 'mock-chat',
        },
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        type: 'reply_finalized',
        at: now,
        summary: 'Assistant reply finalized.',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        type: 'summary_updated',
        at: now,
        summary: 'Session summary updated.',
      },
    ],
    status: 'completed',
  };
}

test('chat agent trace schema and store persist completed traces under conversation agent-traces', serial, () => {
  const ChatAgentTraceSchema = requireRuntimeTestable('ChatAgentTraceSchema');
  const dataDir = mkdtempSync(join(tmpdir(), 'neeko-runtime-trace-store-'));
  const store = new WorkbenchStore(join(dataDir, 'workbench'));
  const now = '2026-05-05T00:00:00.000Z';
  const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userMessageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const assistantMessageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const traceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  try {
    store.saveConversation(makeConversation(conversationId, 'runtime-persona', now));
    const trace = ChatAgentTraceSchema.parse(makeTrace({
      conversationId,
      personaSlug: 'runtime-persona',
      userMessageId,
      assistantMessageId,
      traceId,
      now,
    }));

    assert.equal(typeof store.saveChatAgentTrace, 'function');
    assert.equal(typeof store.getChatAgentTrace, 'function');
    assert.equal(typeof store.listChatAgentTraces, 'function');

    const saved = store.saveChatAgentTrace(trace);
    assert.deepEqual(saved, trace);
    assert.deepEqual(store.getChatAgentTrace(conversationId, traceId), trace);
    assert.deepEqual(store.listChatAgentTraces(conversationId).map((item) => item.id), [traceId]);

    const tracePath = join(
      dataDir,
      'workbench',
      'conversations',
      conversationId,
      'agent-traces',
      `${traceId}.json`,
    );
    assert.equal(existsSync(tracePath), true);
    assert.equal(JSON.parse(readFileSync(tracePath, 'utf-8')).status, 'completed');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('context assembly includes persona history summary attachments model override and safety policy', serial, async () => {
  const ContextAssembler = requireRuntimeTestable('ContextAssembler');
  const dataDir = mkdtempSync(join(tmpdir(), 'neeko-runtime-context-'));
  const store = new WorkbenchStore(join(dataDir, 'workbench'));
  const now = '2026-05-05T01:00:00.000Z';
  const conversationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const historyMessage = makeMessage(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    conversationId,
    'assistant',
    'Earlier answer about maintaining iOS tooling.',
    now,
  );
  const attachment = {
    id: 'runtime-note',
    type: 'text',
    name: 'note.txt',
    path: '/tmp/note.txt',
    mime: 'text/plain',
    processing_status: 'ready',
    processing_summary: 'A short note about Swift packages.',
  };

  try {
    store.saveConversation(makeConversation(conversationId, 'runtime-persona', now));
    store.appendMessage(historyMessage);
    store.saveSessionSummary({
      conversation_id: conversationId,
      summary: 'The user asked about engineering quality.',
      updated_at: now,
      message_count: 1,
      candidate_count: 0,
    });

    const assembler = new ContextAssembler({
      store,
      loadPersonaAssets: () => ({
        persona: {
          slug: 'runtime-persona',
          name: 'Runtime Persona',
          status: 'available',
          doc_count: 3,
          memory_node_count: 2,
          training_rounds: 1,
          updated_at: now,
        },
        soul: {
          language_style: { frequent_phrases: ['Slow is Fast'] },
          values: { core_beliefs: [{ belief: 'Maintainability compounds.' }] },
          knowledge_domains: { expert: ['Swift', 'developer tooling'] },
          coverage_score: 0.72,
        },
      }),
      skillRegistry: {
        selectForTurn: () => [
          {
            skill: {
              id: 'read-context',
              displayName: 'Read context',
              description: 'Adds read-only context.',
              permission: 'read',
              enabled: true,
            },
            confidence: 0.88,
            reason: 'Query asks for known engineering preferences.',
          },
        ],
      },
    });

    const context = await assembler.assemble({
      conversationId,
      userMessage: makeMessage(
        '12345678-1234-4234-8234-123456789abc',
        conversationId,
        'user',
        'How should we structure this runtime?',
        now,
        { attachments: [attachment] },
      ),
      history: [historyMessage],
      attachments: [attachment],
      modelOverride: {
        provider: 'openai',
        model: 'mock-chat',
      },
      now,
    });

    assert.equal(context.conversation.id, conversationId);
    assert.equal(context.personaSlug, 'runtime-persona');
    assert.equal(context.personaName, 'Runtime Persona');
    assert.deepEqual(context.history.map((item) => item.id), [historyMessage.id]);
    assert.equal(context.sessionSummary.summary, 'The user asked about engineering quality.');
    assert.deepEqual(context.processedAttachments, [attachment]);
    assert.equal(context.historyContext.at(-1).content, historyMessage.content);
    assert.equal(context.availableSkills[0].skill.id, 'read-context');
    assert.deepEqual(context.safetyPolicy.writeTargets, [
      'conversation_log',
      'session_summary',
      'memory_candidates',
      'trace',
    ]);
    assert.equal(context.safetyPolicy.forbiddenTargets.includes('formal_soul'), true);
    assert.equal(context.safetyPolicy.forbiddenTargets.includes('training_asset'), true);
    assert.equal(context.safetyPolicy.maxToolSteps <= 2, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('sendMessage keeps conversation bundle shape stable and writes a completed runtime trace', serial, async () => {
  requireRuntimeTestable('ChatAgentTraceSchema');
  const dataDir = mkdtempSync(join(tmpdir(), 'neeko-runtime-send-message-'));
  const store = new WorkbenchStore(join(dataDir, 'workbench'));
  const service = new WorkbenchService(store);
  const now = '2026-05-05T02:00:00.000Z';
  const conversationId = '99999999-9999-4999-8999-999999999999';

  try {
    store.saveConversation(makeConversation(conversationId, 'runtime-persona', now));

    service.loadPersonaAssets = () => ({
      persona: {
        slug: 'runtime-persona',
        name: 'Runtime Persona',
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
      text: 'We can keep the runtime small, deterministic, and traceable.',
      triggeredSkills: [],
      normalizedQuery: 'How should we structure the runtime?',
      retrievedMemories: [],
      personaDimensions: ['knowledge_domains'],
      orchestration: {
        mode: 'answer',
        intent: 'opinion',
        persona_stability: 'balanced',
        answer_style: 'normal',
        disclosure_protected: false,
      },
    });

    const bundle = await service.sendMessage(
      conversationId,
      'How should we structure the runtime?',
      [],
      { provider: 'openai', model: 'mock-chat' },
    );

    assert.deepEqual(Object.keys(bundle).sort(), ['conversation', 'messages', 'session_summary']);
    assert.equal(bundle.messages.length, 2);
    assert.deepEqual(bundle.messages.map((item) => item.role), ['user', 'assistant']);
    assert.equal('trace' in bundle, false);
    assert.equal('agent_trace' in bundle, false);

    assert.equal(typeof store.listChatAgentTraces, 'function');
    const traces = store.listChatAgentTraces(conversationId);
    assert.equal(traces.length, 1);
    assert.equal(traces[0].status, 'completed');
    assert.equal(traces[0].conversation_id, conversationId);
    assert.equal(traces[0].user_message_id, bundle.messages[0].id);
    assert.equal(traces[0].assistant_message_id, bundle.messages[1].id);
    const stageTypes = traces[0].stages.map((stage) => stage.type);
    for (const expected of ['context_assembled', 'llm_called', 'reply_finalized', 'summary_updated']) {
      assert.equal(stageTypes.includes(expected), true);
    }
    assert.equal(
      bundle.messages.every((item) => item.orchestration?.agent_trace_id === traces[0].id || item.orchestration?.agent_trace_id === undefined),
      true,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('trace diagnostic summary redacts message content and exposes stage timeline', serial, () => {
  const toChatAgentTraceDiagnostic = requireRuntimeTestable('toChatAgentTraceDiagnostic');
  const now = '2026-05-05T03:00:00.000Z';
  const secretUserContent = 'Please remember my private deployment password is swordfish.';
  const secretAssistantContent = 'I will not repeat swordfish in diagnostics.';
  const trace = {
    ...makeTrace({
      conversationId: '12121212-1212-4212-8212-121212121212',
      personaSlug: 'runtime-persona',
      userMessageId: '34343434-3434-4434-8434-343434343434',
      assistantMessageId: '56565656-5656-4565-8565-565656565656',
      traceId: '78787878-7878-4787-8787-787878787878',
      now,
    }),
    stages: [
      {
        id: 'abababab-abab-4bab-8bab-abababababab',
        type: 'context_assembled',
        at: now,
        summary: 'Context assembled without raw content.',
        metadata: {
          user_message: secretUserContent,
          assistant_message: secretAssistantContent,
          history: [{ role: 'user', content: secretUserContent }],
          safe_count: 1,
        },
      },
      {
        id: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
        type: 'llm_called',
        at: now,
        summary: 'Mock model call completed.',
        metadata: {
          provider: 'mock',
          model: 'mock-chat',
          prompt: secretUserContent,
        },
      },
    ],
  };

  const diagnostic = toChatAgentTraceDiagnostic(trace, {
    userMessage: makeMessage(trace.user_message_id, trace.conversation_id, 'user', secretUserContent, now),
    assistantMessage: makeMessage(trace.assistant_message_id, trace.conversation_id, 'assistant', secretAssistantContent, now),
  });
  const serialized = JSON.stringify(diagnostic);

  assert.equal(serialized.includes(secretUserContent), false);
  assert.equal(serialized.includes(secretAssistantContent), false);
  assert.equal(serialized.includes('swordfish'), false);
  assert.equal(diagnostic.status, 'completed');
  assert.deepEqual(
    diagnostic.stage_timeline.map((stage) => stage.type),
    ['context_assembled', 'llm_called'],
  );
  assert.deepEqual(
    diagnostic.messages,
    {
      user: {
        id: trace.user_message_id,
        role: 'user',
        content_length: secretUserContent.length,
        content_preview: undefined,
      },
      assistant: {
        id: trace.assistant_message_id,
        role: 'assistant',
        content_length: secretAssistantContent.length,
        content_preview: undefined,
      },
    },
  );
  assert.equal(diagnostic.stage_timeline[0].metadata.safe_count, 1);
  assert.equal('user_message' in diagnostic.stage_timeline[0].metadata, false);
  assert.equal('history' in diagnostic.stage_timeline[0].metadata, false);
  assert.equal('prompt' in diagnostic.stage_timeline[1].metadata, false);
});

test('runtime failure persists failed trace with failed stage and sanitized compressed error', serial, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'neeko-runtime-failed-trace-'));
  const store = new WorkbenchStore(join(dataDir, 'workbench'));
  const service = new WorkbenchService(store);
  const now = '2026-05-05T04:00:00.000Z';
  const conversationId = '89898989-8989-4989-8989-898989898989';
  const sensitiveError = [
    'Mock provider exploded with API key sk-live-secret',
    'Full prompt: user said private password swordfish',
    'Stack trace line '.repeat(80),
  ].join('\n');

  try {
    store.saveConversation(makeConversation(conversationId, 'runtime-persona', now));
    service.loadPersonaAssets = () => ({
      persona: {
        slug: 'runtime-persona',
        name: 'Runtime Persona',
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
    service.generateReply = async () => {
      throw new Error(sensitiveError);
    };

    await assert.rejects(
      () => service.sendMessage(
        conversationId,
        'Please debug this without leaking private password swordfish.',
        [],
        { provider: 'openai', model: 'mock-chat' },
      ),
      /Mock provider exploded/,
    );

    const traces = store.listChatAgentTraces(conversationId);
    assert.equal(traces.length, 1);
    assert.equal(traces[0].status, 'failed');
    assert.equal(traces[0].assistant_message_id, undefined);
    assert.equal(typeof traces[0].finished_at, 'string');
    assert.equal(traces[0].stages.at(-1).type, 'failed');
    assert.equal(traces[0].stages.some((stage) => stage.type === 'llm_called'), true);
    assert.equal(traces[0].error.includes('\n'), false);
    assert.equal(traces[0].error.length <= 240, true);
    assert.equal(traces[0].error.includes('swordfish'), false);
    assert.equal(traces[0].error.includes('sk-live-secret'), false);
    assert.equal(JSON.stringify(traces[0]).includes('private password swordfish'), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('chat agent replay uses trace timeline and summaries without full message content', serial, () => {
  const buildChatAgentTraceReplay = requireRuntimeTestable('buildChatAgentTraceReplay');
  const now = '2026-05-05T05:00:00.000Z';
  const secretUserContent = 'The deployment token is ghp_private_token and should not be replayed.';
  const secretAssistantContent = 'The private token ghp_private_token stays out of replay output.';
  const trace = makeTrace({
    conversationId: '91919191-9191-4919-8919-919191919191',
    personaSlug: 'runtime-persona',
    userMessageId: '92929292-9292-4929-8929-929292929292',
    assistantMessageId: '93939393-9393-4939-8939-939393939393',
    traceId: '94949494-9494-4949-8949-949494949494',
    now,
  });

  const messages = [
    makeMessage(trace.user_message_id, trace.conversation_id, 'user', secretUserContent, now),
    makeMessage(trace.assistant_message_id, trace.conversation_id, 'assistant', secretAssistantContent, now),
  ];
  const replay = buildChatAgentTraceReplay(trace, { messages });
  const serialized = JSON.stringify(replay);

  assert.equal(serialized.includes(secretUserContent), false);
  assert.equal(serialized.includes(secretAssistantContent), false);
  assert.equal(serialized.includes('ghp_private_token'), false);
  assert.equal(replay.trace_id, trace.id);
  assert.equal(replay.status, 'completed');
  assert.deepEqual(
    replay.steps.map((stage) => stage.type),
    ['context_assembled', 'llm_called', 'reply_finalized', 'summary_updated'],
  );
  assert.equal('message_summaries' in replay, false);
  assert.equal(replay.steps.every((step) => typeof step.summary === 'string'), true);
});

test('SkillRegistry maps selected persona skills to read permission regression', serial, () => {
  const SkillRegistry = requireRuntimeTestable('SkillRegistry');
  const originalDataDir = settings.get('neekoDataDir');
  const dataDir = mkdtempSync(join(tmpdir(), 'neeko-runtime-skill-registry-'));
  const personaSlug = 'runtime-skill-persona';
  const now = '2026-05-05T06:00:00.000Z';
  const personaDir = join(dataDir, 'personas', personaSlug);

  try {
    settings.set('neekoDataDir', dataDir);
    mkdirSync(personaDir, { recursive: true });
    writeFileSync(
      join(personaDir, 'skills.json'),
      JSON.stringify({
        schema_version: 2,
        persona_slug: personaSlug,
        version: 1,
        updated_at: now,
        source_trace: [],
        origin_skills: [],
        distilled_skills: [
          {
            id: 'slow-fast-read-context',
            name: 'Slow Fast Runtime Design',
            central_thesis: 'Use slow fast runtime design to keep the chat agent maintainable.',
            why: 'The user asks for runtime design tradeoffs.',
            how_steps: ['Map the stage boundary.', 'Keep writes explicit.'],
            boundaries: ['Do not mutate formal persona assets.'],
            trigger_signals: ['slow fast runtime design', 'maintainable runtime'],
            anti_patterns: [],
            evidence_refs: [],
            confidence: 0.9,
            contradiction_risk: 0,
            method_completeness: 0.9,
            coverage_tags: ['runtime'],
            quality_score: 0.9,
            source_origin_ids: [],
            last_validated_at: null,
          },
        ],
        candidate_skill_pool: [],
        clusters: [],
        expanded_skills: [],
        pending_candidates: [],
      }, null, 2),
      'utf-8',
    );

    const selected = new SkillRegistry().selectForTurn({
      userMessage: 'Can you apply slow fast runtime design here?',
      personaSlug,
      maxSkills: 3,
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].skill.id, 'slow-fast-read-context');
    assert.equal(selected[0].skill.permission, 'read');
    assert.equal(selected[0].skill.enabled, true);
    assert.equal(selected.every((item) => item.skill.permission === 'read'), true);
  } finally {
    settings.set('neekoDataDir', originalDataDir);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('SkillRegistry excludes disabled and high-permission skills from automatic execution selections', serial, () => {
  const selectExecutableSkillSelections = requireRuntimeTestable('selectExecutableSkillSelections');
  const selections = [
    {
      skill: {
        id: 'read-context',
        displayName: 'Read context',
        description: 'Read-only prompt context.',
        permission: 'read',
        enabled: true,
      },
      confidence: 0.9,
    },
    {
      skill: {
        id: 'disabled-read-context',
        displayName: 'Disabled read context',
        description: 'Disabled read-only prompt context.',
        permission: 'read',
        enabled: false,
      },
      confidence: 0.95,
    },
    {
      skill: {
        id: 'write-context',
        displayName: 'Write context',
        description: 'Would write outside prompt context.',
        permission: 'write',
        enabled: true,
      },
      confidence: 0.91,
    },
    {
      skill: {
        id: 'network-context',
        displayName: 'Network context',
        description: 'Would use network access.',
        permission: 'network',
        enabled: true,
      },
      confidence: 0.92,
    },
    {
      skill: {
        id: 'filesystem-context',
        displayName: 'Filesystem context',
        description: 'Would use filesystem access.',
        permission: 'filesystem',
        enabled: true,
      },
      confidence: 0.93,
    },
    {
      skill: {
        id: 'dangerous-context',
        displayName: 'Dangerous context',
        description: 'Reserved for unsafe operations.',
        permission: 'dangerous',
        enabled: true,
      },
      confidence: 0.94,
    },
  ];

  assert.deepEqual(
    selectExecutableSkillSelections(selections).map((item) => item.skill.id),
    ['read-context'],
  );
});

test('persona asset release can be inferred for legacy trained personas and persisted by the store', serial, () => {
  const PersonaAssetReleaseSchema = requireRuntimeTestable('PersonaAssetReleaseSchema');
  const originalDataDir = settings.get('neekoDataDir');
  const dataDir = mkdtempSync(join(tmpdir(), 'neeko-asset-release-'));
  const slug = 'legacy-release-persona';
  const now = '2026-05-05T07:00:00.000Z';
  const personaDir = join(dataDir, 'personas', slug);
  const store = new WorkbenchStore(join(dataDir, 'workbench'));
  const service = new WorkbenchService(store);

  try {
    settings.set('neekoDataDir', dataDir);
    mkdirSync(personaDir, { recursive: true });
    writeFileSync(join(personaDir, 'soul.yaml'), 'target_name: Legacy Release Persona\n', 'utf-8');
    writeFileSync(join(personaDir, 'persona-web-relations.json'), '[]', 'utf-8');
    writeFileSync(join(personaDir, 'persona-web-contexts.json'), '[]', 'utf-8');
    writeFileSync(join(personaDir, 'persona-web-provenance-report.json'), '{}', 'utf-8');
    writeFileSync(join(personaDir, 'skills.json'), JSON.stringify({
      schema_version: 2,
      persona_slug: slug,
      version: 1,
      updated_at: now,
      source_trace: [],
      origin_skills: [],
      distilled_skills: [],
      candidate_skill_pool: [],
      clusters: [],
      expanded_skills: [],
      pending_candidates: [],
    }), 'utf-8');
    writeFileSync(join(personaDir, 'persona.json'), JSON.stringify({
      id: 'abababab-abab-4bab-8bab-abababababab',
      name: 'Legacy Release Persona',
      slug,
      mode: 'single',
      source_targets: ['legacy'],
      soul_path: 'soul.yaml',
      memory_collection: `nico_${slug}`,
      status: 'available',
      training_rounds: 1,
      memory_node_count: 3,
      doc_count: 12,
      created_at: now,
      updated_at: now,
    }, null, 2), 'utf-8');
    store.savePersonaConfig({
      persona_slug: slug,
      name: 'Legacy Release Persona',
      sources: [],
      update_policy: {
        auto_check_remote: true,
        check_interval_minutes: 60,
        strategy: 'incremental',
      },
      updated_at: now,
    });

    const release = service.getPersonaAssetRelease(slug);
    const parsed = PersonaAssetReleaseSchema.parse(release);

    assert.equal(parsed.personaSlug, slug);
    assert.equal(parsed.status, 'active');
    assert.equal(parsed.assets.memoryCollection, `nico_${slug}`);
    assert.equal(parsed.assets.soulPath.endsWith('soul.yaml'), true);
    assert.equal(parsed.quality.memoryNodeCount, 3);
    assert.deepEqual(store.getPersonaAssetRelease(slug), parsed);
  } finally {
    settings.set('neekoDataDir', originalDataDir);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('read-only agent tool registry exposes safe tools and excludes disabled network adapters', serial, () => {
  const ReadOnlyToolRegistry = requireRuntimeTestable('ReadOnlyToolRegistry');
  const selectExecutableAgentTools = requireRuntimeTestable('selectExecutableAgentTools');
  const tools = new ReadOnlyToolRegistry().listTools();

  assert.equal(tools.some((tool) => tool.id === 'persona.memory.search'), true);
  assert.equal(tools.some((tool) => tool.id === 'persona.skill.search'), true);
  assert.equal(tools.some((tool) => tool.id === 'persona.relation.search'), true);
  assert.equal(tools.some((tool) => tool.id === 'web.page.read'), false);
  assert.equal(tools.every((tool) => tool.permission === 'read' || tool.permission === 'network_read'), true);
  assert.deepEqual(
    selectExecutableAgentTools([
      { id: 'safe', title: 'Safe', description: 'Safe read.', permission: 'read', enabled: true },
      { id: 'off', title: 'Off', description: 'Disabled read.', permission: 'read', enabled: false },
      { id: 'write', title: 'Write', description: 'Unsafe write.', permission: 'write', enabled: true },
      { id: 'danger', title: 'Danger', description: 'Dangerous.', permission: 'dangerous', enabled: true },
    ]).map((tool) => tool.id),
    ['safe'],
  );
});

test('sendMessage runtime trace records the explicit single-entry multi-module stage sequence', serial, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'neeko-runtime-stage-sequence-'));
  const store = new WorkbenchStore(join(dataDir, 'workbench'));
  const service = new WorkbenchService(store);
  const now = '2026-05-05T08:00:00.000Z';
  const conversationId = '17171717-1717-4717-8717-171717171717';

  try {
    store.saveConversation(makeConversation(conversationId, 'runtime-persona', now));
    store.savePersonaAssetRelease({
      personaSlug: 'runtime-persona',
      releaseId: '18181818-1818-4818-8818-181818181818',
      generatedAt: now,
      status: 'active',
      sourceSnapshot: {
        evidenceImportIds: [],
        trainingPrepIds: [],
        sourceSyncStateIds: [],
      },
      assets: {
        memoryCollection: 'nico_runtime_persona',
      },
      quality: {
        evidenceCount: 0,
        memoryNodeCount: 0,
        skillCount: 0,
        relationCount: 0,
        confidence: 0.25,
        knownGaps: ['no_relation_graph'],
      },
    });
    service.loadPersonaAssets = () => ({
      persona: {
        slug: 'runtime-persona',
        name: 'Runtime Persona',
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
      text: 'A small runtime plus read-only tools keeps the agent bounded.',
      triggeredSkills: [],
      normalizedQuery: 'What projects did I build?',
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

    const bundle = await service.sendMessage(
      conversationId,
      'What projects did I build?',
      [],
      { provider: 'openai', model: 'mock-chat' },
    );
    const trace = store.listChatAgentTraces(conversationId)[0];
    const stageTypes = trace.stages.map((stage) => stage.type);

    assert.equal(bundle.messages.length, 2);
    assert.deepEqual(stageTypes, [
      'input_received',
      'context_assembled',
      'intent_routed',
      'skill_selected',
      'tool_planned',
      'tool_executed',
      'evidence_synthesized',
      'llm_called',
      'memory_retrieved',
      'reply_finalized',
      'candidate_generated',
      'summary_updated',
    ]);
    assert.equal(trace.stages.find((stage) => stage.type === 'intent_routed').metadata.intent, 'fact_lookup');
    assert.equal(store.listAgentToolCallTraces(conversationId).length > 0, true);
    assert.equal('trace' in bundle, false);
    assert.equal('agent_trace' in bundle, false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

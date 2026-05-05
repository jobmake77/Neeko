import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __trainTestables,
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

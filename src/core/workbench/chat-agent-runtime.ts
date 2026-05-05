import { settings } from '../../config/settings.js';
import { type ProviderName } from '../../config/model.js';
import { Persona } from '../models/persona.js';
import { Soul } from '../models/soul.js';
import { MemoryNode } from '../models/memory.js';
import {
  AttachmentRef,
  ChatAgentSafetyPolicy,
  ChatAgentTrace,
  ChatAgentTraceEvent,
  ChatAgentTraceEventType,
  ChatAgentTraceReplay,
  ChatAgentTraceReplayStep,
  CitationItem,
  Conversation,
  ConversationMessage,
  ConversationOrchestration,
  MemoryCandidate,
  NetworkAnswerPack,
  SessionSummary,
  SkillDefinition,
  SkillSelection,
} from '../models/workbench.js';
import { loadSkillLibrary, selectTriggeredSkillsForQuery } from '../skills/library.js';
import { WorkbenchStore } from './store.js';

export interface ChatModelOverride {
  provider?: ProviderName;
  model?: string;
}

export interface ChatAgentRuntimeInput {
  conversationId: string;
  traceId?: string;
  userMessage: ConversationMessage;
  history: ConversationMessage[];
  attachments: AttachmentRef[];
  modelOverride?: ChatModelOverride;
  now?: string;
}

export interface ChatAgentRuntimeResult {
  userMessage: ConversationMessage;
  response: ChatAgentRuntimeResponse;
  trace: ChatAgentTrace;
}

export interface ChatAgentRuntimeResponse {
  text: string;
  triggeredSkills: Array<{ id?: string; name: string; confidence?: number }>;
  normalizedQuery: string;
  retrievedMemories: MemoryNode[];
  personaDimensions: string[];
  orchestration?: ConversationOrchestration;
  networkAnswerPack?: NetworkAnswerPack;
}

export interface ChatAgentPersistenceResult {
  assistantMessage: ConversationMessage;
  memoryCandidates: MemoryCandidate[];
  sessionSummary: SessionSummary;
}

export interface ChatAgentTraceDiagnosticStage {
  id: string;
  type: ChatAgentTraceEventType;
  at: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface ChatAgentTraceDiagnosticMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content_length: number;
  content_preview?: string;
}

export interface ChatAgentTraceDiagnostic {
  trace_id: string;
  conversation_id: string;
  persona_slug: string;
  status: ChatAgentTrace['status'];
  started_at: string;
  finished_at?: string;
  model?: ChatAgentTrace['model'];
  error?: string;
  stage_timeline: ChatAgentTraceDiagnosticStage[];
  messages?: {
    user?: ChatAgentTraceDiagnosticMessage;
    assistant?: ChatAgentTraceDiagnosticMessage;
  };
}

export interface ChatAgentTraceReplayDiagnostic {
  trace_id: string;
  conversation_id: string;
  persona_slug: string;
  status: ChatAgentTrace['status'];
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  model?: ChatAgentTrace['model'];
  failure_summary?: string;
  stage_timeline: ChatAgentTraceReplayStep[];
  message_summaries: ChatAgentTraceDiagnosticMessage[];
}

export interface ChatAgentContext {
  conversation: Conversation;
  persona: Persona;
  soul: Soul;
  personaSlug: string;
  personaName: string;
  history: ConversationMessage[];
  sessionSummary: SessionSummary | null;
  processedAttachments: AttachmentRef[];
  systemInstructions: string;
  personaContext: string;
  historyContext: Array<{ role: 'user' | 'assistant'; content: string }>;
  retrievedMaterials: CitationItem[];
  availableSkills: SkillSelection[];
  safetyPolicy: ChatAgentSafetyPolicy;
}

interface PersonaAssets {
  persona: Persona;
  soul: Soul;
}

interface ContextAssemblerOptions {
  store: WorkbenchStore;
  loadPersonaAssets: (slug: string) => PersonaAssets;
  skillRegistry?: SkillRegistry;
}

interface BoundedAgentLoopOptions {
  replyGenerator: (input: {
    persona: Persona;
    soul: Soul;
    messages: ConversationMessage[];
    modelOverride?: ChatModelOverride;
  }) => Promise<ChatAgentRuntimeResponse>;
}

interface PersonaChatAgentRuntimeOptions extends ContextAssemblerOptions, BoundedAgentLoopOptions {}

export function createChatAgentTraceEvent(
  type: ChatAgentTraceEventType,
  summary: string,
  metadata?: Record<string, unknown>,
  at = new Date().toISOString(),
): ChatAgentTraceEvent {
  return {
    id: crypto.randomUUID(),
    type,
    at,
    summary,
    metadata,
  };
}

export function failChatAgentTrace(trace: ChatAgentTrace, error: unknown, at = new Date().toISOString()): ChatAgentTrace {
  const message = sanitizeTraceError(error);
  return {
    ...trace,
    status: 'failed',
    finished_at: at,
    error: message,
    stages: [
      ...trace.stages,
      createChatAgentTraceEvent('failed', 'Chat agent turn failed.', { error: message }, at),
    ],
  };
}

export function buildChatAgentTraceReplay(trace: ChatAgentTrace): ChatAgentTraceReplay {
  return {
    trace_id: trace.id,
    conversation_id: trace.conversation_id,
    persona_slug: trace.persona_slug,
    user_message_id: trace.user_message_id,
    assistant_message_id: trace.assistant_message_id,
    status: trace.status,
    started_at: trace.started_at,
    finished_at: trace.finished_at,
    duration_ms: calculateDurationMs(trace.started_at, trace.finished_at),
    model: trace.model,
    failure_summary: trace.error,
    steps: trace.stages.map((stage, index) => buildChatAgentTraceReplayStep(trace, stage, index)),
  };
}

export function toChatAgentTraceDiagnostic(
  trace: ChatAgentTrace,
  context: {
    userMessage?: ConversationMessage;
    assistantMessage?: ConversationMessage;
  } = {},
): ChatAgentTraceDiagnostic {
  return {
    trace_id: trace.id,
    conversation_id: trace.conversation_id,
    persona_slug: trace.persona_slug,
    status: trace.status,
    started_at: trace.started_at,
    finished_at: trace.finished_at,
    model: trace.model,
    error: trace.error,
    stage_timeline: trace.stages.map((stage) => ({
      id: stage.id,
      type: stage.type,
      at: stage.at,
      summary: stage.summary,
      metadata: sanitizeDiagnosticMetadata(stage.metadata),
    })),
    messages: {
      user: context.userMessage ? summarizeDiagnosticMessage(context.userMessage) : undefined,
      assistant: context.assistantMessage ? summarizeDiagnosticMessage(context.assistantMessage) : undefined,
    },
  };
}

export function replayChatAgentTrace(
  trace: ChatAgentTrace,
  context: {
    messages?: ConversationMessage[];
  } = {},
): ChatAgentTraceReplayDiagnostic {
  const replay = buildChatAgentTraceReplay(trace);
  return {
    trace_id: replay.trace_id,
    conversation_id: replay.conversation_id,
    persona_slug: replay.persona_slug,
    status: replay.status,
    started_at: replay.started_at,
    finished_at: replay.finished_at,
    duration_ms: replay.duration_ms,
    model: replay.model,
    failure_summary: replay.failure_summary,
    stage_timeline: replay.steps,
    message_summaries: (context.messages ?? [])
      .filter((message) => message.id === trace.user_message_id || message.id === trace.assistant_message_id)
      .map((message) => summarizeDiagnosticMessage(message)),
  };
}

export function selectExecutableSkillSelections(selections: SkillSelection[]): SkillSelection[] {
  return selections.filter((selection) => selection.skill.enabled && selection.skill.permission === 'read');
}

export class SkillRegistry {
  selectForTurn(input: {
    userMessage: string;
    personaSlug: string;
    maxSkills?: number;
  }): SkillSelection[] {
    const library = loadSkillLibrary(settings.getPersonaDir(input.personaSlug), input.personaSlug);
    const selected = selectTriggeredSkillsForQuery(library, input.userMessage, input.maxSkills ?? 2);
    const byId = new Map(library.distilled_skills.map((skill) => [skill.id, skill]));
    const selectedSkills = selected.triggered
      .map((match): SkillSelection | null => {
        const skill = byId.get(match.id);
        if (!skill) return null;
        return {
          skill: {
            id: skill.id,
            displayName: skill.name,
            description: skill.central_thesis,
            permission: 'read',
            enabled: true,
          } satisfies SkillDefinition,
          confidence: match.trigger_score,
          reason: match.reason,
        };
      })
      .filter((item): item is SkillSelection => Boolean(item));
    return selectExecutableSkillSelections(selectedSkills);
  }
}

export class ContextAssembler {
  private readonly store: WorkbenchStore;
  private readonly loadPersonaAssets: (slug: string) => PersonaAssets;
  private readonly skillRegistry: SkillRegistry;

  constructor(options: ContextAssemblerOptions) {
    this.store = options.store;
    this.loadPersonaAssets = options.loadPersonaAssets;
    this.skillRegistry = options.skillRegistry ?? new SkillRegistry();
  }

  async assemble(input: ChatAgentRuntimeInput): Promise<ChatAgentContext> {
    const conversation = this.store.getConversation(input.conversationId);
    if (!conversation) throw new Error(`Conversation "${input.conversationId}" not found.`);
    const { persona, soul } = this.loadPersonaAssets(conversation.persona_slug);
    const sessionSummary = this.store.getSessionSummary(input.conversationId);
    const availableSkills = this.skillRegistry.selectForTurn({
      userMessage: input.userMessage.content,
      personaSlug: conversation.persona_slug,
      maxSkills: 2,
    });
    return {
      conversation,
      persona,
      soul,
      personaSlug: conversation.persona_slug,
      personaName: persona.name,
      history: input.history,
      sessionSummary,
      processedAttachments: input.attachments,
      systemInstructions: 'Persona chat turn runtime. Keep writes inside conversation log, session summary, memory candidates, and trace.',
      personaContext: soul.target_name || persona.name,
      historyContext: input.history
        .filter((item) => item.role === 'user' || item.role === 'assistant')
        .map((item) => ({
          role: item.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: item.content,
        })),
      retrievedMaterials: [],
      availableSkills,
      safetyPolicy: {
        writeTargets: ['conversation_log', 'session_summary', 'memory_candidates', 'trace'],
        forbiddenTargets: ['formal_persona', 'formal_soul', 'formal_memory', 'training_asset'],
        maxToolSteps: 0,
      },
    };
  }
}

export class BoundedAgentLoop {
  private readonly replyGenerator: BoundedAgentLoopOptions['replyGenerator'];

  constructor(options: BoundedAgentLoopOptions) {
    this.replyGenerator = options.replyGenerator;
  }

  async run(input: {
    context: ChatAgentContext;
    userMessage: ConversationMessage;
    modelOverride?: ChatModelOverride;
  }): Promise<ChatAgentRuntimeResponse> {
    return this.replyGenerator({
      persona: input.context.persona,
      soul: input.context.soul,
      messages: [...input.context.history, input.userMessage],
      modelOverride: input.modelOverride,
    });
  }
}

export class PersonaChatAgentRuntime {
  private readonly store: WorkbenchStore;
  private readonly assembler: ContextAssembler;
  private readonly loop: BoundedAgentLoop;

  constructor(options: PersonaChatAgentRuntimeOptions) {
    this.store = options.store;
    this.assembler = new ContextAssembler(options);
    this.loop = new BoundedAgentLoop(options);
  }

  async run(input: ChatAgentRuntimeInput): Promise<ChatAgentRuntimeResult> {
    const startedAt = input.now ?? new Date().toISOString();
    const conversation = this.store.getConversation(input.conversationId);
    let trace: ChatAgentTrace = {
      id: input.traceId ?? crypto.randomUUID(),
      conversation_id: input.conversationId,
      persona_slug: conversation?.persona_slug ?? '',
      user_message_id: input.userMessage.id,
      started_at: startedAt,
      model: input.modelOverride
        ? {
            provider: input.modelOverride.provider,
            model: input.modelOverride.model,
          }
        : undefined,
      stages: [],
      status: 'running',
    };

    try {
      const context = await this.assembler.assemble(input);
      trace = {
        ...trace,
        persona_slug: context.personaSlug,
        stages: [
          ...trace.stages,
          createChatAgentTraceEvent('context_assembled', 'Chat context assembled.', {
            history_count: context.history.length,
            attachment_count: context.processedAttachments.length,
            has_session_summary: Boolean(context.sessionSummary),
            max_tool_steps: context.safetyPolicy.maxToolSteps,
          }),
          createChatAgentTraceEvent('skill_selected', 'Read-only skills selected for prompt context.', {
            skill_ids: context.availableSkills.map((item) => item.skill.id),
            skill_count: context.availableSkills.length,
          }),
        ],
      };
      this.store.saveChatAgentTrace(trace);

      trace = {
        ...trace,
        stages: [
          ...trace.stages,
          createChatAgentTraceEvent('llm_called', 'Persona agent reply generation started.', {
            provider: input.modelOverride?.provider,
            model: input.modelOverride?.model,
          }),
        ],
      };
      this.store.saveChatAgentTrace(trace);

      const response = await this.loop.run({
        context,
        userMessage: input.userMessage,
        modelOverride: input.modelOverride,
      });
      trace = {
        ...trace,
        stages: [
          ...trace.stages,
          createChatAgentTraceEvent('memory_retrieved', 'Persona memories retrieved for the turn.', {
            memory_count: response.retrievedMemories.length,
          }),
          createChatAgentTraceEvent('reply_finalized', 'Assistant draft finalized by bounded agent loop.', {
            triggered_skill_count: response.triggeredSkills.length,
            persona_dimension_count: response.personaDimensions.length,
            orchestration_mode: response.orchestration?.mode,
          }),
        ],
      };
      this.store.saveChatAgentTrace(trace);
      return {
        userMessage: input.userMessage,
        response,
        trace,
      };
    } catch (error) {
      trace = failChatAgentTrace(trace, error);
      try {
        this.store.saveChatAgentTrace(trace);
      } catch {
        // Preserve the original runtime failure if trace persistence is unavailable.
      }
      throw error;
    }
  }
}

function sanitizeTraceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const compressed = raw.replace(/\s+/g, ' ').trim();
  const withoutSecrets = compressed
    .replace(/\b(sk|ghp|github_pat|glpat|xox[baprs])-[-_A-Za-z0-9]+\b/g, '[redacted-token]')
    .replace(/\b(password|token|api key|secret)\s*(?:is|=|:)?\s*[-_A-Za-z0-9]+\b/gi, '$1 [redacted]');
  return withoutSecrets.slice(0, 240) || 'Unknown chat agent runtime error.';
}

function buildChatAgentTraceReplayStep(
  trace: ChatAgentTrace,
  stage: ChatAgentTraceEvent,
  index: number,
): ChatAgentTraceReplayStep {
  const nextStage = trace.stages[index + 1];
  return {
    id: stage.id,
    type: stage.type,
    at: stage.at,
    summary: stage.summary,
    status: stage.type === 'failed' ? 'failed' : 'completed',
    duration_ms: calculateDurationMs(stage.at, nextStage?.at ?? trace.finished_at),
    model: extractStageModel(stage, trace.model),
    counts: extractStageCounts(stage),
    orchestration_mode: readStringMetadata(stage, 'orchestration_mode'),
    failure_summary: stage.type === 'failed'
      ? readStringMetadata(stage, 'error') ?? trace.error
      : undefined,
  };
}

function extractStageModel(
  stage: ChatAgentTraceEvent,
  fallback: ChatAgentTrace['model'],
): ChatAgentTraceReplayStep['model'] {
  if (stage.type !== 'llm_called') return undefined;
  const provider = readStringMetadata(stage, 'provider') ?? fallback?.provider;
  const model = readStringMetadata(stage, 'model') ?? fallback?.model;
  if (!provider && !model) return undefined;
  return { provider, model };
}

function extractStageCounts(stage: ChatAgentTraceEvent): Record<string, number> | undefined {
  const metadata = stage.metadata ?? {};
  const allowedCountKeys = [
    'attachment_count',
    'candidate_count',
    'history_count',
    'memory_count',
    'message_count',
    'persona_dimension_count',
    'skill_count',
    'triggered_skill_count',
  ];
  const counts = Object.fromEntries(
    allowedCountKeys
      .map((key) => [key, readNonNegativeIntegerMetadata(metadata, key)] as const)
      .filter((item): item is readonly [string, number] => typeof item[1] === 'number'),
  );
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function readStringMetadata(stage: ChatAgentTraceEvent, key: string): string | undefined {
  const value = stage.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNonNegativeIntegerMetadata(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function calculateDurationMs(start: string, end: string | undefined): number | undefined {
  if (!end) return undefined;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
  return Math.max(0, endMs - startMs);
}

function sanitizeDiagnosticMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const safeKeys = new Set([
    'attachment_count',
    'candidate_count',
    'has_session_summary',
    'history_count',
    'max_tool_steps',
    'memory_count',
    'message_count',
    'model',
    'orchestration_mode',
    'persona_dimension_count',
    'provider',
    'safe_count',
    'skill_count',
    'skill_ids',
    'triggered_skill_count',
    'write_enabled',
  ]);
  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => safeKeys.has(key) && isDiagnosticMetadataValueSafe(value)),
  );
}

function isDiagnosticMetadataValueSafe(value: unknown): boolean {
  if (typeof value === 'string') return value.length <= 120;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length <= 120);
}

function summarizeDiagnosticMessage(message: ConversationMessage): ChatAgentTraceDiagnosticMessage {
  return {
    id: message.id,
    role: message.role,
    content_length: message.content.length,
    content_preview: undefined,
  };
}

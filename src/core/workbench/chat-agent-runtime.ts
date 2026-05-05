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

export class SkillRegistry {
  selectForTurn(input: {
    userMessage: string;
    personaSlug: string;
    maxSkills?: number;
  }): SkillSelection[] {
    const library = loadSkillLibrary(settings.getPersonaDir(input.personaSlug), input.personaSlug);
    const selected = selectTriggeredSkillsForQuery(library, input.userMessage, input.maxSkills ?? 2);
    const byId = new Map(library.distilled_skills.map((skill) => [skill.id, skill]));
    return selected.triggered
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
    let trace: ChatAgentTrace = {
      id: input.traceId ?? crypto.randomUUID(),
      conversation_id: input.conversationId,
      persona_slug: '',
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
  return raw.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Unknown chat agent runtime error.';
}

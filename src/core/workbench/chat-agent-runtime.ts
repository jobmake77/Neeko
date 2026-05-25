import { settings } from '../../config/settings.js';
import { type ProviderName } from '../../config/model.js';
import { Persona } from '../models/persona.js';
import { Soul } from '../models/soul.js';
import { MemoryNode } from '../models/memory.js';
import {
  AttachmentRef,
  AgentEvidenceBundle,
  AgentToolCallTrace,
  AgentToolDefinition,
  AgentTurnState,
  AgentWorkingContext,
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
  PersonaAssetRelease,
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
  assetRelease: PersonaAssetRelease | null;
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
  toolRegistry?: ReadOnlyToolRegistry;
}

interface BoundedAgentLoopOptions {
  replyGenerator: (input: {
    persona: Persona;
    soul: Soul;
    messages: ConversationMessage[];
    modelOverride?: ChatModelOverride;
    workingContext?: AgentWorkingContext;
  }) => Promise<ChatAgentRuntimeResponse>;
}

interface PersonaChatAgentRuntimeOptions extends ContextAssemblerOptions, BoundedAgentLoopOptions {}

type AgentIntent = AgentTurnState['intent'];

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

export function selectExecutableAgentTools(tools: AgentToolDefinition[]): AgentToolDefinition[] {
  return tools.filter((tool) => tool.enabled && (tool.permission === 'read' || tool.permission === 'network_read'));
}

export class ReadOnlyToolRegistry {
  listTools(): AgentToolDefinition[] {
    return selectExecutableAgentTools([
      {
        id: 'persona.memory.search',
        title: 'Persona memory search',
        description: 'Searches the active persona memory collection for relevant long-term context.',
        permission: 'read',
        enabled: true,
      },
      {
        id: 'persona.skill.search',
        title: 'Persona skill search',
        description: 'Searches distilled persona skills and methods for the current turn.',
        permission: 'read',
        enabled: true,
      },
      {
        id: 'persona.relation.search',
        title: 'Persona relation search',
        description: 'Searches relation, project, and background context assets for grounded claims.',
        permission: 'read',
        enabled: true,
      },
      {
        id: 'conversation.history.search',
        title: 'Conversation history search',
        description: 'Reads the current thread history and summary for local continuity.',
        permission: 'read',
        enabled: true,
      },
      {
        id: 'web.page.read',
        title: 'Web page read',
        description: 'Reserved read-only adapter for URL reading through the approved tool layer.',
        permission: 'network_read',
        enabled: false,
      },
      {
        id: 'web.search',
        title: 'Web search',
        description: 'Reserved read-only adapter for external search through the approved tool layer.',
        permission: 'network_read',
        enabled: false,
      },
      {
        id: 'source.provenance.read',
        title: 'Source provenance read',
        description: 'Reads source provenance summaries without exposing internal raw paths.',
        permission: 'read',
        enabled: true,
      },
    ]);
  }

  getTool(id: string): AgentToolDefinition | undefined {
    return this.listTools().find((tool) => tool.id === id);
  }
}

export class IntentRouter {
  route(input: { userMessage: string; attachments: AttachmentRef[] }): AgentIntent {
    const message = input.userMessage.trim();
    if (message.length === 0 && input.attachments.length === 0) return 'clarify';
    if (/https?:\/\/\S+/i.test(message)) return 'tool_read';
    if (/(项目|作品|仓库|repo|github|关系|认识|合作|做过|背景|经历|观点|事实|fact|project|relation)/i.test(message)) {
      return 'fact_lookup';
    }
    if (/(你会怎么|你的风格|你通常|以.*口吻|人格|voice|style)/i.test(message)) return 'persona_voice';
    return 'chat';
  }
}

export class ReadOnlyToolPlanner {
  plan(input: {
    intent: AgentIntent;
    context: ChatAgentContext;
    tools: AgentToolDefinition[];
    maxTools?: number;
  }): AgentToolDefinition[] {
    const selected: AgentToolDefinition[] = [];
    const push = (id: string) => {
      const tool = input.tools.find((item) => item.id === id);
      if (tool && !selected.some((item) => item.id === tool.id)) selected.push(tool);
    };
    if (input.context.availableSkills.length > 0) push('persona.skill.search');
    if (input.context.history.length > 0 || input.context.sessionSummary) push('conversation.history.search');
    if (input.intent === 'fact_lookup' || input.intent === 'persona_voice') push('persona.memory.search');
    if (input.intent === 'fact_lookup') push('persona.relation.search');
    if (input.context.assetRelease?.assets.provenanceReportPath) push('source.provenance.read');
    return selected.slice(0, input.maxTools ?? Math.max(1, input.context.safetyPolicy.maxToolSteps));
  }
}

export class ReadOnlyToolExecutor {
  async execute(input: {
    conversationId: string;
    tools: AgentToolDefinition[];
    context: ChatAgentContext;
    now?: string;
  }): Promise<AgentToolCallTrace[]> {
    const now = input.now ?? new Date().toISOString();
    return input.tools.map((tool) => ({
      id: crypto.randomUUID(),
      tool_id: tool.id,
      permission: tool.permission,
      status: 'completed',
      started_at: now,
      finished_at: now,
      summary: summarizeReadOnlyTool(tool, input.context),
      input_summary: summarizeToolInput(tool, input.context),
      output_summary: summarizeReadOnlyTool(tool, input.context),
    }));
  }
}

export class EvidenceSynthesizer {
  synthesize(input: {
    context: ChatAgentContext;
    intent: AgentIntent;
    toolCalls: AgentToolCallTrace[];
  }): { evidenceBundle: AgentEvidenceBundle; workingContext: AgentWorkingContext } {
    const toolFacts = input.toolCalls
      .filter((toolCall) => toolCall.status === 'completed')
      .map((toolCall) => compactAgentToolEvidence(toolCall.output_summary ?? toolCall.summary))
      .filter(Boolean)
      .slice(0, 4);
    const facts = [
      input.context.assetRelease
        ? `Active persona release ${input.context.assetRelease.releaseId} is ${input.context.assetRelease.status}.`
        : undefined,
      input.context.sessionSummary
        ? `Conversation summary is available with ${input.context.sessionSummary.message_count} messages.`
        : undefined,
      input.context.availableSkills.length > 0
        ? `${input.context.availableSkills.length} read-only persona skill contexts are relevant.`
        : undefined,
      input.toolCalls.length > 0
        ? `${input.toolCalls.length} read-only tool contexts were prepared.`
        : undefined,
      ...toolFacts,
    ].filter((item): item is string => Boolean(item));
    const uncertainties = input.context.assetRelease
      ? input.context.assetRelease.quality.knownGaps.slice(0, 4)
      : ['no_active_persona_asset_release'];
    const personaVoiceHints = input.context.availableSkills
      .map((item) => item.skill.displayName)
      .slice(0, 3);
    const doNotClaim = [
      'Do not present temporary tool results as permanent persona memory.',
      'Do not expose internal release, memory, skill, trace, or tool wiring to the user.',
    ];
    const evidenceBundle: AgentEvidenceBundle = {
      facts,
      uncertainties,
      persona_voice_hints: personaVoiceHints,
      do_not_claim: doNotClaim,
      tool_call_ids: input.toolCalls.map((item) => item.id),
    };
    return {
      evidenceBundle,
      workingContext: {
        facts,
        uncertainties,
        persona_voice_hints: personaVoiceHints,
        do_not_claim: doNotClaim,
        summary: [
          `intent=${input.intent}`,
          facts.length > 0 ? facts.join(' ') : 'No additional read-only context was required.',
          uncertainties.length > 0 ? `Known gaps: ${uncertainties.join(', ')}.` : '',
        ].filter(Boolean).join(' '),
      },
    };
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
    const assetRelease = this.store.getPersonaAssetRelease(conversation.persona_slug);
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
      assetRelease,
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
        maxToolSteps: 2,
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
    workingContext?: AgentWorkingContext;
  }): Promise<ChatAgentRuntimeResponse> {
    return this.replyGenerator({
      persona: input.context.persona,
      soul: input.context.soul,
      messages: [...input.context.history, input.userMessage],
      modelOverride: input.modelOverride,
      workingContext: input.workingContext,
    });
  }
}

export class PersonaChatAgentRuntime {
  private readonly store: WorkbenchStore;
  private readonly assembler: ContextAssembler;
  private readonly loop: BoundedAgentLoop;
  private readonly toolRegistry: ReadOnlyToolRegistry;
  private readonly intentRouter = new IntentRouter();
  private readonly toolPlanner = new ReadOnlyToolPlanner();
  private readonly toolExecutor = new ReadOnlyToolExecutor();
  private readonly evidenceSynthesizer = new EvidenceSynthesizer();

  constructor(options: PersonaChatAgentRuntimeOptions) {
    this.store = options.store;
    this.assembler = new ContextAssembler(options);
    this.loop = new BoundedAgentLoop(options);
    this.toolRegistry = options.toolRegistry ?? new ReadOnlyToolRegistry();
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
    let turnState: AgentTurnState | null = null;

    try {
      trace = {
        ...trace,
        stages: [
          ...trace.stages,
          createChatAgentTraceEvent('input_received', 'Chat agent input received.', {
            attachment_count: input.attachments.length,
            history_count: input.history.length,
          }, startedAt),
        ],
      };
      this.store.saveChatAgentTrace(trace);

      const context = await this.assembler.assemble(input);
      const intent = this.intentRouter.route({
        userMessage: input.userMessage.content,
        attachments: input.attachments,
      });
      turnState = {
        id: crypto.randomUUID(),
        conversation_id: input.conversationId,
        persona_slug: context.personaSlug,
        release_id: context.assetRelease?.releaseId,
        status: 'running',
        intent,
        tool_calls: [],
        created_at: startedAt,
        updated_at: startedAt,
      };
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
            release_status: context.assetRelease?.status,
          }),
          createChatAgentTraceEvent('intent_routed', 'Chat intent routed for the bounded agent loop.', {
            intent,
          }),
          createChatAgentTraceEvent('skill_selected', 'Read-only skills selected for prompt context.', {
            skill_ids: context.availableSkills.map((item) => item.skill.id),
            skill_count: context.availableSkills.length,
          }),
        ],
      };
      this.store.saveChatAgentTrace(trace);

      const availableTools = this.toolRegistry.listTools();
      const plannedTools = this.toolPlanner.plan({
        intent,
        context,
        tools: availableTools,
        maxTools: context.safetyPolicy.maxToolSteps,
      });
      trace = {
        ...trace,
        stages: [
          ...trace.stages,
          createChatAgentTraceEvent('tool_planned', 'Read-only tool plan prepared.', {
            tool_count: plannedTools.length,
            tool_ids: plannedTools.map((tool) => tool.id),
          }),
        ],
      };
      this.store.saveChatAgentTrace(trace);

      const toolCalls = await this.toolExecutor.execute({
        conversationId: input.conversationId,
        tools: plannedTools,
        context,
      });
      for (const toolCall of toolCalls) {
        this.store.saveAgentToolCallTrace(input.conversationId, toolCall);
      }
      const synthesized = this.evidenceSynthesizer.synthesize({
        context,
        intent,
        toolCalls,
      });
      turnState = {
        ...turnState,
        tool_calls: toolCalls,
        evidence_bundle: synthesized.evidenceBundle,
        working_context: synthesized.workingContext,
        updated_at: new Date().toISOString(),
      };
      trace = {
        ...trace,
        stages: [
          ...trace.stages,
          createChatAgentTraceEvent('tool_executed', 'Read-only tools executed for working context.', {
            tool_count: toolCalls.length,
            safe_count: toolCalls.filter((item) => item.status === 'completed').length,
          }),
          createChatAgentTraceEvent('evidence_synthesized', 'Read-only evidence synthesized into working context.', {
            safe_count: synthesized.evidenceBundle.facts.length,
            uncertainty_count: synthesized.evidenceBundle.uncertainties.length,
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
        workingContext: synthesized.workingContext,
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
        trace: turnState
          ? {
              ...trace,
              stages: [
                ...trace.stages,
              ],
            }
          : trace,
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

function summarizeReadOnlyTool(tool: AgentToolDefinition, context: ChatAgentContext): string {
  if (tool.id === 'persona.memory.search') {
    return `Persona memory context available: memory_nodes=${context.assetRelease?.quality.memoryNodeCount ?? context.persona.memory_node_count ?? 0}.`;
  }
  if (tool.id === 'persona.skill.search') {
    if (context.availableSkills.length === 0) return 'Persona skill context available: no matching skills.';
    const skills = context.availableSkills
      .slice(0, 3)
      .map((item) => {
        const confidence = typeof item.confidence === 'number' ? ` confidence=${item.confidence.toFixed(2)}` : '';
        const reason = item.reason ? ` reason=${compactAgentToolEvidence(item.reason, 120)}` : '';
        return `${compactAgentToolEvidence(item.skill.displayName, 80)}${confidence}${reason}`;
      })
      .join(' | ');
    return `Persona skill context available: ${skills}.`;
  }
  if (tool.id === 'persona.relation.search') {
    return context.assetRelease?.assets.relationGraphPath
      ? `Persona relation context available: relations=${context.assetRelease.quality.relationCount}, evidence=${context.assetRelease.quality.evidenceCount}.`
      : 'Persona relation graph context is not available.';
  }
  if (tool.id === 'conversation.history.search') {
    const summary = context.sessionSummary?.summary
      ? ` summary=${compactAgentToolEvidence(context.sessionSummary.summary, 180)}`
      : ' summary=none';
    return `Conversation continuity context available: history_messages=${context.history.length}, summary_messages=${context.sessionSummary?.message_count ?? 0}.${summary}`;
  }
  if (tool.id === 'source.provenance.read') {
    return context.assetRelease?.assets.provenanceReportPath
      ? `Source provenance context available: evidence=${context.assetRelease.quality.evidenceCount}, confidence=${context.assetRelease.quality.confidence.toFixed(2)}.`
      : 'Source provenance summary is not available.';
  }
  return `${tool.title} is reserved for the read-only tool layer.`;
}

function compactAgentToolEvidence(value: string, maxLength = 240): string {
  const compacted = value
    .replace(/(?:\/[A-Za-z0-9._ -]+)+/g, '[path]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compacted) return '';
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength).trimEnd()}...`;
}

function summarizeToolInput(tool: AgentToolDefinition, context: ChatAgentContext): string {
  return [
    `tool=${tool.id}`,
    `persona=${context.personaSlug}`,
    context.assetRelease ? `release=${context.assetRelease.status}` : 'release=legacy',
  ].join(' ');
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
    'tool_count',
    'triggered_skill_count',
    'uncertainty_count',
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
    'intent',
    'max_tool_steps',
    'memory_count',
    'message_count',
    'model',
    'orchestration_mode',
    'persona_dimension_count',
    'provider',
    'release_status',
    'safe_count',
    'skill_count',
    'skill_ids',
    'tool_count',
    'tool_ids',
    'triggered_skill_count',
    'uncertainty_count',
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

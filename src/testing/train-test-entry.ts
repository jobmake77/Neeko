import { loadTrainingRawDocs } from '../cli/commands/train.js';
import { resolveInProcessRetryLimit } from '../cli/commands/train.js';
import { resolveTrackBudgetMs, resolveTrackStageTimeoutMs } from '../cli/commands/train.js';
import { settings } from '../config/settings.js';
import {
  AgentToolCallTraceSchema,
  AgentToolDefinitionSchema,
  AgentTurnStateSchema,
  ChatAgentTraceReplaySchema,
  ChatAgentTraceReplayStepSchema,
  ChatAgentTraceSchema,
  PersonaAssetReleaseSchema,
} from '../core/models/workbench.js';
import {
  buildChatAgentTraceReplay,
  ContextAssembler,
  EvidenceSynthesizer,
  IntentRouter,
  PersonaChatAgentRuntime,
  ReadOnlyToolPlanner,
  ReadOnlyToolRegistry,
  replayChatAgentTrace,
  selectExecutableAgentTools,
  selectExecutableSkillSelections,
  SkillRegistry,
  toChatAgentTraceDiagnostic,
} from '../core/workbench/chat-agent-runtime.js';
import { __workbenchTestables } from '../core/workbench/service.js';
import { WorkbenchService } from '../core/workbench/service.js';
import { WorkbenchStore } from '../core/workbench/store.js';

export const __trainTestables: Record<string, unknown> = {
  loadTrainingRawDocs,
  resolveInProcessRetryLimit,
  resolveTrackStageTimeoutMs,
  resolveTrackBudgetMs,
  buildChatAgentTraceReplay,
  replayChatAgentTrace,
  selectExecutableAgentTools,
  selectExecutableSkillSelections,
  toChatAgentTraceDiagnostic,
  AgentToolCallTraceSchema,
  AgentToolDefinitionSchema,
  AgentTurnStateSchema,
  ChatAgentTraceReplaySchema,
  ChatAgentTraceReplayStepSchema,
  ChatAgentTraceSchema,
  PersonaAssetReleaseSchema,
  ContextAssembler,
  EvidenceSynthesizer,
  IntentRouter,
  PersonaChatAgentRuntime,
  ReadOnlyToolPlanner,
  ReadOnlyToolRegistry,
  SkillRegistry,
  ...__workbenchTestables,
};

export {
  settings,
  WorkbenchService,
  WorkbenchStore,
};

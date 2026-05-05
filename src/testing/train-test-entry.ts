import { loadTrainingRawDocs } from '../cli/commands/train.js';
import { resolveInProcessRetryLimit } from '../cli/commands/train.js';
import { resolveTrackBudgetMs, resolveTrackStageTimeoutMs } from '../cli/commands/train.js';
import { settings } from '../config/settings.js';
import {
  ChatAgentTraceReplaySchema,
  ChatAgentTraceReplayStepSchema,
  ChatAgentTraceSchema,
} from '../core/models/workbench.js';
import {
  buildChatAgentTraceReplay,
  ContextAssembler,
  PersonaChatAgentRuntime,
  replayChatAgentTrace,
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
  selectExecutableSkillSelections,
  toChatAgentTraceDiagnostic,
  ChatAgentTraceReplaySchema,
  ChatAgentTraceReplayStepSchema,
  ChatAgentTraceSchema,
  ContextAssembler,
  PersonaChatAgentRuntime,
  SkillRegistry,
  ...__workbenchTestables,
};

export {
  settings,
  WorkbenchService,
  WorkbenchStore,
};

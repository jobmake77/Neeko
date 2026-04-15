import { loadTrainingRawDocs } from '../cli/commands/train.js';
import { resolveInProcessRetryLimit } from '../cli/commands/train.js';
import { resolveTrackBudgetMs, resolveTrackStageTimeoutMs } from '../cli/commands/train.js';
import { __workbenchTestables } from '../core/workbench/service.js';

export const __trainTestables = {
  loadTrainingRawDocs,
  resolveInProcessRetryLimit,
  resolveTrackStageTimeoutMs,
  resolveTrackBudgetMs,
  ...__workbenchTestables,
};

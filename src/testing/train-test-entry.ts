import { loadTrainingRawDocs } from '../cli/commands/train.js';
import { resolveInProcessRetryLimit } from '../cli/commands/train.js';
import { resolveTrackBudgetMs, resolveTrackStageTimeoutMs } from '../cli/commands/train.js';
import { settings } from '../config/settings.js';
import { __workbenchTestables } from '../core/workbench/service.js';
import { WorkbenchService } from '../core/workbench/service.js';
import { WorkbenchStore } from '../core/workbench/store.js';

export const __trainTestables: Record<string, unknown> = {
  loadTrainingRawDocs,
  resolveInProcessRetryLimit,
  resolveTrackStageTimeoutMs,
  resolveTrackBudgetMs,
  ...__workbenchTestables,
};

export {
  settings,
  WorkbenchService,
  WorkbenchStore,
};

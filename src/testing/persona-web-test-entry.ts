import {
  __governanceTestables,
} from '../core/training/governance.js';
import {
  buildPersonaWebArtifacts,
  compileTrainingSeedV3,
  buildProvenanceReport,
  selectTrainingSeedV3Hints,
} from '../core/pipeline/persona-web.js';
import { __workbenchTestables } from '../core/workbench/service.js';

export const __personaWebTestables: Record<string, unknown> = {
  buildPersonaWebArtifacts,
  compileTrainingSeedV3,
  buildProvenanceReport,
  selectTrainingSeedV3Hints,
  ...__governanceTestables,
  ...__workbenchTestables,
};

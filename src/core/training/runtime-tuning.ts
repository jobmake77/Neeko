export type TrainingRuntimePreset = 'balanced' | 'compact' | 'fast' | 'robust';

export interface TrainingRuntimeConfig {
  preset: TrainingRuntimePreset;
  trainerTimeoutMs: number;
  trainerRetries: number;
  trainerCompactPrompt: boolean;
  personaMaxTokens: number;
  personaTimeoutMs: number;
  personaRetries: number;
  personaCompactPrompt: boolean;
  personaMemoryLimit: number;
  personaMemoryMaxChars: number;
  directorTimeoutMs: number;
  directorRetries: number;
  directorCompactPrompt: boolean;
  evaluatorTimeoutMs: number;
  evaluatorRetries: number;
  evaluatorMaxResponseChars: number;
  evaluatorCompactPrompt: boolean;
  evaluatorLayered: boolean;
}

export type TrainingRuntimeOverrides = Partial<TrainingRuntimeConfig>;

const PRESETS: Record<TrainingRuntimePreset, TrainingRuntimeConfig> = {
  balanced: {
    preset: 'balanced',
    trainerTimeoutMs: 32_000,
    trainerRetries: 1,
    trainerCompactPrompt: false,
    personaMaxTokens: 320,
    personaTimeoutMs: 32_000,
    personaRetries: 1,
    personaCompactPrompt: true,
    personaMemoryLimit: 4,
    personaMemoryMaxChars: 900,
    directorTimeoutMs: 30_000,
    directorRetries: 1,
    directorCompactPrompt: false,
    evaluatorTimeoutMs: 32_000,
    evaluatorRetries: 1,
    evaluatorMaxResponseChars: 1200,
    evaluatorCompactPrompt: false,
    evaluatorLayered: false,
  },
  compact: {
    preset: 'compact',
    trainerTimeoutMs: 22_000,
    trainerRetries: 0,
    trainerCompactPrompt: true,
    personaMaxTokens: 240,
    personaTimeoutMs: 24_000,
    personaRetries: 1,
    personaCompactPrompt: true,
    personaMemoryLimit: 3,
    personaMemoryMaxChars: 700,
    directorTimeoutMs: 22_000,
    directorRetries: 0,
    directorCompactPrompt: true,
    evaluatorTimeoutMs: 24_000,
    evaluatorRetries: 1,
    evaluatorMaxResponseChars: 900,
    evaluatorCompactPrompt: true,
    evaluatorLayered: true,
  },
  fast: {
    preset: 'fast',
    trainerTimeoutMs: 16_000,
    trainerRetries: 0,
    trainerCompactPrompt: true,
    personaMaxTokens: 180,
    personaTimeoutMs: 18_000,
    personaRetries: 1,
    personaCompactPrompt: true,
    personaMemoryLimit: 2,
    personaMemoryMaxChars: 480,
    directorTimeoutMs: 16_000,
    directorRetries: 0,
    directorCompactPrompt: true,
    evaluatorTimeoutMs: 20_000,
    evaluatorRetries: 1,
    evaluatorMaxResponseChars: 700,
    evaluatorCompactPrompt: true,
    evaluatorLayered: true,
  },
  robust: {
    preset: 'robust',
    trainerTimeoutMs: 30_000,
    trainerRetries: 0,
    trainerCompactPrompt: false,
    personaMaxTokens: 420,
    personaTimeoutMs: 48_000,
    personaRetries: 2,
    personaCompactPrompt: true,
    personaMemoryLimit: 5,
    personaMemoryMaxChars: 1200,
    directorTimeoutMs: 28_000,
    directorRetries: 0,
    directorCompactPrompt: false,
    evaluatorTimeoutMs: 45_000,
    evaluatorRetries: 2,
    evaluatorMaxResponseChars: 1400,
    evaluatorCompactPrompt: false,
    evaluatorLayered: true,
  },
};

export function resolveTrainingRuntimePreset(raw?: string): TrainingRuntimePreset {
  const value = String(raw ?? 'balanced').toLowerCase();
  if (value === 'compact' || value === 'fast' || value === 'robust') return value;
  return 'balanced';
}

export function getTrainingRuntimeConfig(raw?: string): TrainingRuntimeConfig {
  const preset = resolveTrainingRuntimePreset(raw);
  return PRESETS[preset];
}

export function mergeTrainingRuntimeConfig(
  preset: TrainingRuntimePreset,
  overrides?: TrainingRuntimeOverrides
): TrainingRuntimeConfig {
  return {
    ...getTrainingRuntimeConfig(preset),
    ...(overrides ?? {}),
    preset,
  };
}

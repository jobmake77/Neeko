import { spinner } from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { Persona, PersonaSchema } from '../../core/models/persona.js';
import { Soul, SoulSchema } from '../../core/models/soul.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop } from '../../core/training/loop.js';
import {
  buildTrainingRunReportFromRounds,
  TrainingRoundSnapshot,
  TrainingRunReport,
} from '../../core/training/report.js';
import { TrainingProfile } from '../../core/training/types.js';

export async function cmdTrain(
  slug: string,
  options: {
    rounds?: string;
    mode?: string;
    trainingProfile?: string;
    retries?: string;
  } = {}
): Promise<void> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const soulPath = join(dir, 'soul.yaml');
  const reportPath = join(dir, 'training-report.json');

  if (!existsSync(personaPath) || !existsSync(soulPath)) {
    throw new Error(`Persona "${slug}" not found. Please create it first.`);
  }

  const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8'))) as Persona;
  const soul = SoulSchema.parse(yaml.load(readFileSync(soulPath, 'utf-8'))) as Soul;
  const profile = normalizeTrainingProfile(options.trainingProfile);
  const rounds = resolveRounds(options.rounds, options.mode);
  const retries = resolveRetries(options.retries);

  const spin = spinner();
  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });

  try {
    await store.ensureCollection(persona.memory_collection);
  } catch {
    throw new Error('Qdrant 不可达，无法继续培养。请先启动 Qdrant。');
  }

  spin.start(`继续培养 ${slug}（${rounds} 轮，profile=${profile}）...`);
  persona.status = 'training';
  persistPersonaAndSoul(dir, persona, soul);

  const result = await runWithRetry(
    retries,
    async () => {
      const loop = new TrainingLoop(soul, persona, store);
      return await loop.run({
        maxRounds: rounds,
        profile,
        onProgress: (progress) => {
          spin.message(
            `Round ${progress.round}/${progress.maxRounds} — +${progress.nodesWritten}, quality ${(progress.avgQualityScore * 100).toFixed(0)}%`
          );
        },
      });
    },
    (attempt, maxAttempts) => {
      spin.message(`模型输出不稳定，自动重试中（${attempt}/${maxAttempts}）...`);
    }
  );

  const existingRounds = readExistingRounds(reportPath);
  const roundOffset = existingRounds.length;
  const newRounds: TrainingRoundSnapshot[] = result.history.map((item) => ({
    round: roundOffset + item.round,
    status: item.status,
    avg_quality_score: item.avgQualityScore,
    nodes_written: item.nodesWritten,
    nodes_reinforced: item.nodesReinforced,
    contradiction_rate: item.observability.contradictionRate,
    duplication_rate: item.observability.duplicationRate,
    low_confidence_coverage: item.observability.lowConfidenceCoverage,
    new_high_value_memories: item.observability.newHighValueMemories,
    quarantined_memories: item.observability.quarantinedMemories,
    score_distribution: item.observability.scoreDistribution,
  }));

  const merged = buildTrainingRunReportFromRounds(profile, [...existingRounds, ...newRounds]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(merged, null, 2), 'utf-8');

  persona.status = 'converged';
  persona.training_rounds = merged.total_rounds;
  persona.last_trained_at = new Date().toISOString();
  persona.updated_at = new Date().toISOString();
  soul.training_rounds_completed = merged.total_rounds;
  soul.updated_at = new Date().toISOString();

  try {
    persona.memory_node_count = await store.count(persona.memory_collection);
  } catch {
    // Ignore count failure and keep previous value.
  }

  persistPersonaAndSoul(dir, persona, soul);
  spin.stop(`培养完成：累计 ${merged.total_rounds} 轮`);
  console.log(chalk.green(`✓ ${slug} 已继续培养完成`));
}

function persistPersonaAndSoul(dir: string, persona: Persona, soul: Soul): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'persona.json'), JSON.stringify(persona, null, 2), 'utf-8');
  writeFileSync(join(dir, 'soul.yaml'), yaml.dump(soul), 'utf-8');
}

function normalizeTrainingProfile(raw?: string): TrainingProfile {
  const fallback = String(settings.get('defaultTrainingProfile') ?? 'full').toLowerCase();
  const value = String(raw ?? fallback).toLowerCase();
  if (value === 'baseline' || value === 'a1' || value === 'a2' || value === 'a3' || value === 'a4' || value === 'full') {
    return value;
  }
  return 'full';
}

function resolveRounds(rawRounds?: string, rawMode?: string): number {
  const mode = String(rawMode ?? '').toLowerCase();
  if (mode === 'quick') return 3;
  if (mode === 'full') return 10;
  const parsed = parseInt(rawRounds ?? '10', 10);
  if (Number.isNaN(parsed)) return 10;
  return Math.max(1, parsed);
}

function resolveRetries(raw?: string): number {
  const parsed = parseInt(raw ?? '2', 10);
  if (Number.isNaN(parsed)) return 2;
  return Math.max(0, Math.min(parsed, 5));
}

async function runWithRetry<T>(
  retries: number,
  fn: () => Promise<T>,
  onRetry: (attempt: number, maxAttempts: number) => void
): Promise<T> {
  const maxAttempts = retries + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = String(error);
      const retryable =
        message.includes('No object generated') ||
        message.includes('response did not match schema') ||
        message.includes('rate limit') ||
        message.includes('429');
      if (!retryable || attempt >= maxAttempts) break;
      onRetry(attempt + 1, maxAttempts);
      await sleep(1200 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readExistingRounds(reportPath: string): TrainingRoundSnapshot[] {
  if (!existsSync(reportPath)) return [];
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as TrainingRunReport;
    if (!Array.isArray(report.rounds)) return [];
    return report.rounds as TrainingRoundSnapshot[];
  } catch {
    return [];
  }
}

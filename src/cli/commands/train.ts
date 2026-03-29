import { spinner } from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { Persona, PersonaSchema } from '../../core/models/persona.js';
import { Soul, SoulSchema } from '../../core/models/soul.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop, TrainingProgress } from '../../core/training/loop.js';
import {
  buildTrainingRunReportFromRounds,
  TrainingRoundSnapshot,
  TrainingRunReport,
} from '../../core/training/report.js';
import { TrainingProfile } from '../../core/training/types.js';
import {
  loadSkillLibrary,
  refreshSkillLibraryFromSignals,
  saveSkillLibrary,
} from '../../core/skills/library.js';

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
  const contextPath = join(dir, 'training-context.json');

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

  console.log('[SKILL_STAGE] skill_origin_extract');
  const previousSkills = loadSkillLibrary(dir, slug);
  const memorySignals = await buildMemorySignals(store, persona.memory_collection, soul);
  const skillLibrary = await refreshSkillLibraryFromSignals(persona, soul, memorySignals, previousSkills);
  console.log('[SKILL_STAGE] skill_expand');
  saveSkillLibrary(dir, skillLibrary);
  console.log('[SKILL_STAGE] skill_merge');

  const existingRounds = readExistingRounds(reportPath);
  const roundOffset = existingRounds.length;
  const covered = skillLibrary.origin_skills.filter((o) =>
    skillLibrary.distilled_skills.some((e) => e.source_origin_ids.includes(o.id))
  ).length;
  const skillMetrics = {
    originSkillsAdded: skillLibrary.origin_skills.length,
    distilledSkillsAdded: skillLibrary.distilled_skills.length,
    skillCoverageScore:
      skillLibrary.origin_skills.length === 0 ? 0 : covered / skillLibrary.origin_skills.length,
  };
  const incrementalRounds: TrainingRoundSnapshot[] = [];
  writeTrainingContext(contextPath, {
    state: 'running',
    slug,
    profile,
    requested_rounds: rounds,
    completed_rounds: roundOffset,
    updated_at: new Date().toISOString(),
    report_path: reportPath,
  });

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
          const snapshot = toRoundSnapshot(progress, roundOffset);
          upsertRoundSnapshot(incrementalRounds, snapshot);
          const partial = buildTrainingRunReportFromRounds(
            profile,
            [...existingRounds, ...incrementalRounds],
            skillMetrics
          );
          mkdirSync(dir, { recursive: true });
          writeFileSync(reportPath, JSON.stringify(partial, null, 2), 'utf-8');
          persona.status = 'training';
          persona.training_rounds = partial.total_rounds;
          persona.last_trained_at = new Date().toISOString();
          persona.updated_at = new Date().toISOString();
          soul.training_rounds_completed = partial.total_rounds;
          soul.updated_at = new Date().toISOString();
          persistPersonaAndSoul(dir, persona, soul);
          writeTrainingContext(contextPath, {
            state: 'running',
            slug,
            profile,
            requested_rounds: rounds,
            completed_rounds: partial.total_rounds,
            updated_at: new Date().toISOString(),
            report_path: reportPath,
          });
        },
      });
    },
    (attempt, maxAttempts) => {
      spin.message(`模型输出不稳定，自动重试中（${attempt}/${maxAttempts}）...`);
    }
  ).catch((error) => {
    writeTrainingContext(contextPath, {
      state: 'interrupted',
      slug,
      profile,
      requested_rounds: rounds,
      completed_rounds: Math.max(roundOffset, ...incrementalRounds.map((r) => r.round)),
      updated_at: new Date().toISOString(),
      report_path: reportPath,
      last_error: String(error),
    });
    throw error;
  });

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
    gap_focused_questions: item.observability.gapFocusedQuestions,
    total_questions: item.observability.totalQuestions,
    skill_trigger_precision: item.observability.skillTriggerPrecision,
    skill_method_adherence: item.observability.skillMethodAdherence,
    skill_boundary_violation_rate: item.observability.skillBoundaryViolationRate,
    skill_transfer_success_rate: item.observability.skillTransferSuccessRate,
    skill_set_change_rate: item.observability.skillSetChangeRate,
    score_distribution: item.observability.scoreDistribution,
  }));

  const merged = buildTrainingRunReportFromRounds(profile, [...existingRounds, ...newRounds], skillMetrics);
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
  writeTrainingContext(contextPath, {
    state: 'completed',
    slug,
    profile,
    requested_rounds: rounds,
    completed_rounds: merged.total_rounds,
    updated_at: new Date().toISOString(),
    report_path: reportPath,
  });
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

function toRoundSnapshot(progress: TrainingProgress, roundOffset: number): TrainingRoundSnapshot {
  return {
    round: roundOffset + progress.round,
    status: progress.status,
    avg_quality_score: progress.avgQualityScore,
    nodes_written: progress.nodesWritten,
    nodes_reinforced: progress.nodesReinforced,
    contradiction_rate: progress.observability.contradictionRate,
    duplication_rate: progress.observability.duplicationRate,
    low_confidence_coverage: progress.observability.lowConfidenceCoverage,
    new_high_value_memories: progress.observability.newHighValueMemories,
    quarantined_memories: progress.observability.quarantinedMemories,
    gap_focused_questions: progress.observability.gapFocusedQuestions,
    total_questions: progress.observability.totalQuestions,
    skill_trigger_precision: progress.observability.skillTriggerPrecision,
    skill_method_adherence: progress.observability.skillMethodAdherence,
    skill_boundary_violation_rate: progress.observability.skillBoundaryViolationRate,
    skill_transfer_success_rate: progress.observability.skillTransferSuccessRate,
    skill_set_change_rate: progress.observability.skillSetChangeRate,
    score_distribution: progress.observability.scoreDistribution,
  };
}

function upsertRoundSnapshot(rounds: TrainingRoundSnapshot[], next: TrainingRoundSnapshot): void {
  const idx = rounds.findIndex((item) => item.round === next.round);
  if (idx >= 0) {
    rounds[idx] = next;
    return;
  }
  rounds.push(next);
  rounds.sort((a, b) => a.round - b.round);
}

function writeTrainingContext(path: string, payload: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // best effort checkpoint
  }
}

async function buildMemorySignals(
  store: MemoryStore,
  collection: string,
  soul: Soul
): Promise<string[]> {
  const queries = new Set<string>();
  for (const d of soul.knowledge_domains.expert.slice(0, 5)) queries.add(d);
  for (const b of soul.values.core_beliefs.slice(0, 5)) queries.add(b.belief);
  if (queries.size === 0) {
    queries.add(`${soul.target_name} method`);
    queries.add(`${soul.target_name} decision`);
  }

  const signals: string[] = [];
  for (const query of queries) {
    try {
      const nodes = await store.search(collection, query, { limit: 6, filter: { minConfidence: 0.45 } });
      for (const node of nodes) {
        signals.push(`${node.summary}\n${node.original_text.slice(0, 200)}`);
      }
    } catch {
      // ignore search failures for refresh path
    }
  }
  return Array.from(new Set(signals)).slice(0, 80);
}

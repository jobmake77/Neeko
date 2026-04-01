import chalk from 'chalk';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { Persona } from '../../core/models/persona.js';
import { Soul } from '../../core/models/soul.js';
import { createEmptySoul } from '../../core/models/soul.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop } from '../../core/training/loop.js';
import { ExperimentSummaryRow, evaluateGate } from '../../core/training/ab-report.js';
import { TrainingProfile } from '../../core/training/types.js';
import { runModelPreflight } from '../../core/training/preflight.js';
import {
  InputRoutingObservability,
  InputRoutingStrategy,
  loadRawDocsCache,
  normalizeInputRoutingStrategy,
  routeEvidenceDocuments,
} from '../../core/pipeline/evidence-routing.js';
import { SoulAggregator, SoulExtractor } from '../../core/soul/extractor.js';

export const DEFAULT_EXPERIMENT_PROFILES: TrainingProfile[] = ['baseline', 'a1', 'a2', 'a3', 'a4', 'full'];

export interface ExperimentRoundHistoryItem {
  round: number;
  avgQualityScore: number;
  contradictionRate: number;
  duplicationRate: number;
  nodesWritten: number;
  nodesReinforced: number;
}

export interface ExperimentRunResult {
  rows: ExperimentSummaryRow[];
  roundHistories: Record<string, ExperimentRoundHistoryItem[]>;
  failures?: Array<{ profile: TrainingProfile; error: string }>;
}

interface InputRoutingComparisonRow {
  label: string;
  profile: TrainingProfile;
  input_routing: InputRoutingStrategy;
  totalRounds: number;
  avgQuality: number;
  contradictionRate: number;
  duplicationRate: number;
  coverage: number;
  observability: InputRoutingObservability;
}

const EXPERIMENT_PROFILE_TIMEOUT_MS = Number(process.env.NEEKO_EXPERIMENT_PROFILE_TIMEOUT_MS ?? 90_000);

export async function runExperimentProfiles(
  slug: string,
  rounds: number,
  profiles: TrainingProfile[],
  options?: {
    timeoutMs?: number;
  }
): Promise<ExperimentRunResult> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const soulPath = join(dir, 'soul.yaml');

  if (!existsSync(personaPath) || !existsSync(soulPath)) {
    throw new Error(`Persona "${slug}" not found.`);
  }

  const basePersona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const baseSoul = yaml.load(readFileSync(soulPath, 'utf-8')) as Soul;
  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });

  const stamp = Date.now().toString(36);
  const rows: ExperimentSummaryRow[] = [];
  const roundHistories: Record<string, ExperimentRoundHistoryItem[]> = {};
  const failures: Array<{ profile: TrainingProfile; error: string }> = [];

  const profileTimeoutMs = Math.max(10_000, options?.timeoutMs ?? EXPERIMENT_PROFILE_TIMEOUT_MS);

  for (const profile of profiles) {
    const persona: Persona = {
      ...basePersona,
      id: crypto.randomUUID(),
      memory_collection: `${basePersona.memory_collection}_exp_${profile}_${stamp}`,
      training_rounds: 0,
      updated_at: new Date().toISOString(),
    };
    const soul: Soul = JSON.parse(JSON.stringify(baseSoul));
    soul.training_rounds_completed = 0;

    await store.ensureCollection(persona.memory_collection);

    const loop = new TrainingLoop(soul, persona, store);
    let result: Awaited<ReturnType<TrainingLoop['run']>> | null = null;
    try {
      result = await withTimeout(
        loop.run({ maxRounds: rounds, profile }),
        profileTimeoutMs,
        `experiment profile ${profile}`
      );
    } catch (error) {
      const message = String(error);
      failures.push({ profile, error: message });
      roundHistories[profile] = [];
      rows.push({
        profile,
        totalRounds: 0,
        avgQuality: 0,
        contradictionRate: 1,
        duplicationRate: 1,
        coverage: 0,
      });
      console.log(
        chalk.yellow(
          `${chalk.bold(profile.padEnd(8))} fast-fail: ${message.slice(0, 120)}`
        )
      );
      continue;
    }
    const history = result.history;
    roundHistories[profile] = history.map((h) => ({
      round: h.round,
      avgQualityScore: h.avgQualityScore,
      contradictionRate: h.observability.contradictionRate,
      duplicationRate: h.observability.duplicationRate,
      nodesWritten: h.nodesWritten,
      nodesReinforced: h.nodesReinforced,
    }));

    const avgQuality = history.length === 0 ? 0 : history.reduce((sum, h) => sum + h.avgQualityScore, 0) / history.length;
    const contradictionRate = history.length === 0
      ? 0
      : history.reduce((sum, h) => sum + h.observability.contradictionRate, 0) / history.length;
    const duplicationRate = history.length === 0
      ? 0
      : history.reduce((sum, h) => sum + h.observability.duplicationRate, 0) / history.length;

    rows.push({
      profile,
      totalRounds: result.totalRounds,
      avgQuality,
      contradictionRate,
      duplicationRate,
      coverage: result.soul.coverage_score,
    });

    console.log(
      `${chalk.bold(profile.padEnd(8))} rounds=${String(result.totalRounds).padEnd(3)} ` +
      `quality=${(avgQuality * 100).toFixed(1).padStart(5)}% ` +
      `contra=${(contradictionRate * 100).toFixed(1).padStart(5)}% ` +
      `dup=${(duplicationRate * 100).toFixed(1).padStart(5)}% ` +
      `coverage=${(result.soul.coverage_score * 100).toFixed(1).padStart(5)}%`
    );
  }

  return { rows, roundHistories, failures };
}

export async function cmdExperiment(
  slug: string,
  options: {
    rounds?: string;
    outputDir?: string;
    gate?: boolean;
    maxQualityDrop?: string;
    maxContradictionRise?: string;
    maxDuplicationRise?: string;
    inputRouting?: string;
    compareInputRouting?: boolean;
  }
): Promise<void> {
  const rounds = Math.max(1, parseInt(options.rounds ?? '10', 10));
  const inputRouting = normalizeInputRoutingStrategy(
    options.inputRouting,
    normalizeInputRoutingStrategy(String(settings.get('defaultInputRoutingStrategy') ?? 'legacy'))
  );

  const preflight = await runModelPreflight({
    timeoutMs: Number(process.env.NEEKO_PREFLIGHT_EXPERIMENT_TIMEOUT_MS ?? process.env.NEEKO_PREFLIGHT_TIMEOUT_MS ?? 15_000),
    requireStructured: true,
  });
  if (!preflight.ok) {
    throw new Error(`experiment preflight failed (${preflight.latencyMs}ms): ${preflight.reason ?? 'unknown'}`);
  }

  console.log(chalk.bold.cyan(`\n✦ Training Experiment (${slug})\n`));
  console.log(chalk.dim(`Rounds per profile: ${rounds}`));
  console.log(chalk.dim(`Profiles: ${DEFAULT_EXPERIMENT_PROFILES.join(', ')}\n`));

  const { rows, roundHistories, failures } = await runExperimentProfiles(slug, rounds, DEFAULT_EXPERIMENT_PROFILES);
  const inputRoutingComparison = options.compareInputRouting
    ? await runInputRoutingComparison(slug, rounds, 'full')
    : [];

  const best = [...rows].sort((a, b) => {
    const scoreA = a.avgQuality - a.contradictionRate * 0.2 - a.duplicationRate * 0.1;
    const scoreB = b.avgQuality - b.contradictionRate * 0.2 - b.duplicationRate * 0.1;
    return scoreB - scoreA;
  })[0];

  const outputDir = options.outputDir ? options.outputDir : join(settings.getPersonaDir(slug), 'experiments');
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outputDir, `experiment-${slug}-${timestamp}.json`);
  const csvPath = join(outputDir, `experiment-${slug}-${timestamp}.csv`);

  const gateResult = evaluateGate(rows, {
    enabled: options.gate === true,
    maxQualityDrop: parseFloat(options.maxQualityDrop ?? '0.02'),
    maxContradictionRise: parseFloat(options.maxContradictionRise ?? '0.03'),
    maxDuplicationRise: parseFloat(options.maxDuplicationRise ?? '0.05'),
    baselineProfile: 'baseline',
    compareProfile: 'full',
  });

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    slug,
    rounds_per_profile: rounds,
    profiles: DEFAULT_EXPERIMENT_PROFILES,
    summary_rows: rows,
    best_profile: best.profile,
    round_histories: roundHistories,
    failures: failures ?? [],
    input_routing_strategy: inputRouting,
    input_routing_comparison: inputRoutingComparison,
    gate_result: gateResult,
  };
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  const csvLines = [
    'profile,total_rounds,avg_quality,avg_contradiction_rate,avg_duplication_rate,coverage',
    ...rows.map((r) =>
      [
        r.profile,
        r.totalRounds,
        r.avgQuality.toFixed(6),
        r.contradictionRate.toFixed(6),
        r.duplicationRate.toFixed(6),
        r.coverage.toFixed(6),
      ].join(',')
    ),
  ];
  writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');

  console.log(chalk.dim(`JSON report: ${jsonPath}`));
  console.log(chalk.dim(`CSV report:  ${csvPath}`));
  if (inputRoutingComparison.length > 0) {
    console.log(chalk.dim('Input routing comparison:'));
    for (const row of inputRoutingComparison) {
      console.log(
        chalk.dim(
          `  ${row.label.padEnd(12)} quality=${(row.avgQuality * 100).toFixed(1)}% ` +
          `contra=${(row.contradictionRate * 100).toFixed(1)}% coverage=${(row.coverage * 100).toFixed(1)}% ` +
          `docs(s/m/d)=${row.observability.soul_docs}/${row.observability.memory_docs}/${row.observability.discard_docs}`
        )
      );
    }
  }

  if (gateResult.enabled) {
    if (gateResult.passed) {
      console.log(chalk.green(`Quality gate: passed (${gateResult.reason})`));
    } else {
      console.log(chalk.red(`Quality gate: failed (${gateResult.reason})`));
      process.exitCode = 2;
    }
  }

  console.log(chalk.green(`\nRecommended default profile: ${best.profile}\n`));
}

async function runInputRoutingComparison(
  slug: string,
  rounds: number,
  profile: TrainingProfile
): Promise<InputRoutingComparisonRow[]> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) return [];

  const basePersona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const docs = loadRawDocsCache(dir);
  if (docs.length === 0) {
    console.log(chalk.yellow('Skipping input routing comparison: raw-docs cache not found.'));
    return [];
  }

  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });
  const extractor = new SoulExtractor();
  const aggregator = new SoulAggregator();
  const strategies: InputRoutingStrategy[] = ['legacy', 'v2'];
  const rows: InputRoutingComparisonRow[] = [];

  for (const strategy of strategies) {
    const routed = routeEvidenceDocuments(docs, {
      strategy,
      targetSignals: [basePersona.name, basePersona.handle ?? '', ...basePersona.source_targets],
    });
    const persona: Persona = {
      ...basePersona,
      id: crypto.randomUUID(),
      memory_collection: `${basePersona.memory_collection}_routing_${strategy}_${Date.now().toString(36)}`,
      training_rounds: 0,
      updated_at: new Date().toISOString(),
    };
    await store.ensureCollection(persona.memory_collection);
    const soulSeed = createEmptySoul(basePersona.name, basePersona.handle);
    let soul = soulSeed;
    if (routed.soulChunks.length > 0) {
      const batchSize = Math.min(routed.soulChunks.length, 30);
      const extractions = await extractor.extractBatch(routed.soulChunks.slice(0, batchSize), basePersona.name);
      soul = aggregator.aggregate(soulSeed, extractions, routed.soulChunks.slice(0, batchSize));
    }

    const loop = new TrainingLoop(soul, persona, store);
    const result = await withTimeout(
      loop.run({ maxRounds: rounds, profile }),
      EXPERIMENT_PROFILE_TIMEOUT_MS,
      `input routing ${strategy}`
    );
    const history = result.history;
    const avgQuality = history.length === 0 ? 0 : history.reduce((sum, item) => sum + item.avgQualityScore, 0) / history.length;
    const contradictionRate = history.length === 0
      ? 0
      : history.reduce((sum, item) => sum + item.observability.contradictionRate, 0) / history.length;
    const duplicationRate = history.length === 0
      ? 0
      : history.reduce((sum, item) => sum + item.observability.duplicationRate, 0) / history.length;

    rows.push({
      label: `${profile}+${strategy}`,
      profile,
      input_routing: strategy,
      totalRounds: result.totalRounds,
      avgQuality,
      contradictionRate,
      duplicationRate,
      coverage: result.soul.coverage_score,
      observability: routed.observability,
    });
  }

  return rows;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

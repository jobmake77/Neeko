import chalk from 'chalk';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { resolvePreferredProviderName } from '../../config/model.js';
import { Persona } from '../../core/models/persona.js';
import { Soul } from '../../core/models/soul.js';
import { createEmptySoul } from '../../core/models/soul.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop } from '../../core/training/loop.js';
import { ExperimentSummaryRow, evaluateGate } from '../../core/training/ab-report.js';
import { TrainingProfile } from '../../core/training/types.js';
import { runModelPreflight } from '../../core/training/preflight.js';
import {
  loadTrainingSeedHints,
  normalizeTrainingSeedMode,
  TrainingSeedMode,
} from '../../core/training/training-seed.js';
import {
  InputRoutingObservability,
  InputRoutingStrategy,
  loadRawDocsCache,
  normalizeInputRoutingStrategy,
  routeEvidenceDocuments,
} from '../../core/pipeline/evidence-routing.js';
import { SoulAggregator, SoulExtractor } from '../../core/soul/extractor.js';
import { snapshotAndResetAgentFallbackMetrics } from '../../core/agents/index.js';
import {
  recommendInputRoutingStrategy,
  resolveTrainingExecutionSettings,
  resolveTrainingStrategy,
  selectSoulChunksForStrategy,
} from '../../core/training/strategy-resolver.js';

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
  training_seed_mode: TrainingSeedMode;
  soul_source: 'training_seed' | 'extractor' | 'empty';
  runtime_preset: string;
  optimization_mode: string;
  corpus_segment: string;
  decision_reason: string;
  totalRounds: number;
  avgQuality: number;
  contradictionRate: number;
  duplicationRate: number;
  coverage: number;
  observability: InputRoutingObservability;
  runtime_observability: {
    kimi_stability_mode: string;
    trainer_fallbacks: number;
    persona_fallbacks: number;
    evaluator_fallbacks: number;
    director_fallbacks: number;
  };
}

interface InputRoutingComparisonSummary {
  recommendation: ReturnType<typeof recommendInputRoutingStrategy> | null;
  rows: InputRoutingComparisonRow[];
}

const EXPERIMENT_PROFILE_TIMEOUT_MS = Number(process.env.NEEKO_EXPERIMENT_PROFILE_TIMEOUT_MS ?? 90_000);

export async function runExperimentProfiles(
  slug: string,
  rounds: number,
  profiles: TrainingProfile[],
  options?: {
    timeoutMs?: number;
    kimiStabilityMode?: string;
    trainingSeedMode?: string;
    questionsPerRound?: number;
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
  const providerName = resolvePreferredProviderName();
  const trainingSeedMode = normalizeTrainingSeedMode(options?.trainingSeedMode);
  const trainingSeedSelection = loadTrainingSeedHints(dir, trainingSeedMode);

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
    const executionSettings = resolveTrainingExecutionSettings({
      providerName,
      rounds,
      explicitKimiStabilityMode: options?.kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE,
    });
    let result: Awaited<ReturnType<TrainingLoop['run']>> | null = null;
    try {
      result = await withTimeout(
        loop.run({
          maxRounds: rounds,
          profile,
          questionsPerRound: Math.max(1, options?.questionsPerRound ?? 5),
          trainingSeedHints: trainingSeedSelection.hints,
          runtimePreset: executionSettings.runtimePreset,
          runtimeOverrides: executionSettings.runtimeOverrides,
          evaluatorLayered: executionSettings.evaluatorLayered,
          evaluatorDualReview: executionSettings.evaluatorDualReview,
          directorReviewInterval: executionSettings.directorReviewInterval,
          directorAlwaysOnFinalRound: executionSettings.directorAlwaysOnFinalRound,
        }),
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
    profiles?: string;
    rounds?: string;
    questionsPerRound?: string;
    outputDir?: string;
    gate?: boolean;
    maxQualityDrop?: string;
    maxContradictionRise?: string;
    maxDuplicationRise?: string;
    inputRouting?: string;
    trainingSeedMode?: string;
    skipProfileSweep?: boolean;
    compareInputRouting?: boolean;
    compareTrainingSeed?: boolean;
    compareVariants?: string;
    kimiStabilityMode?: string;
  }
): Promise<void> {
  const rounds = Math.max(1, parseInt(options.rounds ?? '10', 10));
  const questionsPerRound = Math.max(1, parseInt(options.questionsPerRound ?? '5', 10));
  const inputRouting = normalizeInputRoutingStrategy(
    options.inputRouting,
    normalizeInputRoutingStrategy(String(settings.get('defaultInputRoutingStrategy') ?? 'legacy'))
  );
  const profiles = parseExperimentProfiles(options.profiles);

  const preflight = await runModelPreflight({
    timeoutMs: Number(process.env.NEEKO_PREFLIGHT_EXPERIMENT_TIMEOUT_MS ?? process.env.NEEKO_PREFLIGHT_TIMEOUT_MS ?? 15_000),
    requireStructured: true,
  });
  if (!preflight.ok) {
    throw new Error(`experiment preflight failed (${preflight.latencyMs}ms): ${preflight.reason ?? 'unknown'}`);
  }

  console.log(chalk.bold.cyan(`\n✦ Training Experiment (${slug})\n`));
  console.log(chalk.dim(`Rounds per profile: ${rounds}`));
  console.log(chalk.dim(`Questions per round: ${questionsPerRound}`));
  console.log(chalk.dim(`Profiles: ${profiles.join(', ')}\n`));

  const providerName = resolvePreferredProviderName();
  const kimiStabilityMode = options.kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE;
  const trainingSeedMode = normalizeTrainingSeedMode(options.trainingSeedMode);

  const { rows, roundHistories, failures } = options.skipProfileSweep
    ? { rows: [], roundHistories: {}, failures: [] }
    : await runExperimentProfiles(slug, rounds, profiles, {
      kimiStabilityMode,
      trainingSeedMode,
      questionsPerRound,
    });
  const inputRoutingComparison = options.compareTrainingSeed
    ? await runInputRoutingComparison(
      slug,
      rounds,
      'full',
      kimiStabilityMode,
      true,
      questionsPerRound,
      parseComparisonVariants(options.compareVariants, true)
    )
    : options.compareInputRouting
      ? await runInputRoutingComparison(
        slug,
        rounds,
        'full',
        kimiStabilityMode,
        false,
        questionsPerRound,
        parseComparisonVariants(options.compareVariants, false)
      )
    : { rows: [], recommendation: null };

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
    profiles,
    questions_per_round: questionsPerRound,
    summary_rows: rows,
    best_profile: best?.profile ?? null,
    round_histories: roundHistories,
    failures: failures ?? [],
    input_routing_strategy: inputRouting,
    provider: providerName,
    kimi_stability_mode: kimiStabilityMode ?? 'auto',
    training_seed_mode: trainingSeedMode,
    input_routing_comparison: inputRoutingComparison.rows,
    input_routing_recommendation: inputRoutingComparison.recommendation,
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
  if (inputRoutingComparison.rows.length > 0) {
    console.log(chalk.dim('Input routing comparison:'));
    for (const row of inputRoutingComparison.rows) {
      console.log(
        chalk.dim(
          `  ${row.label.padEnd(20)} quality=${(row.avgQuality * 100).toFixed(1)}% ` +
          `contra=${(row.contradictionRate * 100).toFixed(1)}% coverage=${(row.coverage * 100).toFixed(1)}% ` +
          `docs(s/m/d)=${row.observability.soul_docs}/${row.observability.memory_docs}/${row.observability.discard_docs} ` +
          `seed=${row.training_seed_mode} soul=${row.soul_source} preset=${row.runtime_preset} opt=${row.optimization_mode} ` +
          `fb(e/d)=${row.runtime_observability.evaluator_fallbacks}/${row.runtime_observability.director_fallbacks}`
        )
      );
    }
    if (inputRoutingComparison.recommendation) {
      const rec = inputRoutingComparison.recommendation;
      console.log(
        chalk.cyan(
          `Recommended input routing: ${rec.recommendedStrategy} ` +
          `(shape=${rec.shape}, confidence=${rec.confidence.toFixed(2)})`
        )
      );
      console.log(chalk.dim(`  reason: ${rec.reason}`));
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

  if (best) {
    console.log(chalk.green(`\nRecommended default profile: ${best.profile}\n`));
  } else {
    console.log(chalk.yellow('\nNo successful profile rows were produced.\n'));
  }
}

async function runInputRoutingComparison(
  slug: string,
  rounds: number,
  profile: TrainingProfile,
  kimiStabilityMode?: string,
  compareTrainingSeed = false,
  questionsPerRound = 5,
  explicitVariants?: Array<{ strategy: InputRoutingStrategy; trainingSeedMode: TrainingSeedMode }>
): Promise<InputRoutingComparisonSummary> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) return { rows: [], recommendation: null };

  const basePersona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const docs = loadRawDocsCache(dir);
  if (docs.length === 0) {
    console.log(chalk.yellow('Skipping input routing comparison: raw-docs cache not found.'));
    return { rows: [], recommendation: null };
  }

  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });
  const extractor = new SoulExtractor();
  const aggregator = new SoulAggregator();
  const rows: InputRoutingComparisonRow[] = [];
  const providerName = resolvePreferredProviderName();
  const legacyBaseline = routeEvidenceDocuments(docs, {
    strategy: 'legacy',
    targetSignals: [basePersona.name, basePersona.handle ?? '', ...basePersona.source_targets],
  });
  const v2Baseline = routeEvidenceDocuments(docs, {
    strategy: 'v2',
    targetSignals: [basePersona.name, basePersona.handle ?? '', ...basePersona.source_targets],
  });
  let legacyObservability: InputRoutingObservability | undefined = legacyBaseline.observability;
  let v2Observability: InputRoutingObservability | undefined = v2Baseline.observability;
  const variants: Array<{ strategy: InputRoutingStrategy; trainingSeedMode: TrainingSeedMode }> = explicitVariants && explicitVariants.length > 0
    ? explicitVariants
    : compareTrainingSeed
    ? [
      { strategy: 'legacy', trainingSeedMode: 'off' },
      { strategy: 'v2', trainingSeedMode: 'off' },
      { strategy: 'v2', trainingSeedMode: 'topics' },
      { strategy: 'v2', trainingSeedMode: 'signals' },
    ]
    : [
      { strategy: 'legacy', trainingSeedMode: 'off' },
      { strategy: 'v2', trainingSeedMode: 'off' },
    ];

  for (const variant of variants) {
    const { strategy, trainingSeedMode } = variant;
    const routed = strategy === 'legacy' ? legacyBaseline : v2Baseline;
    const strategyDecision = resolveTrainingStrategy({
      inputRoutingStrategy: strategy,
      observability: routed.observability,
      rawDocCount: docs.length,
      providerName,
    });
    const executionSettings = resolveTrainingExecutionSettings({
      strategyDecision,
      providerName,
      rounds,
      explicitKimiStabilityMode: kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE,
    });
    const trainingSeedSelection = loadTrainingSeedHints(dir, trainingSeedMode);
    const persona: Persona = {
      ...basePersona,
      id: crypto.randomUUID(),
      memory_collection: `${basePersona.memory_collection}_routing_${strategy}_${trainingSeedMode}_${Date.now().toString(36)}`,
      training_rounds: 0,
      updated_at: new Date().toISOString(),
    };
    await store.ensureCollection(persona.memory_collection);
    const soulSeed = createEmptySoul(basePersona.name, basePersona.handle);
    const precomputedSeed = loadComparisonTrainingSeed(dir, strategy);
    let soul = precomputedSeed ? buildSyntheticSoulFromTrainingSeed(soulSeed, precomputedSeed) : soulSeed;
    let soulSource: InputRoutingComparisonRow['soul_source'] = precomputedSeed ? 'training_seed' : 'empty';
    if (!precomputedSeed) {
      const selectedSoulChunks = selectSoulChunksForStrategy(
        routed.soulChunks,
        routed.routedDocs.map((item) => ({ document_id: item.doc.id, score: item.score })),
        strategyDecision,
        Math.min(routed.soulChunks.length, strategyDecision.maxSoulChunks)
      );
      if (selectedSoulChunks.length > 0) {
        const extractions = await extractor.extractBatch(selectedSoulChunks, basePersona.name, strategyDecision.extractionConcurrency, {
          cacheEnabled: strategyDecision.extractorCacheEnabled,
          cachePath: `/tmp/neeko-soul-cache-${slug}-${strategy}.json`,
          timeoutMs: strategyDecision.extractionTimeoutMs,
          retries: strategyDecision.extractionRetries,
        });
        soul = aggregator.aggregate(soulSeed, extractions, selectedSoulChunks);
        soulSource = 'extractor';
      }
    }

    const loop = new TrainingLoop(soul, persona, store);
    snapshotAndResetAgentFallbackMetrics();
    const result = await withTimeout(
      loop.run({
        maxRounds: rounds,
        profile,
        questionsPerRound: Math.max(1, questionsPerRound),
        trainingSeedHints: trainingSeedSelection.hints,
        runtimePreset: executionSettings.runtimePreset,
        runtimeOverrides: executionSettings.runtimeOverrides,
        evaluatorLayered: executionSettings.evaluatorLayered,
        evaluatorDualReview: executionSettings.evaluatorDualReview,
        directorReviewInterval: executionSettings.directorReviewInterval,
        directorAlwaysOnFinalRound: executionSettings.directorAlwaysOnFinalRound,
      }),
      EXPERIMENT_PROFILE_TIMEOUT_MS,
      `input routing ${strategy}`
    );
    const fallbackMetrics = snapshotAndResetAgentFallbackMetrics();
    const history = result.history;
    const avgQuality = history.length === 0 ? 0 : history.reduce((sum, item) => sum + item.avgQualityScore, 0) / history.length;
    const contradictionRate = history.length === 0
      ? 0
      : history.reduce((sum, item) => sum + item.observability.contradictionRate, 0) / history.length;
    const duplicationRate = history.length === 0
      ? 0
      : history.reduce((sum, item) => sum + item.observability.duplicationRate, 0) / history.length;

    rows.push({
      label: `${profile}+${strategy}+${trainingSeedMode}`,
      profile,
      input_routing: strategy,
      training_seed_mode: trainingSeedMode,
      soul_source: soulSource,
      runtime_preset: strategyDecision.runtimePreset,
      optimization_mode: strategyDecision.optimizationMode,
      corpus_segment: strategyDecision.corpusSegment,
      decision_reason: strategyDecision.reason,
      totalRounds: result.totalRounds,
      avgQuality,
      contradictionRate,
      duplicationRate,
      coverage: result.soul.coverage_score,
      observability: routed.observability,
      runtime_observability: {
        kimi_stability_mode: executionSettings.kimiStabilityMode,
        trainer_fallbacks: fallbackMetrics.trainerFallbacks,
        persona_fallbacks: fallbackMetrics.personaFallbacks,
        evaluator_fallbacks: fallbackMetrics.evaluatorFallbacks,
        director_fallbacks: fallbackMetrics.directorFallbacks,
      },
    });
  }

  return {
    rows,
    recommendation: recommendInputRoutingStrategy({
      legacyObservability,
      v2Observability,
    }),
  };
}

function parseExperimentProfiles(raw?: string): TrainingProfile[] {
  if (!raw?.trim()) return DEFAULT_EXPERIMENT_PROFILES;
  const allowed = new Set<TrainingProfile>(DEFAULT_EXPERIMENT_PROFILES);
  const parsed = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is TrainingProfile => allowed.has(item as TrainingProfile));
  return parsed.length > 0 ? parsed : DEFAULT_EXPERIMENT_PROFILES;
}

function parseComparisonVariants(
  raw: string | undefined,
  compareTrainingSeed: boolean
): Array<{ strategy: InputRoutingStrategy; trainingSeedMode: TrainingSeedMode }> | undefined {
  if (!raw?.trim()) return undefined;

  const allowedStrategy = new Set<InputRoutingStrategy>(['legacy', 'v2']);
  const allowedSeed = new Set<TrainingSeedMode>(compareTrainingSeed ? ['off', 'topics', 'signals'] : ['off']);
  const parsed = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .map((item) => {
      const [strategyRaw, seedRaw = 'off'] = item.split(':');
      const strategy = allowedStrategy.has(strategyRaw as InputRoutingStrategy)
        ? strategyRaw as InputRoutingStrategy
        : null;
      const trainingSeedMode = allowedSeed.has(seedRaw as TrainingSeedMode)
        ? seedRaw as TrainingSeedMode
        : null;
      return strategy && trainingSeedMode ? { strategy, trainingSeedMode } : null;
    })
    .filter((item): item is { strategy: InputRoutingStrategy; trainingSeedMode: TrainingSeedMode } => Boolean(item));

  return parsed.length > 0 ? parsed : undefined;
}

interface ComparisonTrainingSeedAsset {
  stable_keywords?: string[];
  stable_topics?: string[];
  stable_signal_count?: number;
  topic_cluster_count?: number;
}

function loadComparisonTrainingSeed(
  dir: string,
  strategy: InputRoutingStrategy
): ComparisonTrainingSeedAsset | null {
  const preferred = join(dir, `training-seed-${strategy}.json`);
  const fallback = strategy === 'v2' ? join(dir, 'training-seed.json') : preferred;
  const path = existsSync(preferred) ? preferred : fallback;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ComparisonTrainingSeedAsset;
  } catch {
    return null;
  }
}

function buildSyntheticSoulFromTrainingSeed(base: Soul, seed: ComparisonTrainingSeedAsset): Soul {
  const topics = (seed.stable_topics ?? []).filter(Boolean).slice(0, 4);
  const keywords = (seed.stable_keywords ?? []).filter(Boolean).slice(0, 8);
  const updated = new Date().toISOString();
  return {
    ...base,
    updated_at: updated,
    data_sources: Array.from(new Set([...base.data_sources, 'training-seed'])),
    total_chunks_processed: Math.max(base.total_chunks_processed, seed.stable_signal_count ?? keywords.length),
    language_style: {
      ...base.language_style,
      frequent_phrases: keywords.slice(0, 6),
      vocabulary_preferences: keywords.slice(0, 4).map((value, index) => ({
        value,
        confidence: Math.max(0.35, 0.7 - index * 0.08),
        evidence_count: Math.max(1, (seed.stable_signal_count ?? keywords.length) - index),
      })),
    },
    values: {
      ...base.values,
      priorities: topics.slice(0, 3),
    },
    thinking_patterns: {
      ...base.thinking_patterns,
      problem_solving_approach: topics[0] ?? base.thinking_patterns.problem_solving_approach,
    },
    knowledge_domains: {
      ...base.knowledge_domains,
      expert: topics,
      familiar: keywords.slice(0, 4),
    },
    overall_confidence: Math.max(base.overall_confidence, topics.length > 0 ? 0.35 : 0.2),
    coverage_score: Math.max(base.coverage_score, Math.min(0.45, 0.12 + topics.length * 0.07 + keywords.length * 0.02)),
  };
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

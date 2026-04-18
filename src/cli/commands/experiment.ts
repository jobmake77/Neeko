import chalk from 'chalk';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { resolvePreferredModelOverride, resolvePreferredProviderName } from '../../config/model.js';
import { Persona } from '../../core/models/persona.js';
import { Soul } from '../../core/models/soul.js';
import { createEmptySoul } from '../../core/models/soul.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop, type TrainingProgress } from '../../core/training/loop.js';
import { ExperimentSummaryRow, evaluateGate } from '../../core/training/ab-report.js';
import {
  buildBenchmarkContext,
  buildBenchmarkFingerprints,
  buildEvaluationScorecard,
  buildFrozenCaseManifest,
  buildJudgeProvenance,
  classifyEvaluationRun,
  toFrozenQuestionRounds,
  type BenchmarkCaseEntry,
  type BenchmarkCaseManifest,
  type BenchmarkContext,
  type BenchmarkSuiteTier,
  type BenchmarkSuiteType,
  type EvaluationContamination,
  type EvaluationRunQuality,
  type EvaluationScorecard,
  type FrozenBenchmarkCaseManifest,
  type JudgeProvenance,
  type RuntimeFallbackSummary,
} from '../../core/training/evaluation-v2.js';
import { TrainingProfile, type TrainingQuestion } from '../../core/training/types.js';
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
import {
  buildStandaloneEvidenceBatch,
  loadEvidenceItemsFromFile,
} from '../../core/pipeline/evidence-layer.js';
import { buildEvidencePacks } from '../../core/pipeline/pack-builder.js';
import { planAdaptiveShards } from '../../core/pipeline/adaptive-shard-plan.js';
import { recommendDynamicScaling } from '../../core/pipeline/dynamic-scaling-recommendation.js';
import { SoulAggregator, SoulExtractor } from '../../core/soul/extractor.js';
import { snapshotAndResetAgentFallbackMetrics } from '../../core/agents/index.js';
import {
  recommendInputRoutingStrategy,
  resolveTrainingExecutionSettings,
  resolveTrainingStrategy,
  selectSoulChunksForStrategy,
  type TrainingExecutionSettings,
} from '../../core/training/strategy-resolver.js';
import { buildRoutingDecisionRecord, RoutingDecisionRecord } from '../../core/training/routing-decision.js';

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
  benchmarkCaseManifests: FrozenBenchmarkCaseManifest[];
  failures?: Array<{ profile: TrainingProfile; error: string }>;
}

interface InputRoutingComparisonRow {
  label: string;
  profile: TrainingProfile;
  input_routing: InputRoutingStrategy;
  requested_training_seed_mode: TrainingSeedMode;
  training_seed_mode: TrainingSeedMode;
  training_seed_gate?: {
    applied: boolean;
    ready: boolean;
    readiness_score: number;
    fallback_mode?: TrainingSeedMode;
    summary: string;
  };
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
  run_quality: EvaluationRunQuality;
  contamination: EvaluationContamination;
  scorecard: EvaluationScorecard;
  judge_provenance: JudgeProvenance;
  benchmark_context: BenchmarkContext;
  observability: InputRoutingObservability;
  scaling_observability?: {
    pack_count: number;
    avg_pack_tokens: number;
    stable_topic_growth: number;
    duplication_pressure: number;
    seed_maturity: number;
    adaptive_shard_count: number;
    adaptive_avg_pack_per_shard: number;
    adaptive_avg_tokens_per_shard: number;
    dynamic_scaling_state: string;
    dynamic_scaling_action: string;
    dynamic_scaling_confidence: number;
    dynamic_scaling_reason: string;
  };
  runtime_observability: RuntimeFallbackSummary & {
    kimi_stability_mode: string;
  };
}

interface InputRoutingComparisonSummary {
  recommendation: ReturnType<typeof recommendInputRoutingStrategy> | null;
  dynamicScalingRecommendation: ReturnType<typeof recommendDynamicScaling> | null;
  routingDecisionRecord: RoutingDecisionRecord | null;
  rows: InputRoutingComparisonRow[];
  benchmarkCaseManifests: FrozenBenchmarkCaseManifest[];
}

interface CurrentGrayPathRecommendation {
  version: string;
  safe_default: {
    input_routing: InputRoutingStrategy;
    training_seed_mode: TrainingSeedMode;
  };
  recommended_gray_path: {
    input_routing: InputRoutingStrategy;
    training_seed_mode: TrainingSeedMode;
  };
  summary: string;
  observed_best_variant?: {
    label: string;
    input_routing: InputRoutingStrategy;
    training_seed_mode: TrainingSeedMode;
    avg_quality: number;
    coverage: number;
    contradiction_rate: number;
    duplication_rate: number;
  };
}

interface BenchmarkReplayMeta {
  active: boolean;
  source_path?: string;
  replay_manifest_count?: number;
}

const EXPERIMENT_PROFILE_TIMEOUT_MS = Number(process.env.NEEKO_EXPERIMENT_PROFILE_TIMEOUT_MS ?? 90_000);
const EXPERIMENT_COMPARISON_TIMEOUT_MS = Number(process.env.NEEKO_EXPERIMENT_COMPARISON_TIMEOUT_MS ?? 0);

function selectCompatibleOfficialRows<T extends { run_quality?: EvaluationRunQuality }>(rows: T[]): T[] {
  const cleanRows = rows.filter((row) => row.run_quality === 'clean');
  return cleanRows.length > 0 ? cleanRows : rows;
}

function selectStrictOfficialRows<T extends { run_quality?: EvaluationRunQuality }>(rows: T[]): T[] {
  return rows.filter((row) => row.run_quality === 'clean');
}

function computeObservedBestProfile(rows: ExperimentSummaryRow[]): TrainingProfile | null {
  return [...rows].sort((a, b) => {
    const scoreA = a.avgQuality - a.contradictionRate * 0.2 - a.duplicationRate * 0.1;
    const scoreB = b.avgQuality - b.contradictionRate * 0.2 - b.duplicationRate * 0.1;
    return scoreB - scoreA;
  })[0]?.profile ?? null;
}

function collectBenchmarkManifests(
  rows: Array<{ benchmark_context?: BenchmarkContext | null }>
): BenchmarkCaseManifest[] {
  const manifests = new Map<string, BenchmarkCaseManifest>();
  for (const row of rows) {
    const manifest = row.benchmark_context?.case_manifest;
    if (!manifest) continue;
    manifests.set(manifest.manifest_id, manifest);
  }
  return [...manifests.values()];
}

function collectFrozenBenchmarkCaseManifests(
  manifests: FrozenBenchmarkCaseManifest[]
): FrozenBenchmarkCaseManifest[] {
  const deduped = new Map<string, FrozenBenchmarkCaseManifest>();
  for (const manifest of manifests) {
    deduped.set(manifest.manifest.manifest_id, manifest);
  }
  return [...deduped.values()];
}

export function loadBenchmarkCaseManifestsFromArtifact(artifactPath: string): FrozenBenchmarkCaseManifest[] {
  const resolvedPath = resolve(artifactPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`benchmark manifest artifact not found: ${resolvedPath}`);
  }
  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf-8')) as {
    benchmark_case_manifests?: FrozenBenchmarkCaseManifest[];
  };
  const manifests = Array.isArray(parsed?.benchmark_case_manifests) ? parsed.benchmark_case_manifests : [];
  if (manifests.length === 0) {
    throw new Error(`artifact does not contain benchmark_case_manifests: ${resolvedPath}`);
  }
  return manifests;
}

function buildBenchmarkCaseEntries(history: TrainingProgress[]): BenchmarkCaseEntry[] {
  return history.flatMap((item) =>
    item.question_trace.map((question, index) => ({
      case_id: `r${String(item.round).padStart(2, '0')}-q${String(index + 1).padStart(2, '0')}`,
      round: item.round,
      ordinal: index + 1,
      question: question.question,
      strategy: question.strategy,
      target_dimension: question.target_dimension,
      expected_challenge_level: question.expected_challenge_level,
    }))
  );
}

function inferSuiteTypeFromManifest(manifest: FrozenBenchmarkCaseManifest): BenchmarkSuiteType {
  const suiteType = String(manifest.manifest.suite_label ?? '').split(':')[0];
  if (
    suiteType === 'profile_sweep' ||
    suiteType === 'routing_compare' ||
    suiteType === 'smoke_pk' ||
    suiteType === 'ab_regression'
  ) {
    return suiteType;
  }
  throw new Error(`unsupported benchmark suite type in manifest "${manifest.manifest.manifest_id}"`);
}

function buildReplayManifestIndex(manifests?: FrozenBenchmarkCaseManifest[]): Map<string, FrozenBenchmarkCaseManifest> | null {
  if (!Array.isArray(manifests) || manifests.length === 0) return null;
  const index = new Map<string, FrozenBenchmarkCaseManifest>();
  for (const manifest of manifests) {
    const key = `${inferSuiteTypeFromManifest(manifest)}:${manifest.manifest.flavor}`;
    if (index.has(key)) {
      throw new Error(`duplicate frozen benchmark manifest for replay key "${key}"`);
    }
    index.set(key, manifest);
  }
  return index;
}

function findReplayManifest(
  replayManifestIndex: Map<string, FrozenBenchmarkCaseManifest> | null,
  suiteType: BenchmarkSuiteType,
  flavor: string
): FrozenBenchmarkCaseManifest | null {
  if (!replayManifestIndex) return null;
  const replayManifest = replayManifestIndex.get(`${suiteType}:${flavor}`) ?? null;
  if (!replayManifest) {
    throw new Error(`benchmark replay manifest missing for ${suiteType}:${flavor}`);
  }
  return replayManifest;
}

function summarizeReplayQuestionRounds(questionRounds: TrainingQuestion[][]): { rounds: number; questionsPerRound: number } {
  const rounds = questionRounds.length;
  const questionsPerRound = questionRounds.reduce((best, round) => Math.max(best, round.length), 0);
  return {
    rounds,
    questionsPerRound: Math.max(1, questionsPerRound),
  };
}

function inferReplayReportShape(
  manifests: FrozenBenchmarkCaseManifest[]
): { rounds: number; questionsPerRound: number } | null {
  if (manifests.length === 0) return null;
  const shapes = new Map<string, { rounds: number; questionsPerRound: number }>();
  for (const manifest of manifests) {
    const shape = summarizeReplayQuestionRounds(toFrozenQuestionRounds(manifest));
    shapes.set(`${shape.rounds}x${shape.questionsPerRound}`, shape);
  }
  return shapes.size === 1 ? [...shapes.values()][0] : null;
}

function buildExperimentFreezeFingerprints(input: {
  providerName?: string;
  executionSettings: TrainingExecutionSettings;
}) {
  const generalModel = resolvePreferredModelOverride();
  const chatModel = resolvePreferredModelOverride('chat');
  const trainingModel = resolvePreferredModelOverride('training');

  return buildBenchmarkFingerprints({
    provider: {
      provider_name: input.providerName ?? trainingModel?.provider ?? generalModel?.provider ?? 'unknown',
      general: generalModel ?? null,
      chat: chatModel ?? null,
      training: trainingModel ?? null,
    },
    runtime: {
      runtime_preset: input.executionSettings.runtimePreset,
      runtime_overrides: input.executionSettings.runtimeOverrides ?? null,
      kimi_stability_mode: input.executionSettings.kimiStabilityMode,
      kimi_stability_reason: input.executionSettings.kimiStabilityReason,
      director_review_interval: input.executionSettings.directorReviewInterval,
      director_always_on_final_round: input.executionSettings.directorAlwaysOnFinalRound,
    },
    judge: {
      evaluator_layered: input.executionSettings.evaluatorLayered,
      evaluator_dual_review: Boolean(input.executionSettings.evaluatorDualReview),
      calibration_version: 'evaluation-rubric-v1-mini',
      calibration_examples: 3,
    },
  });
}

function buildExperimentBenchmarkArtifacts(input: {
  slug: string;
  suiteType: BenchmarkSuiteType;
  suiteTier?: BenchmarkSuiteTier;
  profile?: string;
  variant?: string;
  rounds: number;
  questionsPerRound: number;
  smokeMode?: boolean;
  replicaGroup?: string;
  replicaId?: string;
  history?: TrainingProgress[];
  providerName?: string;
  executionSettings: TrainingExecutionSettings;
}): {
  benchmarkContext: BenchmarkContext;
  benchmarkCaseManifest: FrozenBenchmarkCaseManifest | null;
} {
  const cases = buildBenchmarkCaseEntries(input.history ?? []);
  if (cases.length === 0) {
    return {
      benchmarkContext: buildBenchmarkContext({
        slug: input.slug,
        suiteType: input.suiteType,
        suiteTier: input.suiteTier,
        profile: input.profile,
        variant: input.variant,
        rounds: input.rounds,
        questionsPerRound: input.questionsPerRound,
        smokeMode: input.smokeMode,
        replicaGroup: input.replicaGroup,
        replicaId: input.replicaId,
      }),
      benchmarkCaseManifest: null,
    };
  }

  const benchmarkCaseManifest = buildFrozenCaseManifest({
    slug: input.slug,
    suiteType: input.suiteType,
    suiteTier: input.suiteTier,
    profile: input.profile,
    variant: input.variant,
    rounds: input.rounds,
    questionsPerRound: input.questionsPerRound,
    smokeMode: input.smokeMode,
    replicaGroup: input.replicaGroup,
    replicaId: input.replicaId,
    cases,
    freezeFingerprints: buildExperimentFreezeFingerprints({
      providerName: input.providerName,
      executionSettings: input.executionSettings,
    }),
  });

  return {
    benchmarkContext: buildBenchmarkContext({
      slug: input.slug,
      suiteType: input.suiteType,
      suiteTier: input.suiteTier,
      profile: input.profile,
      variant: input.variant,
      rounds: input.rounds,
      questionsPerRound: input.questionsPerRound,
      smokeMode: input.smokeMode,
      replicaGroup: input.replicaGroup,
      replicaId: input.replicaId,
      caseManifest: benchmarkCaseManifest.manifest,
    }),
    benchmarkCaseManifest,
  };
}

function toRuntimeObservabilitySnapshot(input: {
  trainerFallbacks: number;
  personaFallbacks: number;
  evaluatorFallbacks: number;
  directorFallbacks: number;
}): RuntimeFallbackSummary {
  return {
    trainer_fallbacks: input.trainerFallbacks,
    persona_fallbacks: input.personaFallbacks,
    evaluator_fallbacks: input.evaluatorFallbacks,
    director_fallbacks: input.directorFallbacks,
  };
}

export async function runExperimentProfiles(
  slug: string,
  rounds: number,
  profiles: TrainingProfile[],
  options?: {
    timeoutMs?: number;
    kimiStabilityMode?: string;
    trainingSeedMode?: string;
    questionsPerRound?: number;
    benchmarkCaseManifests?: FrozenBenchmarkCaseManifest[];
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
  const benchmarkCaseManifests: FrozenBenchmarkCaseManifest[] = [];
  const failures: Array<{ profile: TrainingProfile; error: string }> = [];
  const providerName = resolvePreferredProviderName();
  const trainingSeedMode = normalizeTrainingSeedMode(options?.trainingSeedMode);
  const trainingSeedSelection = loadTrainingSeedHints(dir, trainingSeedMode);
  const replayManifestIndex = buildReplayManifestIndex(options?.benchmarkCaseManifests);

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
    const replayManifest = findReplayManifest(replayManifestIndex, 'profile_sweep', profile);
    const replayQuestionRounds = replayManifest ? toFrozenQuestionRounds(replayManifest) : null;
    const replayConfig = replayQuestionRounds ? summarizeReplayQuestionRounds(replayQuestionRounds) : null;
    const effectiveRounds = replayConfig?.rounds ?? rounds;
    const questionsPerRound = replayConfig?.questionsPerRound ?? Math.max(1, options?.questionsPerRound ?? 5);
    const executionSettings = resolveTrainingExecutionSettings({
      providerName,
      rounds: effectiveRounds,
      explicitKimiStabilityMode: options?.kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE,
    });
    let result: Awaited<ReturnType<TrainingLoop['run']>> | null = null;
    snapshotAndResetAgentFallbackMetrics();
    try {
      result = await withTimeout(
        loop.run({
          maxRounds: effectiveRounds,
          profile,
          questionsPerRound,
          frozenQuestionRounds: replayQuestionRounds ?? undefined,
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
      const runtimeObservability = snapshotAndResetAgentFallbackMetrics();
      const runtimeSnapshot = toRuntimeObservabilitySnapshot(runtimeObservability);
      const judgeProvenance = buildJudgeProvenance({
        layeredMode: executionSettings.evaluatorLayered,
        dualReviewRequested: executionSettings.evaluatorDualReview,
        evaluatorFallbacks: runtimeObservability.evaluatorFallbacks,
      });
      const contamination = classifyEvaluationRun({
        totalRounds: 0,
        runtimeObservability: runtimeSnapshot,
        judgeProvenance,
        failureError: message,
      });
      const benchmarkArtifacts = buildExperimentBenchmarkArtifacts({
        slug,
        suiteType: 'profile_sweep',
        profile,
        rounds: effectiveRounds,
        questionsPerRound,
        smokeMode: effectiveRounds === 1 && questionsPerRound === 1,
        providerName,
        executionSettings,
      });
      failures.push({ profile, error: message });
      roundHistories[profile] = [];
      rows.push({
        profile,
        totalRounds: 0,
        avgQuality: 0,
        contradictionRate: 1,
        duplicationRate: 1,
        coverage: 0,
        run_quality: contamination.status,
        contamination,
        scorecard: buildEvaluationScorecard({
          avgQuality: 0,
          contradictionRate: 1,
          duplicationRate: 1,
          coverage: 0,
          runQuality: contamination.status,
          runtimeObservability: runtimeSnapshot,
        }),
        judge_provenance: judgeProvenance,
        benchmark_context: benchmarkArtifacts.benchmarkContext,
        runtime_observability: runtimeSnapshot,
      });
      console.log(
        chalk.yellow(
          `${chalk.bold(profile.padEnd(8))} fast-fail: ${message.slice(0, 120)}`
        )
      );
      continue;
    }
    const runtimeObservability = snapshotAndResetAgentFallbackMetrics();
    const runtimeSnapshot = toRuntimeObservabilitySnapshot(runtimeObservability);
    const judgeProvenance = buildJudgeProvenance({
      layeredMode: executionSettings.evaluatorLayered,
      dualReviewRequested: executionSettings.evaluatorDualReview,
      evaluatorFallbacks: runtimeObservability.evaluatorFallbacks,
    });
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
    const contamination = classifyEvaluationRun({
      totalRounds: result.totalRounds,
      runtimeObservability: runtimeSnapshot,
      judgeProvenance,
    });
    const benchmarkArtifacts = buildExperimentBenchmarkArtifacts({
      slug,
      suiteType: 'profile_sweep',
      profile,
      rounds: effectiveRounds,
      questionsPerRound,
      smokeMode: effectiveRounds === 1 && questionsPerRound === 1,
      history,
      providerName,
      executionSettings,
    });
    if (benchmarkArtifacts.benchmarkCaseManifest) {
      benchmarkCaseManifests.push(benchmarkArtifacts.benchmarkCaseManifest);
    }

    rows.push({
      profile,
      totalRounds: result.totalRounds,
      avgQuality,
      contradictionRate,
      duplicationRate,
      coverage: result.soul.coverage_score,
      run_quality: contamination.status,
      contamination,
      scorecard: buildEvaluationScorecard({
        avgQuality,
        contradictionRate,
        duplicationRate,
        coverage: result.soul.coverage_score,
        runQuality: contamination.status,
        runtimeObservability: runtimeSnapshot,
      }),
      judge_provenance: judgeProvenance,
      benchmark_context: benchmarkArtifacts.benchmarkContext,
      runtime_observability: runtimeSnapshot,
    });

    console.log(
      `${chalk.bold(profile.padEnd(8))} rounds=${String(result.totalRounds).padEnd(3)} ` +
      `quality=${(avgQuality * 100).toFixed(1).padStart(5)}% ` +
      `contra=${(contradictionRate * 100).toFixed(1).padStart(5)}% ` +
      `dup=${(duplicationRate * 100).toFixed(1).padStart(5)}% ` +
      `coverage=${(result.soul.coverage_score * 100).toFixed(1).padStart(5)}% ` +
      `status=${contamination.status}`
    );
  }

  return {
    rows,
    roundHistories,
    benchmarkCaseManifests: collectFrozenBenchmarkCaseManifests(benchmarkCaseManifests),
    failures,
  };
}

export async function cmdExperiment(
  slug: string,
  options: {
    profiles?: string;
    rounds?: string;
    questionsPerRound?: string;
    benchmarkManifest?: string;
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
    throw new Error(
      `experiment preflight failed (provider=${preflight.providerName}, stage=${preflight.failureStage ?? 'unknown'}, category=${preflight.failureCategory ?? 'unknown'}, ${preflight.latencyMs}ms): ${preflight.reason ?? 'unknown'}`
    );
  }

  console.log(chalk.bold.cyan(`\n✦ Training Experiment (${slug})\n`));
  console.log(chalk.dim(`Rounds per profile: ${rounds}`));
  console.log(chalk.dim(`Questions per round: ${questionsPerRound}`));
  console.log(chalk.dim(`Profiles: ${profiles.join(', ')}\n`));

  const providerName = resolvePreferredProviderName();
  const kimiStabilityMode = options.kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE;
  const trainingSeedMode = normalizeTrainingSeedMode(options.trainingSeedMode);
  const replayBenchmarkCaseManifests = options.benchmarkManifest
    ? loadBenchmarkCaseManifestsFromArtifact(options.benchmarkManifest)
    : [];
  const benchmarkReplayMeta: BenchmarkReplayMeta = options.benchmarkManifest
    ? {
      active: true,
      source_path: resolve(options.benchmarkManifest),
      replay_manifest_count: replayBenchmarkCaseManifests.length,
    }
    : {
      active: false,
    };

  if (benchmarkReplayMeta.active) {
    console.log(
      chalk.dim(
        `Replay benchmark source: ${benchmarkReplayMeta.source_path} (${benchmarkReplayMeta.replay_manifest_count} frozen manifest(s))`
      )
    );
  }

  const { rows, roundHistories, benchmarkCaseManifests: profileBenchmarkCaseManifests, failures } = options.skipProfileSweep
    ? { rows: [], roundHistories: {}, benchmarkCaseManifests: [], failures: [] }
    : await runExperimentProfiles(slug, rounds, profiles, {
      kimiStabilityMode,
      trainingSeedMode,
      questionsPerRound,
      benchmarkCaseManifests: replayBenchmarkCaseManifests,
    });
  const inputRoutingComparison = options.compareTrainingSeed
    ? await runInputRoutingComparison(
      slug,
      rounds,
      'full',
      kimiStabilityMode,
        true,
        questionsPerRound,
        parseComparisonVariants(options.compareVariants, true),
        replayBenchmarkCaseManifests
      )
    : options.compareInputRouting
      ? await runInputRoutingComparison(
        slug,
        rounds,
        'full',
        kimiStabilityMode,
        false,
        questionsPerRound,
        parseComparisonVariants(options.compareVariants, false),
        replayBenchmarkCaseManifests
    )
    : {
      rows: [],
      recommendation: null,
      dynamicScalingRecommendation: null,
      routingDecisionRecord: null,
      benchmarkCaseManifests: [],
    };

  const strictOfficialSummaryRows = selectStrictOfficialRows(rows);
  const strictOfficialComparisonRows = selectStrictOfficialRows(inputRoutingComparison.rows);
  const compatibleOfficialSummaryRows = selectCompatibleOfficialRows(rows);
  const compatibleOfficialComparisonRows = selectCompatibleOfficialRows(inputRoutingComparison.rows);
  const best = [...compatibleOfficialSummaryRows].sort((a, b) => {
    const scoreA = a.avgQuality - a.contradictionRate * 0.2 - a.duplicationRate * 0.1;
    const scoreB = b.avgQuality - b.contradictionRate * 0.2 - b.duplicationRate * 0.1;
    return scoreB - scoreA;
  })[0];
  const primaryComparisonRow = rows.length === 0 && compatibleOfficialComparisonRows.length === 1
    ? compatibleOfficialComparisonRows[0]
    : null;
  const effectiveInputRouting = primaryComparisonRow?.input_routing ?? inputRouting;
  const effectiveTrainingSeedMode = primaryComparisonRow?.training_seed_mode ?? trainingSeedMode;
  const effectiveBestProfile = best?.profile ?? primaryComparisonRow?.profile ?? null;
  const currentGrayPathRecommendation = buildCurrentGrayPathRecommendation(inputRoutingComparison.rows);
  const observedBestProfile = computeObservedBestProfile(rows);
  const benchmarkCaseManifests = collectFrozenBenchmarkCaseManifests([
    ...profileBenchmarkCaseManifests,
    ...inputRoutingComparison.benchmarkCaseManifests,
  ]);
  const replayReportShape = inferReplayReportShape(benchmarkCaseManifests);
  const reportRounds = replayReportShape?.rounds ?? rounds;
  const reportQuestionsPerRound = replayReportShape?.questionsPerRound ?? questionsPerRound;
  const benchmarkManifests = benchmarkCaseManifests.length > 0
    ? benchmarkCaseManifests.map((item) => item.manifest)
    : collectBenchmarkManifests([...rows, ...inputRoutingComparison.rows]);
  const strictOfficialAvailable =
    strictOfficialSummaryRows.length > 0 ||
    strictOfficialComparisonRows.length > 0;

  const outputDir = options.outputDir ? options.outputDir : join(settings.getPersonaDir(slug), 'experiments');
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outputDir, `experiment-${slug}-${timestamp}.json`);
  const csvPath = join(outputDir, `experiment-${slug}-${timestamp}.csv`);
  const manifestPath = join(outputDir, `experiment-${slug}-${timestamp}.benchmark-manifest.json`);

  const gateResult = evaluateGate(rows, {
    enabled: options.gate === true,
    maxQualityDrop: parseFloat(options.maxQualityDrop ?? '0.02'),
    maxContradictionRise: parseFloat(options.maxContradictionRise ?? '0.03'),
    maxDuplicationRise: parseFloat(options.maxDuplicationRise ?? '0.05'),
    baselineProfile: 'baseline',
    compareProfile: 'full',
  });

  const report = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    slug,
    rounds_per_profile: reportRounds,
    profiles,
    questions_per_round: reportQuestionsPerRound,
    summary_rows: rows,
    official_summary_rows: strictOfficialSummaryRows,
    best_profile: effectiveBestProfile,
    observed_best_profile: observedBestProfile,
    round_histories: roundHistories,
    failures: failures ?? [],
    input_routing_strategy: effectiveInputRouting,
    provider: providerName,
    kimi_stability_mode: kimiStabilityMode ?? 'auto',
    training_seed_mode: effectiveTrainingSeedMode,
    input_routing_comparison: inputRoutingComparison.rows,
    official_input_routing_comparison: strictOfficialComparisonRows,
    input_routing_recommendation: inputRoutingComparison.recommendation,
    dynamic_scaling_recommendation: inputRoutingComparison.dynamicScalingRecommendation,
    routing_decision_record: inputRoutingComparison.routingDecisionRecord,
    current_gray_path_recommendation: currentGrayPathRecommendation,
    benchmark_manifests: benchmarkManifests,
    benchmark_case_manifests: benchmarkCaseManifests,
    benchmark_replay: benchmarkReplayMeta,
    artifact_refs: {
      benchmark_manifest_path: manifestPath,
      report_path: jsonPath,
      report_csv_path: csvPath,
    },
    evaluation_v2: {
      version: 'evaluation-v2-p2',
      smoke_mode: reportRounds === 1 && reportQuestionsPerRound === 1,
      official_status: strictOfficialAvailable ? 'available' : 'unavailable',
      official_best_profile: effectiveBestProfile,
      observed_best_profile: observedBestProfile,
      official_run_count:
        strictOfficialSummaryRows.length + strictOfficialComparisonRows.length,
      contaminated_run_count:
        rows.filter((row) => row.run_quality === 'contaminated').length +
        inputRoutingComparison.rows.filter((row) => row.run_quality === 'contaminated').length,
      failed_run_count:
        rows.filter((row) => row.run_quality === 'failed').length +
        inputRoutingComparison.rows.filter((row) => row.run_quality === 'failed').length,
      inconclusive_run_count:
        rows.filter((row) => row.run_quality === 'inconclusive').length +
        inputRoutingComparison.rows.filter((row) => row.run_quality === 'inconclusive').length,
      compatible_official_fallback_used:
        compatibleOfficialSummaryRows.length !== strictOfficialSummaryRows.length ||
        compatibleOfficialComparisonRows.length !== strictOfficialComparisonRows.length,
      suite_types_present: [...new Set(benchmarkManifests.map((item) => item.suite_label.split(':')[0]))],
      suite_tiers_present: [...new Set(benchmarkManifests.map((item) => item.suite_tier))],
    },
    gate_result: gateResult,
  };
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schema_version: 2,
        version: 'evaluation-v2-p2',
        generated_at: report.generated_at,
        slug,
        benchmark_manifests: benchmarkManifests,
        benchmark_case_manifests: benchmarkCaseManifests,
        benchmark_replay: benchmarkReplayMeta,
      },
      null,
      2
    ),
    'utf-8'
  );

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
  console.log(chalk.dim(`Manifest:    ${manifestPath}`));
  if (inputRoutingComparison.rows.length > 0) {
    console.log(chalk.dim('Input routing comparison:'));
    for (const row of inputRoutingComparison.rows) {
      console.log(
        chalk.dim(
          `  ${row.label.padEnd(20)} quality=${(row.avgQuality * 100).toFixed(1)}% ` +
          `contra=${(row.contradictionRate * 100).toFixed(1)}% coverage=${(row.coverage * 100).toFixed(1)}% ` +
          `docs(s/m/d)=${row.observability.soul_docs}/${row.observability.memory_docs}/${row.observability.discard_docs} ` +
          `packs=${row.scaling_observability?.pack_count ?? 0} shards=${row.scaling_observability?.adaptive_shard_count ?? 0} ` +
          `scale=${row.scaling_observability?.dynamic_scaling_state ?? 'n/a'}/${row.scaling_observability?.dynamic_scaling_action ?? 'n/a'} ` +
          `seed=${row.requested_training_seed_mode === row.training_seed_mode ? row.training_seed_mode : `${row.requested_training_seed_mode}->${row.training_seed_mode}`} ` +
          `soul=${row.soul_source} preset=${row.runtime_preset} opt=${row.optimization_mode} ` +
          `fb(e/d)=${row.runtime_observability.evaluator_fallbacks}/${row.runtime_observability.director_fallbacks} ` +
          `status=${row.run_quality}`
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
    if (inputRoutingComparison.dynamicScalingRecommendation) {
      const rec = inputRoutingComparison.dynamicScalingRecommendation;
      console.log(
        chalk.cyan(
          `Dynamic scaling recommendation: ${rec.state} -> ${rec.recommended_action} ` +
          `(confidence=${rec.confidence.toFixed(2)})`
        )
      );
      console.log(chalk.dim(`  reason: ${rec.reason}`));
    }
    if (inputRoutingComparison.routingDecisionRecord) {
      const record = inputRoutingComparison.routingDecisionRecord;
      console.log(
        chalk.cyan(
          `Local account/stage decision: account=${record.account_type} stage=${record.stage_type} ` +
          `recommend=${record.recommended_routing.input_routing}+${record.recommended_routing.training_seed_mode} ` +
          `(confidence=${record.confidence.toFixed(2)})`
        )
      );
      console.log(chalk.dim(`  reason: ${record.reason}`));
      if (record.excluded_runs.length > 0) {
        console.log(
          chalk.dim(
            `  excluded runs: ${record.excluded_runs.map((item) => `${item.label} (${item.reason})`).join('; ')}`
          )
        );
      }
    }
    console.log(
      chalk.green(
        `Global recommended gray path: ${currentGrayPathRecommendation.recommended_gray_path.input_routing} + ${currentGrayPathRecommendation.recommended_gray_path.training_seed_mode}`
      )
    );
    console.log(
      chalk.dim(
        `  safe default remains ${currentGrayPathRecommendation.safe_default.input_routing} + ${currentGrayPathRecommendation.safe_default.training_seed_mode}`
      )
    );
    console.log(chalk.dim(`  summary: ${currentGrayPathRecommendation.summary}`));
    if (currentGrayPathRecommendation.observed_best_variant) {
      const bestVariant = currentGrayPathRecommendation.observed_best_variant;
      console.log(
        chalk.dim(
          `  observed best in this run: ${bestVariant.label} ` +
          `quality=${(bestVariant.avg_quality * 100).toFixed(1)}% coverage=${(bestVariant.coverage * 100).toFixed(1)}%`
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

  if (best) {
    console.log(chalk.green(`\nRecommended default profile: ${best.profile}\n`));
  } else if (inputRoutingComparison.rows.length > 0) {
    console.log(chalk.dim('\nProfile sweep skipped; input routing comparison completed successfully.\n'));
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
  explicitVariants?: Array<{ strategy: InputRoutingStrategy; trainingSeedMode: TrainingSeedMode }>,
  replayBenchmarkCaseManifests?: FrozenBenchmarkCaseManifest[]
): Promise<InputRoutingComparisonSummary> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) {
    return {
      rows: [],
      recommendation: null,
      dynamicScalingRecommendation: null,
      routingDecisionRecord: null,
      benchmarkCaseManifests: [],
    };
  }

  const basePersona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const docs = loadRawDocsCache(dir);
  if (docs.length === 0) {
    console.log(chalk.yellow('Skipping input routing comparison: raw-docs cache not found.'));
    return {
      rows: [],
      recommendation: null,
      dynamicScalingRecommendation: null,
      routingDecisionRecord: null,
      benchmarkCaseManifests: [],
    };
  }

  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });
  const extractor = new SoulExtractor();
  const aggregator = new SoulAggregator();
  const rows: InputRoutingComparisonRow[] = [];
  const producedBenchmarkCaseManifests: FrozenBenchmarkCaseManifest[] = [];
  const providerName = resolvePreferredProviderName();
  const replayManifestIndex = buildReplayManifestIndex(replayBenchmarkCaseManifests);
  const comparisonTimeoutMs = resolveComparisonTimeoutMs(docs.length, rounds);
  const evidenceItems = loadEvidenceItemsFromFile(join(dir, 'evidence-index.jsonl'));
  const packSourceItems = evidenceItems.length > 0 ? evidenceItems : buildStandaloneEvidenceBatch(docs).items;
  const packBuild = buildEvidencePacks(packSourceItems, { personaSlug: basePersona.slug });
  const adaptiveShardPlan = planAdaptiveShards(packBuild.packs, { personaSlug: basePersona.slug });
  const dynamicScalingRecommendation = recommendDynamicScaling(packBuild.metrics, adaptiveShardPlan, {
    personaSlug: basePersona.slug,
  });
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
    const trainingSeedSelection = loadTrainingSeedHints(dir, trainingSeedMode);
    const replayManifest = findReplayManifest(
      replayManifestIndex,
      'routing_compare',
      `${strategy}:${trainingSeedSelection.mode}`
    );
    const replayQuestionRounds = replayManifest ? toFrozenQuestionRounds(replayManifest) : null;
    const replayConfig = replayQuestionRounds ? summarizeReplayQuestionRounds(replayQuestionRounds) : null;
    const effectiveRounds = replayConfig?.rounds ?? rounds;
    const effectiveQuestionsPerRound = replayConfig?.questionsPerRound ?? Math.max(1, questionsPerRound);
    const executionSettings = resolveTrainingExecutionSettings({
      strategyDecision,
      providerName,
      rounds: effectiveRounds,
      explicitKimiStabilityMode: kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE,
    });
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
    try {
      const result = await withTimeout(
        loop.run({
          maxRounds: effectiveRounds,
          profile,
          questionsPerRound: effectiveQuestionsPerRound,
          frozenQuestionRounds: replayQuestionRounds ?? undefined,
          trainingSeedHints: trainingSeedSelection.hints,
          runtimePreset: executionSettings.runtimePreset,
          runtimeOverrides: executionSettings.runtimeOverrides,
          evaluatorLayered: executionSettings.evaluatorLayered,
          evaluatorDualReview: executionSettings.evaluatorDualReview,
          directorReviewInterval: executionSettings.directorReviewInterval,
          directorAlwaysOnFinalRound: executionSettings.directorAlwaysOnFinalRound,
        }),
        comparisonTimeoutMs,
        `input routing ${strategy}/${trainingSeedMode}`
      );
      const fallbackMetrics = snapshotAndResetAgentFallbackMetrics();
      const judgeProvenance = buildJudgeProvenance({
        layeredMode: executionSettings.evaluatorLayered,
        dualReviewRequested: executionSettings.evaluatorDualReview,
        evaluatorFallbacks: fallbackMetrics.evaluatorFallbacks,
      });
      const history = result.history;
      const avgQuality = history.length === 0 ? 0 : history.reduce((sum, item) => sum + item.avgQualityScore, 0) / history.length;
      const contradictionRate = history.length === 0
        ? 0
        : history.reduce((sum, item) => sum + item.observability.contradictionRate, 0) / history.length;
      const duplicationRate = history.length === 0
        ? 0
        : history.reduce((sum, item) => sum + item.observability.duplicationRate, 0) / history.length;
      const contamination = classifyEvaluationRun({
        totalRounds: result.totalRounds,
        runtimeObservability: fallbackMetrics,
        judgeProvenance,
      });
      const benchmarkArtifacts = buildExperimentBenchmarkArtifacts({
        slug,
        suiteType: 'routing_compare',
        variant: `${strategy}:${trainingSeedSelection.mode}`,
        rounds: effectiveRounds,
        questionsPerRound: effectiveQuestionsPerRound,
        smokeMode: effectiveRounds === 1 && effectiveQuestionsPerRound === 1,
        history,
        providerName,
        executionSettings,
      });
      if (benchmarkArtifacts.benchmarkCaseManifest) {
        producedBenchmarkCaseManifests.push(benchmarkArtifacts.benchmarkCaseManifest);
      }

      rows.push({
        label: `${profile}+${strategy}+${trainingSeedMode}${trainingSeedSelection.mode !== trainingSeedMode ? `->${trainingSeedSelection.mode}` : ''}`,
        profile,
        input_routing: strategy,
        requested_training_seed_mode: trainingSeedMode,
        training_seed_mode: trainingSeedSelection.mode,
        training_seed_gate: {
          applied: trainingSeedSelection.gate.applied,
          ready: trainingSeedSelection.gate.ready,
          readiness_score: trainingSeedSelection.gate.readiness_score,
          fallback_mode: trainingSeedSelection.gate.fallback_mode,
          summary: trainingSeedSelection.gate.summary,
        },
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
        run_quality: contamination.status,
        contamination,
        scorecard: buildEvaluationScorecard({
          avgQuality,
          contradictionRate,
          duplicationRate,
          coverage: result.soul.coverage_score,
          runQuality: contamination.status,
          runtimeObservability: fallbackMetrics,
        }),
        judge_provenance: judgeProvenance,
        benchmark_context: benchmarkArtifacts.benchmarkContext,
        observability: routed.observability,
        scaling_observability: {
          pack_count: packBuild.packs.length,
          avg_pack_tokens: packBuild.stats.avg_tokens_per_pack,
          stable_topic_growth: packBuild.metrics.stable_topic_growth,
          duplication_pressure: packBuild.metrics.duplication_pressure,
          seed_maturity: packBuild.metrics.seed_maturity,
          adaptive_shard_count: adaptiveShardPlan.totals.shard_count,
          adaptive_avg_pack_per_shard:
            adaptiveShardPlan.totals.shard_count === 0
              ? 0
              : adaptiveShardPlan.totals.pack_count / adaptiveShardPlan.totals.shard_count,
          adaptive_avg_tokens_per_shard:
            adaptiveShardPlan.totals.shard_count === 0
              ? 0
              : adaptiveShardPlan.totals.estimated_tokens / adaptiveShardPlan.totals.shard_count,
          dynamic_scaling_state: dynamicScalingRecommendation.state,
          dynamic_scaling_action: dynamicScalingRecommendation.recommended_action,
          dynamic_scaling_confidence: dynamicScalingRecommendation.confidence,
          dynamic_scaling_reason: dynamicScalingRecommendation.reason,
        },
        runtime_observability: {
          kimi_stability_mode: executionSettings.kimiStabilityMode,
          trainer_fallbacks: fallbackMetrics.trainerFallbacks,
          persona_fallbacks: fallbackMetrics.personaFallbacks,
          evaluator_fallbacks: fallbackMetrics.evaluatorFallbacks,
          director_fallbacks: fallbackMetrics.directorFallbacks,
        },
      });
    } catch (error) {
      const runtimeObservability = snapshotAndResetAgentFallbackMetrics();
      const judgeProvenance = buildJudgeProvenance({
        layeredMode: executionSettings.evaluatorLayered,
        dualReviewRequested: executionSettings.evaluatorDualReview,
        evaluatorFallbacks: runtimeObservability.evaluatorFallbacks,
      });
      const contamination = classifyEvaluationRun({
        totalRounds: 0,
        runtimeObservability,
        judgeProvenance,
        failureError: String(error),
      });
      const benchmarkArtifacts = buildExperimentBenchmarkArtifacts({
        slug,
        suiteType: 'routing_compare',
        variant: `${strategy}:${trainingSeedSelection.mode}`,
        rounds: effectiveRounds,
        questionsPerRound: effectiveQuestionsPerRound,
        smokeMode: effectiveRounds === 1 && effectiveQuestionsPerRound === 1,
        providerName,
        executionSettings,
      });
      rows.push({
        label: `${profile}+${strategy}+${trainingSeedMode}${trainingSeedSelection.mode !== trainingSeedMode ? `->${trainingSeedSelection.mode}` : ''}`,
        profile,
        input_routing: strategy,
        requested_training_seed_mode: trainingSeedMode,
        training_seed_mode: trainingSeedSelection.mode,
        training_seed_gate: {
          applied: trainingSeedSelection.gate.applied,
          ready: trainingSeedSelection.gate.ready,
          readiness_score: trainingSeedSelection.gate.readiness_score,
          fallback_mode: trainingSeedSelection.gate.fallback_mode,
          summary: trainingSeedSelection.gate.summary,
        },
        soul_source: soulSource,
        runtime_preset: strategyDecision.runtimePreset,
        optimization_mode: strategyDecision.optimizationMode,
        corpus_segment: strategyDecision.corpusSegment,
        decision_reason: strategyDecision.reason,
        totalRounds: 0,
        avgQuality: 0,
        contradictionRate: 1,
        duplicationRate: 1,
        coverage: 0,
        run_quality: contamination.status,
        contamination,
        scorecard: buildEvaluationScorecard({
          avgQuality: 0,
          contradictionRate: 1,
          duplicationRate: 1,
          coverage: 0,
          runQuality: contamination.status,
          runtimeObservability,
        }),
        judge_provenance: judgeProvenance,
        benchmark_context: benchmarkArtifacts.benchmarkContext,
        observability: routed.observability,
        scaling_observability: {
          pack_count: packBuild.packs.length,
          avg_pack_tokens: packBuild.stats.avg_tokens_per_pack,
          stable_topic_growth: packBuild.metrics.stable_topic_growth,
          duplication_pressure: packBuild.metrics.duplication_pressure,
          seed_maturity: packBuild.metrics.seed_maturity,
          adaptive_shard_count: adaptiveShardPlan.totals.shard_count,
          adaptive_avg_pack_per_shard:
            adaptiveShardPlan.totals.shard_count === 0
              ? 0
              : adaptiveShardPlan.totals.pack_count / adaptiveShardPlan.totals.shard_count,
          adaptive_avg_tokens_per_shard:
            adaptiveShardPlan.totals.shard_count === 0
              ? 0
              : adaptiveShardPlan.totals.estimated_tokens / adaptiveShardPlan.totals.shard_count,
          dynamic_scaling_state: dynamicScalingRecommendation.state,
          dynamic_scaling_action: dynamicScalingRecommendation.recommended_action,
          dynamic_scaling_confidence: dynamicScalingRecommendation.confidence,
          dynamic_scaling_reason: dynamicScalingRecommendation.reason,
        },
        runtime_observability: {
          kimi_stability_mode: executionSettings.kimiStabilityMode,
          trainer_fallbacks: runtimeObservability.trainer_fallbacks,
          persona_fallbacks: runtimeObservability.persona_fallbacks,
          evaluator_fallbacks: runtimeObservability.evaluator_fallbacks,
          director_fallbacks: runtimeObservability.director_fallbacks,
        },
      });
    }
  }

  const recommendation = recommendInputRoutingStrategy({
      legacyObservability,
      v2Observability,
    });
  const routingDecisionRecord = buildRoutingDecisionRecord({
    rows,
    routingRecommendation: recommendation,
    dynamicScalingRecommendation,
    currentGrayPathRecommendation: buildCurrentGrayPathRecommendation(rows),
  });

  return {
    rows,
    recommendation,
    dynamicScalingRecommendation,
    routingDecisionRecord,
    benchmarkCaseManifests: collectFrozenBenchmarkCaseManifests(producedBenchmarkCaseManifests),
  };
}

function resolveComparisonTimeoutMs(rawDocCount: number, rounds: number): number {
  const envTimeout = Math.max(0, EXPERIMENT_COMPARISON_TIMEOUT_MS);
  const corpusAllowance = rawDocCount >= 3000
    ? 300_000
    : rawDocCount >= 2400
      ? 240_000
      : rawDocCount >= 1600
        ? 210_000
        : rawDocCount >= 800
          ? 180_000
          : rawDocCount >= 500
            ? 135_000
            : EXPERIMENT_PROFILE_TIMEOUT_MS;
  const roundAllowance = Math.max(EXPERIMENT_PROFILE_TIMEOUT_MS, rounds * 90_000);
  return Math.max(EXPERIMENT_PROFILE_TIMEOUT_MS, envTimeout, corpusAllowance, roundAllowance);
}

function buildCurrentGrayPathRecommendation(rows: InputRoutingComparisonRow[]): CurrentGrayPathRecommendation {
  const strictRows = selectStrictOfficialRows(rows);
  const sourceRows = strictRows.length > 0 ? strictRows : rows;
  const observedBest = [...sourceRows].sort((left, right) =>
    right.avgQuality - left.avgQuality ||
    right.coverage - left.coverage ||
    left.contradictionRate - right.contradictionRate ||
    left.duplicationRate - right.duplicationRate
  )[0];

  return {
    version: '2026-04-05',
    safe_default: {
      input_routing: 'legacy',
      training_seed_mode: 'off',
    },
    recommended_gray_path: {
      input_routing: 'v2',
      training_seed_mode: 'off',
    },
    summary: 'Current stable recommendation is v2 + off. topics has not shown stable upside over off, and signals remains gated until seed readiness improves.',
    observed_best_variant: observedBest
      ? {
          label: observedBest.label,
          input_routing: observedBest.input_routing,
          training_seed_mode: observedBest.training_seed_mode,
          avg_quality: observedBest.avgQuality,
          coverage: observedBest.coverage,
          contradiction_rate: observedBest.contradictionRate,
          duplication_rate: observedBest.duplicationRate,
        }
      : undefined,
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

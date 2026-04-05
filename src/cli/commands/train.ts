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
import {
  ErrorLedgerEntry,
  getTrainingAssetPaths,
  readJsonFile,
  RunManifest,
  StartTrackType,
  TrackType,
  TrainMode,
  writeJsonFile,
} from '../../core/training/lightning.js';
import { ReplayBuffer } from '../../core/training/replay.js';
import { CheckpointStore } from '../../core/training/checkpoint.js';
import { createFailureLedgerEntry, classifyFailure } from '../../core/training/failure-loop.js';
import { runTrainingOrchestrator } from '../../core/training/orchestrator.js';
import { runModelPreflight } from '../../core/training/preflight.js';
import {
  buildCorpusSnapshot,
  buildInputRunManifest,
  planCorpusShards,
  writeCorpusPlanningAssets,
  writeShardCorpusAssets,
} from '../../core/pipeline/corpus-plan.js';
import {
  distillCorpusShards,
  writeShardDistillationAssets,
} from '../../core/pipeline/shard-distillation.js';
import {
  mergeShardDistillationResults,
  writeGlobalMergeAssets,
} from '../../core/pipeline/global-merge.js';
import {
  loadTrainingSeedHints,
  normalizeTrainingSeedMode,
} from '../../core/training/training-seed.js';
import {
  loadInputRoutingReport,
  loadRawDocsCache,
  normalizeInputRoutingStrategy,
} from '../../core/pipeline/evidence-routing.js';
import {
  recommendInputRoutingStrategy,
  resolveTrainingExecutionSettings,
  resolveTrainingStrategy,
  TrainingExecutionSettings,
  TrainingStrategyDecision,
} from '../../core/training/strategy-resolver.js';
import { resolvePreferredProviderName } from '../../config/model.js';

interface TrainRuntimeContext {
  dir: string;
  persona: Persona;
  soul: Soul;
  reportPath: string;
  contextPath: string;
  rounds: number;
  profile: TrainingProfile;
  store: MemoryStore;
  spin: {
    start: (msg: string) => void;
    stop: (msg?: string) => void;
    message: (msg: string) => void;
  };
  replay: ReplayBuffer;
  checkpointStore: CheckpointStore;
  assetPaths: ReturnType<typeof getTrainingAssetPaths>;
  skillMetrics: { originSkillsAdded: number; distilledSkillsAdded: number; skillCoverageScore: number };
  errorLedger: ErrorLedgerEntry[];
  strategyDecision: TrainingStrategyDecision;
  executionSettings: TrainingExecutionSettings;
  trainingSeedHints: string[];
}

const TRACK_STAGE_TIMEOUT_MS = Number(process.env.NEEKO_TRAIN_STAGE_TIMEOUT_MS ?? 180_000);
const TRACK_BUDGET_MS = Number(process.env.NEEKO_TRAIN_TRACK_BUDGET_MS ?? 540_000);
const TRACK_HEARTBEAT_MS = Number(process.env.NEEKO_TRAIN_TRACK_HEARTBEAT_MS ?? 10_000);
const PROVIDER_TIMEOUT_RETRY_MAX = Number(process.env.NEEKO_RETRY_PROVIDER_TIMEOUT_MAX ?? 1);
const PARSE_DRIFT_RETRY_MAX = Number(process.env.NEEKO_RETRY_PARSE_DRIFT_MAX ?? 1);
const NO_SPINNER = process.env.NEEKO_NO_SPINNER === '1' || process.env.CI === '1' || !process.stdout.isTTY;

function createTrainSpinner() {
  if (!NO_SPINNER) return spinner();
  return {
    start(msg: string) {
      console.log(msg);
    },
    stop(msg?: string) {
      if (msg) console.log(msg);
    },
    message(msg: string) {
      console.log(msg);
    },
  };
}

export async function cmdTrain(
  slug: string,
  options: {
    rounds?: string;
    mode?: string;
    trainingProfile?: string;
    inputRouting?: string;
    trainingSeedMode?: string;
    retries?: string;
    track?: string;
    fromCheckpoint?: string;
    kimiStabilityMode?: string;
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
  const mode = normalizeMode(options.mode, rounds);
  const retries = resolveRetries(options.retries);
  const track = normalizeTrack(options.track);
  const inputRouting = normalizeInputRoutingStrategy(
    options.inputRouting,
    normalizeInputRoutingStrategy(String(settings.get('defaultInputRoutingStrategy') ?? 'legacy'))
  );
  const inputRoutingReport = loadInputRoutingReport(dir, inputRouting);
  const legacyRoutingReport = loadInputRoutingReport(dir, 'legacy');
  const v2RoutingReport = loadInputRoutingReport(dir, 'v2');
  const rawDocs = loadRawDocsCache(dir);
  const providerName = resolvePreferredProviderName();
  const trainingSeedMode = normalizeTrainingSeedMode(options.trainingSeedMode);
  const trainingSeedSelection = loadTrainingSeedHints(dir, trainingSeedMode);
  const strategyDecision = resolveTrainingStrategy({
    inputRoutingStrategy: inputRouting,
    observability: inputRoutingReport?.observability,
    rawDocCount: rawDocs.length,
    providerName,
  });
  const executionSettings = resolveTrainingExecutionSettings({
    strategyDecision,
    providerName,
    rounds,
    explicitKimiStabilityMode: options.kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE,
  });
  if (rawDocs.length > 0) {
    const snapshot = buildCorpusSnapshot(rawDocs, { personaSlug: persona.slug });
    const shardPlan = planCorpusShards(rawDocs, { personaSlug: persona.slug });
    const recommendation =
      legacyRoutingReport?.observability && v2RoutingReport?.observability
        ? recommendInputRoutingStrategy({
          legacyObservability: legacyRoutingReport.observability,
          v2Observability: v2RoutingReport.observability,
        })
        : null;
    const inputRunManifest = buildInputRunManifest({
      personaSlug: persona.slug,
      snapshot,
      shardPlan,
      selectedInputRouting: inputRouting,
      selectedKimiStabilityMode: executionSettings.kimiStabilityMode,
      provider: providerName,
      requestedRounds: rounds,
      trainingProfile: profile,
      recommendation,
    });
    writeCorpusPlanningAssets(dir, {
      snapshot,
      shardPlan,
      manifest: inputRunManifest,
    });
    writeShardCorpusAssets(dir, rawDocs, shardPlan);
    const shardDistillationResults = distillCorpusShards(rawDocs, shardPlan, {
      strategy: inputRouting,
      strategyDecision,
    });
    writeShardDistillationAssets(dir, shardDistillationResults);
    writeGlobalMergeAssets(dir, mergeShardDistillationResults(shardDistillationResults, {
      strategy: inputRouting,
    }));
  }

  const spin = createTrainSpinner();
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

  const preflight = await runModelPreflight({
    timeoutMs: Number(process.env.NEEKO_PREFLIGHT_TRAIN_TIMEOUT_MS ?? process.env.NEEKO_PREFLIGHT_TIMEOUT_MS ?? 20_000),
    requireStructured: true,
  });
  if (!preflight.ok) {
    throw new Error(`模型预检失败（耗时 ${preflight.latencyMs}ms）：${preflight.reason ?? 'unknown'}`);
  }

  persona.status = 'training';
  persistPersonaAndSoul(dir, persona, soul);

  const assetPaths = getTrainingAssetPaths(dir);
  const replay = new ReplayBuffer(assetPaths.replayBufferPath);
  const checkpointStore = new CheckpointStore(assetPaths.checkpointIndexPath);
  const errorLedger = readJsonFile<ErrorLedgerEntry[]>(assetPaths.errorLedgerPath, []);

  spin.start(`继续培养 ${slug}（${rounds} 轮，profile=${profile}，track=${track}）...`);
  if (inputRouting !== 'legacy') {
    spin.message(`输入路由策略已设置为 ${inputRouting}，当前训练链路不会重新摄取输入，保留现有 persona 数据。`);
  }
  spin.message(
    `训练策略已解析：preset=${strategyDecision.runtimePreset}，optimization=${strategyDecision.optimizationMode}，segment=${strategyDecision.corpusSegment}`
  );
  if (executionSettings.kimiStabilityMode !== 'standard') {
    spin.message(
      `Kimi stability 已启用：mode=${executionSettings.kimiStabilityMode}，director_interval=${executionSettings.directorReviewInterval}`
    );
  }
  if (trainingSeedSelection.mode !== 'off') {
    spin.message(
      `Training seed hints 已启用：mode=${trainingSeedSelection.mode}，hints=${trainingSeedSelection.hints.length}（${trainingSeedSelection.reason}）`
    );
  }

  writeTrainingContext(contextPath, {
    state: 'running',
    slug,
    profile,
    requested_rounds: rounds,
    completed_rounds: soul.training_rounds_completed,
    updated_at: new Date().toISOString(),
    report_path: reportPath,
    track,
    mode,
  });

  const runtime: TrainRuntimeContext = {
    dir,
    persona,
    soul,
    reportPath,
    contextPath,
    rounds,
    profile,
    store,
    spin,
    replay,
    checkpointStore,
    assetPaths,
    skillMetrics: {
      originSkillsAdded: 0,
      distilledSkillsAdded: 0,
      skillCoverageScore: 0,
    },
    errorLedger,
    strategyDecision,
    executionSettings,
    trainingSeedHints: trainingSeedSelection.hints,
  };

  try {
    const manifest = await runTrainingOrchestrator({
      slug,
      track,
      mode,
      onTrackStart: ({ track: runningTrack }) => {
        console.log(`[TRACK] ${runningTrack} start`);
      },
      onTrackDone: ({ track: doneTrack, output }) => {
        console.log(`[TRACK] ${doneTrack} done rounds=${output.rounds} pass=${output.acceptance.pass}`);
      },
      onManifestUpdate: (manifestData) => {
        writeJsonFile(assetPaths.manifestPath, manifestData);
      },
      runTrack: async ({ track: runningTrack }) => runTrackWithRecovery(runtime, runningTrack, retries, options.fromCheckpoint),
    });

    const failed = manifest.tracks.some((t) => t.status === 'failed');
    if (failed) {
      persona.status = 'training';
      persistPersonaAndSoul(dir, persona, soul);
      writeTrainingContext(contextPath, {
        state: 'interrupted',
        slug,
        profile,
        requested_rounds: rounds,
        completed_rounds: soul.training_rounds_completed,
        updated_at: new Date().toISOString(),
        report_path: reportPath,
        track,
        mode,
      });
      writeJsonFile(assetPaths.errorLedgerPath, runtime.errorLedger);
      throw new Error('训练未通过验收门槛，已保留断点，可继续恢复。');
    }

    finalizeRun(runtime, manifest);
    spin.stop(`培养完成：累计 ${soul.training_rounds_completed} 轮`);
    console.log(chalk.green(`✓ ${slug} 已完成双轨训练`));
  } catch (error) {
    writeJsonFile(assetPaths.errorLedgerPath, runtime.errorLedger);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function runTrackWithRecovery(
  runtime: TrainRuntimeContext,
  track: TrackType,
  retries: number,
  fromCheckpoint?: string
): Promise<{ rounds: number; errors: number; checkpoints: number; acceptance: { pass: boolean; [key: string]: number | boolean | undefined } }> {
  const runOnce = async () => {
    if (fromCheckpoint) {
      console.log(`[CHECKPOINT] requested resume from ${fromCheckpoint}`);
    }
    if (track === 'persona_extract') {
      console.log('[SKILL_STAGE] skill_origin_extract');
      await refreshSkills(runtime);
      console.log('[SKILL_STAGE] skill_expand');
      console.log('[SKILL_STAGE] skill_merge');
    }
    return runTrackLoop(runtime, track);
  };

  let lastError: unknown;
  const deadline = Date.now() + TRACK_BUDGET_MS;
  for (let attempt = 1; ; attempt++) {
    if (Date.now() >= deadline) {
      throw new Error(`track ${track} budget timeout after ${TRACK_BUDGET_MS}ms`);
    }
    try {
      return await runWithTrackHeartbeat(runtime, track, () =>
        withTimeout(runOnce(), TRACK_STAGE_TIMEOUT_MS, `track ${track}`)
      );
    } catch (error) {
      lastError = error;
      const resolution = classifyFailure(error);
      const retryLimit = retryLimitForTag(resolution.tag, retries);
      const recovered = resolution.retryable && attempt <= retryLimit && Date.now() < deadline;
      runtime.errorLedger.push(
        createFailureLedgerEntry({
          slug: runtime.persona.slug,
          track,
          stage: track === 'persona_extract' ? 'A' : 'B',
          error,
          recovered,
        })
      );
      if (!recovered) break;
      if (resolution.tag === 'parse_drift') {
        process.env.NEEKO_RELAXED_SCHEMA_MODE = '1';
      }
      runtime.spin.message(`阶段失败(${resolution.tag})，执行恢复策略 ${resolution.recoveryAction}（${attempt}/${retryLimit + 1}）`);
      await sleep(800 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function refreshSkills(runtime: TrainRuntimeContext): Promise<void> {
  const previousSkills = loadSkillLibrary(runtime.dir, runtime.persona.slug);
  const memorySignals = await buildMemorySignals(runtime.store, runtime.persona.memory_collection, runtime.soul);
  const skillLibrary = await refreshSkillLibraryFromSignals(runtime.persona, runtime.soul, memorySignals, previousSkills);
  saveSkillLibrary(runtime.dir, skillLibrary);

  const covered = skillLibrary.origin_skills.filter((o) =>
    skillLibrary.distilled_skills.some((e) => e.source_origin_ids.includes(o.id))
  ).length;
  runtime.skillMetrics = {
    originSkillsAdded: skillLibrary.origin_skills.length,
    distilledSkillsAdded: skillLibrary.distilled_skills.length,
    skillCoverageScore:
      skillLibrary.origin_skills.length === 0 ? 0 : covered / skillLibrary.origin_skills.length,
  };
}

async function runTrackLoop(
  runtime: TrainRuntimeContext,
  track: TrackType
): Promise<{ rounds: number; errors: number; checkpoints: number; acceptance: { pass: boolean; [key: string]: number | boolean | undefined } }> {
  const existingRounds = readExistingRounds(runtime.reportPath);
  const roundOffset = existingRounds.length;
  const incrementalRounds: TrainingRoundSnapshot[] = [];

  const perTrackProfile: TrainingProfile =
    track === 'work_execute' && runtime.profile === 'baseline' ? 'full' : runtime.profile;

  writeTrainingContext(runtime.contextPath, {
    state: 'running',
    slug: runtime.persona.slug,
    profile: perTrackProfile,
    requested_rounds: runtime.rounds,
    completed_rounds: roundOffset,
    updated_at: new Date().toISOString(),
    report_path: runtime.reportPath,
    track,
  });

  const loop = new TrainingLoop(runtime.soul, runtime.persona, runtime.store);
  const result = await loop.run({
    maxRounds: runtime.rounds,
    profile: perTrackProfile,
    trainingSeedHints: runtime.trainingSeedHints,
    runtimePreset: runtime.executionSettings.runtimePreset,
    runtimeOverrides: runtime.executionSettings.runtimeOverrides,
    evaluatorLayered: runtime.executionSettings.evaluatorLayered,
    evaluatorDualReview: runtime.executionSettings.evaluatorDualReview,
    directorReviewInterval: runtime.executionSettings.directorReviewInterval,
    directorAlwaysOnFinalRound: runtime.executionSettings.directorAlwaysOnFinalRound,
    onProgress: (progress) => {
      runtime.spin.message(
        `[${track}] Round ${progress.round}/${progress.maxRounds} — +${progress.nodesWritten}, quality ${(progress.avgQualityScore * 100).toFixed(0)}%`
      );
      const snapshot = toRoundSnapshot(progress, roundOffset);
      upsertRoundSnapshot(incrementalRounds, snapshot);
      persistPartialReport(runtime, existingRounds, incrementalRounds, perTrackProfile);
      writeRuntimeArtifacts(runtime, track, progress, snapshot.round);
    },
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

  const merged = buildTrainingRunReportFromRounds(perTrackProfile, [...existingRounds, ...newRounds], runtime.skillMetrics);
  writeFileSync(runtime.reportPath, JSON.stringify(merged, null, 2), 'utf-8');

  runtime.persona.training_rounds = merged.total_rounds;
  runtime.persona.last_trained_at = new Date().toISOString();
  runtime.persona.updated_at = new Date().toISOString();
  runtime.soul.training_rounds_completed = merged.total_rounds;
  runtime.soul.updated_at = new Date().toISOString();

  try {
    runtime.persona.memory_node_count = await runtime.store.count(runtime.persona.memory_collection);
  } catch {
    // Ignore count failure and keep previous value.
  }

  persistPersonaAndSoul(runtime.dir, runtime.persona, runtime.soul);

  const acceptance = track === 'persona_extract'
    ? evaluateTrackA(runtime, merged)
    : evaluateTrackB(runtime, merged, result.history);

  writeTrainingContext(runtime.contextPath, {
    state: acceptance.pass ? 'running' : 'interrupted',
    slug: runtime.persona.slug,
    profile: perTrackProfile,
    requested_rounds: runtime.rounds,
    completed_rounds: merged.total_rounds,
    updated_at: new Date().toISOString(),
    report_path: runtime.reportPath,
    track,
    acceptance,
  });

  return {
    rounds: result.totalRounds,
    errors: runtime.errorLedger.filter((item) => item.track === track).length,
    checkpoints: runtime.checkpointStore.readIndex().checkpoints.filter((cp) => cp.track === track).length,
    acceptance,
  };
}

function evaluateTrackA(runtime: TrainRuntimeContext, report: TrainingRunReport): { pass: boolean; [key: string]: number | boolean | undefined } {
  const avgConsistency = averageFromReport(report, 'skill_method_adherence');
  const contradictionRate = report.summary.avg_contradiction_rate;
  const skillAcceptanceRate = acceptedRate(runtime);
  const distilledSkillCount = runtime.skillMetrics.distilledSkillsAdded;
  const stability = report.summary.skill_set_stability;
  return {
    consistency: avgConsistency,
    contradiction_rate: contradictionRate,
    skill_acceptance_rate: skillAcceptanceRate,
    distilled_skill_count: distilledSkillCount,
    skill_set_stability: stability,
    pass:
      avgConsistency >= 0.8 &&
      contradictionRate <= 0.12 &&
      skillAcceptanceRate >= 0.7 &&
      distilledSkillCount >= 3 &&
      distilledSkillCount <= 6 &&
      stability >= 0.8,
  };
}

function evaluateTrackB(
  runtime: TrainRuntimeContext,
  report: TrainingRunReport,
  history: TrainingProgress[]
): { pass: boolean; [key: string]: number | boolean | undefined } {
  const taskSuccessRate = report.summary.skill_transfer_success_rate;
  const firstPassSuccess = history.length > 0 ? (history[0]?.observability.skillTransferSuccessRate ?? 0) : 0;
  const repairSuccessRate = report.summary.skill_trigger_precision;
  const regressionRate = Math.max(0, report.summary.avg_contradiction_rate - 0.02);
  const p95Latency = p95(history.map((h) => h.round));

  return {
    task_success_rate: taskSuccessRate,
    first_pass_success: firstPassSuccess,
    repair_success_rate: repairSuccessRate,
    regression_rate: regressionRate,
    p95_stage_latency: p95Latency,
    pass:
      taskSuccessRate >= 0.75 &&
      firstPassSuccess >= 0.55 &&
      repairSuccessRate >= 0.7 &&
      regressionRate <= 0.1,
  };
}

function finalizeRun(runtime: TrainRuntimeContext, manifest: RunManifest): void {
  runtime.persona.status = 'converged';
  runtime.persona.updated_at = new Date().toISOString();
  runtime.soul.updated_at = new Date().toISOString();
  persistPersonaAndSoul(runtime.dir, runtime.persona, runtime.soul);

  writeTrainingContext(runtime.contextPath, {
    state: 'completed',
    slug: runtime.persona.slug,
    profile: runtime.profile,
    requested_rounds: runtime.rounds,
    completed_rounds: runtime.soul.training_rounds_completed,
    updated_at: new Date().toISOString(),
    report_path: runtime.reportPath,
    track: manifest.orchestration.track,
    mode: manifest.orchestration.mode,
  });

  writeJsonFile(runtime.assetPaths.errorLedgerPath, runtime.errorLedger);
  writeJsonFile(runtime.assetPaths.manifestPath, manifest);
  writeDatasetSnapshot(runtime);
  writeEvaluationSummary(runtime, manifest);
}

function writeRuntimeArtifacts(
  runtime: TrainRuntimeContext,
  track: TrackType,
  progress: TrainingProgress,
  absoluteRound: number
): void {
  const ts = new Date().toISOString();
  runtime.replay.append({
    schema_version: 1,
    persona_slug: runtime.persona.slug,
    track,
    round: absoluteRound,
    stage: 'training',
    created_at: ts,
    steps: [
      {
        context: `round=${absoluteRound} profile=${runtime.profile}`,
        thought_step: 'generate/evaluate/update',
        action: 'run_round',
        observation: `quality=${progress.avgQualityScore.toFixed(4)}`,
        outcome: progress.status,
        reward: progress.avgQualityScore,
      },
    ],
  });

  const checkpointPath = join(runtime.dir, 'checkpoints', `${track}-round-${absoluteRound}.json`);
  writeTrainingContext(checkpointPath, {
    schema_version: 1,
    created_at: ts,
    slug: runtime.persona.slug,
    track,
    round: absoluteRound,
    soul_rounds: runtime.soul.training_rounds_completed,
    observability: progress.observability,
    convergence: progress.convergenceState,
  });
  runtime.checkpointStore.append({
    id: crypto.randomUUID(),
    created_at: ts,
    persona_slug: runtime.persona.slug,
    track,
    stage: 'training_round',
    round: absoluteRound,
    report_rounds: absoluteRound,
    soul_rounds: runtime.soul.training_rounds_completed,
    path: checkpointPath,
  });
}

function persistPartialReport(
  runtime: TrainRuntimeContext,
  existingRounds: TrainingRoundSnapshot[],
  incrementalRounds: TrainingRoundSnapshot[],
  profile: TrainingProfile
): void {
  const partial = buildTrainingRunReportFromRounds(
    profile,
    [...existingRounds, ...incrementalRounds],
    runtime.skillMetrics
  );
  mkdirSync(runtime.dir, { recursive: true });
  writeFileSync(runtime.reportPath, JSON.stringify(partial, null, 2), 'utf-8');
  runtime.persona.status = 'training';
  runtime.persona.training_rounds = partial.total_rounds;
  runtime.persona.last_trained_at = new Date().toISOString();
  runtime.persona.updated_at = new Date().toISOString();
  runtime.soul.training_rounds_completed = partial.total_rounds;
  runtime.soul.updated_at = new Date().toISOString();
  persistPersonaAndSoul(runtime.dir, runtime.persona, runtime.soul);
  writeTrainingContext(runtime.contextPath, {
    state: 'running',
    slug: runtime.persona.slug,
    profile,
    requested_rounds: runtime.rounds,
    completed_rounds: partial.total_rounds,
    updated_at: new Date().toISOString(),
    report_path: runtime.reportPath,
  });
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

function normalizeMode(rawMode: string | undefined, rounds: number): TrainMode {
  const mode = String(rawMode ?? '').toLowerCase();
  if (mode === 'quick' || mode === 'full') return mode;
  return rounds <= 3 ? 'quick' : 'full';
}

function normalizeTrack(rawTrack?: string): StartTrackType {
  const track = String(rawTrack ?? 'full_serial').toLowerCase();
  if (track === 'persona_extract' || track === 'work_execute' || track === 'full_serial') return track;
  return 'full_serial';
}

function resolveRounds(rawRounds?: string, rawMode?: string): number {
  if (rawRounds !== undefined) {
    const explicit = parseInt(rawRounds, 10);
    if (!Number.isNaN(explicit)) return Math.max(1, explicit);
  }
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

function retryLimitForTag(tag: string, configuredRetries: number): number {
  if (tag === 'provider_timeout') return Math.min(configuredRetries, Math.max(0, PROVIDER_TIMEOUT_RETRY_MAX));
  if (tag === 'parse_drift') return Math.min(configuredRetries, Math.max(0, PARSE_DRIFT_RETRY_MAX));
  if (tag === 'schema_incompat') return 0;
  return configuredRetries;
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

function writeDatasetSnapshot(runtime: TrainRuntimeContext): void {
  const text = [
    '# Dataset Snapshot',
    '',
    `- Persona: ${runtime.persona.slug}`,
    `- Updated: ${new Date().toISOString()}`,
    `- Memory nodes: ${runtime.persona.memory_node_count}`,
    `- Docs: ${runtime.persona.doc_count}`,
    `- Skill origins: ${runtime.skillMetrics.originSkillsAdded}`,
    `- Distilled skills: ${runtime.skillMetrics.distilledSkillsAdded}`,
    `- Skill coverage: ${(runtime.skillMetrics.skillCoverageScore * 100).toFixed(2)}%`,
  ].join('\n');
  writeFileSync(runtime.assetPaths.datasetSnapshotPath, text, 'utf-8');
}

function writeEvaluationSummary(runtime: TrainRuntimeContext, manifest: RunManifest): void {
  const report = readJsonFile<TrainingRunReport | null>(runtime.reportPath, null);
  const lines = [
    '# Evaluation Summary',
    '',
    `- Persona: ${runtime.persona.slug}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Track mode: ${manifest.orchestration.track}`,
    `- Runtime mode: ${manifest.orchestration.mode}`,
    `- Total rounds: ${report?.total_rounds ?? 0}`,
    `- Avg quality: ${((report?.summary?.avg_quality_score ?? 0) * 100).toFixed(2)}%`,
    `- Avg contradiction: ${((report?.summary?.avg_contradiction_rate ?? 0) * 100).toFixed(2)}%`,
    `- Skill method adherence: ${((report?.summary?.skill_method_adherence ?? 0) * 100).toFixed(2)}%`,
    '',
    '## Track Acceptance',
    ...manifest.tracks.map((item) =>
      `- ${item.track}: ${item.status} | rounds=${item.rounds} | errors=${item.errors} | checkpoints=${item.checkpoints}`
    ),
    '',
    '## Recent Errors',
    ...runtime.errorLedger.slice(-10).map((item) =>
      `- [${item.created_at}] ${item.track}/${item.stage} ${item.tag} -> ${item.recovery_action} (recovered=${item.recovered})`
    ),
  ];
  writeFileSync(runtime.assetPaths.evaluationSummaryPath, lines.join('\n'), 'utf-8');
}

function acceptedRate(runtime: TrainRuntimeContext): number {
  const skillsPath = join(runtime.dir, 'skills.json');
  const skills = readJsonFile<{ distilled_skills?: unknown[]; candidate_skill_pool?: unknown[] }>(skillsPath, {});
  const accepted = Array.isArray(skills.distilled_skills) ? skills.distilled_skills.length : 0;
  const pending = Array.isArray(skills.candidate_skill_pool) ? skills.candidate_skill_pool.length : 0;
  const total = accepted + pending;
  if (total === 0) return 0;
  return accepted / total;
}

function averageFromReport(report: TrainingRunReport, key: 'skill_method_adherence'): number {
  if (!Array.isArray(report.rounds) || report.rounds.length === 0) return 0;
  const values = report.rounds
    .map((round) => {
      if (key === 'skill_method_adherence') return round.skill_method_adherence ?? 0;
      return 0;
    });
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95));
  return sorted[idx] ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runWithTrackHeartbeat<T>(
  runtime: TrainRuntimeContext,
  track: TrackType,
  task: () => Promise<T>
): Promise<T> {
  const timer = setInterval(() => {
    writeTrainingContext(runtime.contextPath, {
      state: 'running',
      slug: runtime.persona.slug,
      profile: runtime.profile,
      requested_rounds: runtime.rounds,
      completed_rounds: runtime.soul.training_rounds_completed,
      updated_at: new Date().toISOString(),
      report_path: runtime.reportPath,
      track,
    });
  }, TRACK_HEARTBEAT_MS);

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

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
  summarizeBenchmarkHomogeneity,
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
import {
  collectBenchmarkRunCaseTraces,
  judgeBenchmarkRun,
  type BenchmarkCaseSummary,
  type BenchmarkJudgeMode,
  type BenchmarkJudgeDisagreement,
  type BenchmarkJudgeSummary,
  type BenchmarkRunJudgmentArtifact,
  type BenchmarkScorecard,
} from '../../core/training/benchmark-judge.js';
import {
  loadBenchmarkPack,
  type LoadedBenchmarkPack,
} from '../../core/training/benchmark-pack.js';
import {
  buildBenchmarkGovernanceSummary,
  buildBenchmarkReplicaSummary,
  computePairedBootstrapSignificance,
  type BenchmarkGovernanceSummary,
  type BenchmarkReplicaMeasurement,
  type BenchmarkReplicaSummary,
  type BenchmarkReportJudgeMode,
  type BenchmarkSignificanceSummary,
} from '../../core/training/significance.js';
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
  benchmarkJudgments: ExperimentBenchmarkRunArtifact[];
  replicaMeasurements: Record<string, BenchmarkReplicaMeasurement[]>;
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
  benchmark_scorecard?: BenchmarkScorecard;
  benchmark_case_summary?: BenchmarkCaseSummary;
  benchmark_judge_summary?: BenchmarkJudgeSummary;
  benchmark_judge_disagreement?: BenchmarkJudgeDisagreement;
  benchmark_replica_summary?: BenchmarkReplicaSummary;
  benchmark_governance?: BenchmarkGovernanceSummary;
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
  benchmarkJudgments: ExperimentBenchmarkRunArtifact[];
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

interface ExperimentReportArtifactRefs {
  benchmark_manifest_path: string;
  benchmark_pack_path?: string;
  benchmark_judgments_path?: string;
  benchmark_summary_path?: string;
  report_path: string;
  report_csv_path: string;
}

interface ExperimentBenchmarkRunArtifact extends BenchmarkRunJudgmentArtifact {
  run_label: string;
  scope: 'profile_sweep' | 'routing_compare';
  profile?: TrainingProfile;
  variant?: string;
  replica_id?: string;
}

interface ExperimentSingleRunResult {
  row: ExperimentSummaryRow;
  roundHistory: ExperimentRoundHistoryItem[];
  benchmarkCaseManifest: FrozenBenchmarkCaseManifest | null;
  benchmarkJudgment: ExperimentBenchmarkRunArtifact | null;
  replicaMeasurement: BenchmarkReplicaMeasurement;
  failure?: string;
}

interface BenchmarkAggregationResult {
  row: ExperimentSummaryRow;
  roundHistory: ExperimentRoundHistoryItem[];
  benchmarkCaseManifests: FrozenBenchmarkCaseManifest[];
  benchmarkJudgments: ExperimentBenchmarkRunArtifact[];
  replicaMeasurements: BenchmarkReplicaMeasurement[];
}

interface ExperimentReportInput {
  slug: string;
  profiles?: TrainingProfile[];
  reportRounds?: number;
  reportQuestionsPerRound?: number;
  rows?: ExperimentSummaryRow[];
  summary_rows?: ExperimentSummaryRow[];
  strictOfficialSummaryRows?: ExperimentSummaryRow[];
  official_summary_rows?: ExperimentSummaryRow[];
  compatibleOfficialSummaryRows?: ExperimentSummaryRow[];
  observedBestProfile?: TrainingProfile | null;
  effectiveBestProfile?: TrainingProfile | null;
  roundHistories?: Record<string, ExperimentRoundHistoryItem[]>;
  failures?: Array<{ profile: TrainingProfile; error: string }>;
  effectiveInputRouting?: InputRoutingStrategy;
  providerName?: string;
  kimiStabilityMode?: string;
  effectiveTrainingSeedMode?: TrainingSeedMode;
  inputRoutingComparison?: InputRoutingComparisonSummary;
  strictOfficialComparisonRows?: InputRoutingComparisonRow[];
  compatibleOfficialComparisonRows?: InputRoutingComparisonRow[];
  currentGrayPathRecommendation?: CurrentGrayPathRecommendation;
  benchmarkManifests?: BenchmarkCaseManifest[];
  benchmarkCaseManifests?: FrozenBenchmarkCaseManifest[];
  benchmarkJudgments?: ExperimentBenchmarkRunArtifact[];
  benchmarkReplayMeta?: BenchmarkReplayMeta;
  artifactRefs?: ExperimentReportArtifactRefs;
  artifact_refs?: ExperimentReportArtifactRefs;
  gateResult?: ReturnType<typeof evaluateGate>;
  officialPack?: LoadedBenchmarkPack | null;
  benchmark_pack?: LoadedBenchmarkPack['summary'];
  benchmarkSignificance?: BenchmarkSignificanceSummary | null;
  benchmarkGovernance?: BenchmarkGovernanceSummary | null;
  benchmark_significance?: BenchmarkSignificanceSummary | null;
  benchmark_governance?: BenchmarkGovernanceSummary | null;
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

function buildExperimentReport(input: ExperimentReportInput) {
  const rows = input.rows ?? input.summary_rows ?? [];
  const strictOfficialSummaryRows = input.strictOfficialSummaryRows ?? input.official_summary_rows ?? [];
  const compatibleOfficialSummaryRows = input.compatibleOfficialSummaryRows ?? strictOfficialSummaryRows;
  const inputRoutingComparison = input.inputRoutingComparison ?? {
    rows: [],
    recommendation: null,
    dynamicScalingRecommendation: null,
    routingDecisionRecord: null,
    benchmarkCaseManifests: [],
    benchmarkJudgments: [],
  };
  const strictOfficialComparisonRows = input.strictOfficialComparisonRows ?? [];
  const compatibleOfficialComparisonRows = input.compatibleOfficialComparisonRows ?? strictOfficialComparisonRows;
  const benchmarkManifests = input.benchmarkManifests ?? [];
  const benchmarkCaseManifests = input.benchmarkCaseManifests ?? [];
  const benchmarkJudgments = input.benchmarkJudgments ?? [];
  const benchmarkReplayMeta = input.benchmarkReplayMeta ?? { active: false };
  const artifactRefs = input.artifactRefs ?? input.artifact_refs ?? {
    benchmark_manifest_path: '',
    report_path: '',
    report_csv_path: '',
  };
  const gateResult = input.gateResult ?? {
    enabled: false,
    passed: true,
    reason: 'gate disabled',
    baseline_profile: 'baseline' as TrainingProfile,
    compare_profile: 'full' as TrainingProfile,
  };
  const benchmarkPack = input.benchmark_pack ?? input.officialPack?.summary;
  const profiles = input.profiles ?? [...new Set(rows.map((row) => row.profile))];
  const effectiveInputRouting = input.effectiveInputRouting ?? 'legacy';
  const effectiveTrainingSeedMode = input.effectiveTrainingSeedMode ?? 'off';
  const currentGrayPathRecommendation = input.currentGrayPathRecommendation ?? {
    version: 'test',
    safe_default: {
      input_routing: 'legacy',
      training_seed_mode: 'off',
    },
    recommended_gray_path: {
      input_routing: 'legacy',
      training_seed_mode: 'off',
    },
    summary: 'test helper default',
  };
  const benchmarkReportRows = collectBenchmarkReportRows(rows, inputRoutingComparison.rows);
  const benchmarkJudgeSummary = buildExperimentBenchmarkJudgeSummary(
    benchmarkReportRows,
    benchmarkPack?.pack_id,
    benchmarkPack?.pack_version
  );
  const benchmarkReplicaSummaries = collectBenchmarkReplicaRows(rows, inputRoutingComparison.rows);

  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    slug: input.slug,
    rounds_per_profile: input.reportRounds ?? 0,
    profiles,
    questions_per_round: input.reportQuestionsPerRound ?? 0,
    summary_rows: rows,
    official_summary_rows: strictOfficialSummaryRows,
    best_profile: input.effectiveBestProfile ?? null,
    observed_best_profile: input.observedBestProfile ?? null,
    round_histories: input.roundHistories ?? {},
    failures: input.failures ?? [],
    input_routing_strategy: effectiveInputRouting,
    provider: input.providerName,
    kimi_stability_mode: input.kimiStabilityMode ?? 'auto',
    training_seed_mode: effectiveTrainingSeedMode,
    input_routing_comparison: inputRoutingComparison.rows,
    official_input_routing_comparison: strictOfficialComparisonRows,
    benchmark_pack: benchmarkPack,
    benchmark_scorecards: benchmarkReportRows.map((item) => ({
      label: item.label,
      scope: item.scope,
      profile: item.profile,
      overall: item.scorecard.overall,
      pass_rate: item.scorecard.pass_rate,
      abstain_rate: item.scorecard.abstain_rate,
      disputed_rate: item.scorecard.disputed_rate,
      case_count: item.scorecard.case_count,
      scorecard: item.scorecard,
      case_summary: item.caseSummary,
      judge_summary: item.judgeSummary,
      disagreement: item.disagreement,
    })),
    benchmark_replica_summaries: benchmarkReplicaSummaries,
    benchmark_judge_summary: benchmarkJudgeSummary,
    benchmark_significance: input.benchmarkSignificance ?? input.benchmark_significance ?? null,
    benchmark_governance: input.benchmarkGovernance ?? input.benchmark_governance ?? null,
    input_routing_recommendation: inputRoutingComparison.recommendation,
    dynamic_scaling_recommendation: inputRoutingComparison.dynamicScalingRecommendation,
    routing_decision_record: inputRoutingComparison.routingDecisionRecord,
    current_gray_path_recommendation: currentGrayPathRecommendation,
    benchmark_manifests: benchmarkManifests,
    benchmark_case_manifests: benchmarkCaseManifests,
    benchmark_judgments: benchmarkJudgments,
    benchmark_replay: benchmarkReplayMeta,
    artifact_refs: artifactRefs,
    evaluation_v2: {
      version: 'evaluation-v2-p2',
      smoke_mode: (input.reportRounds ?? 0) === 1 && (input.reportQuestionsPerRound ?? 0) === 1,
      official_status: strictOfficialSummaryRows.length > 0 || strictOfficialComparisonRows.length > 0 ? 'available' : 'unavailable',
      official_best_profile: input.effectiveBestProfile ?? null,
      observed_best_profile: input.observedBestProfile ?? null,
      official_run_count: strictOfficialSummaryRows.length + strictOfficialComparisonRows.length,
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
      official_pack_id: benchmarkPack?.pack_id,
      official_pack_version: benchmarkPack?.pack_version,
      suite_types_present: [...new Set(benchmarkManifests.map((item) => item.suite_label.split(':')[0]))],
      suite_tiers_present: [...new Set(benchmarkManifests.map((item) => item.suite_tier))],
    },
    gate_result: gateResult,
  };
}

function collectBenchmarkReplicaRows(
  rows: ExperimentSummaryRow[],
  comparisonRows: InputRoutingComparisonRow[]
) {
  const fromSummaryRows = rows
    .filter((row): row is ExperimentSummaryRow & {
      benchmark_replica_summary: BenchmarkReplicaSummary;
    } => Boolean(row.benchmark_replica_summary))
    .map((row) => ({
      label: row.profile,
      scope: 'profile_sweep' as const,
      profile: row.profile,
      replica_summary: row.benchmark_replica_summary,
    }));

  const fromComparisonRows = comparisonRows
    .filter((row): row is InputRoutingComparisonRow & {
      benchmark_replica_summary: BenchmarkReplicaSummary;
    } => Boolean(row.benchmark_replica_summary))
    .map((row) => ({
      label: row.label,
      scope: 'routing_compare' as const,
      profile: row.profile,
      replica_summary: row.benchmark_replica_summary,
    }));

  return [...fromSummaryRows, ...fromComparisonRows];
}

function collectBenchmarkReportRows(
  rows: ExperimentSummaryRow[],
  comparisonRows: InputRoutingComparisonRow[]
): Array<{
  label: string;
  scope: 'profile_sweep' | 'routing_compare';
  profile: TrainingProfile;
  scorecard: BenchmarkScorecard;
  caseSummary: BenchmarkCaseSummary;
  judgeSummary: BenchmarkJudgeSummary;
  disagreement: BenchmarkJudgeDisagreement;
}> {
  const fromSummaryRows = rows
    .filter((row): row is ExperimentSummaryRow & {
      benchmark_scorecard: BenchmarkScorecard;
      benchmark_case_summary: BenchmarkCaseSummary;
      benchmark_judge_summary: BenchmarkJudgeSummary;
      benchmark_judge_disagreement: BenchmarkJudgeDisagreement;
    } => Boolean(
      row.benchmark_scorecard &&
      row.benchmark_case_summary &&
      row.benchmark_judge_summary &&
      row.benchmark_judge_disagreement
    ))
    .map((row) => ({
      label: row.profile,
      scope: 'profile_sweep' as const,
      profile: row.profile,
      scorecard: row.benchmark_scorecard,
      caseSummary: row.benchmark_case_summary,
      judgeSummary: row.benchmark_judge_summary,
      disagreement: row.benchmark_judge_disagreement,
    }));

  const fromComparisonRows = comparisonRows
    .filter((row): row is InputRoutingComparisonRow & {
      benchmark_scorecard: BenchmarkScorecard;
      benchmark_case_summary: BenchmarkCaseSummary;
      benchmark_judge_summary: BenchmarkJudgeSummary;
      benchmark_judge_disagreement: BenchmarkJudgeDisagreement;
    } => Boolean(
      row.benchmark_scorecard &&
      row.benchmark_case_summary &&
      row.benchmark_judge_summary &&
      row.benchmark_judge_disagreement
    ))
    .map((row) => ({
      label: row.label,
      scope: 'routing_compare' as const,
      profile: row.profile,
      scorecard: row.benchmark_scorecard,
      caseSummary: row.benchmark_case_summary,
      judgeSummary: row.benchmark_judge_summary,
      disagreement: row.benchmark_judge_disagreement,
    }));

  return [...fromSummaryRows, ...fromComparisonRows];
}

function buildExperimentBenchmarkJudgeSummary(
  rows: ReturnType<typeof collectBenchmarkReportRows>,
  packId?: string,
  packVersion?: string
) {
  const judgedRowCount = rows.length;
  const disputedCaseCount = rows.reduce((sum, item) => sum + item.caseSummary.disputed_case_count, 0);
  const disagreementRateMean = judgedRowCount === 0
    ? 0
    : rows.reduce((sum, item) => sum + item.disagreement.disagreement_rate, 0) / judgedRowCount;

  return {
    version: 'benchmark-judge-report-summary-v1',
    available: judgedRowCount > 0,
    pack_id: packId ?? null,
    pack_version: packVersion ?? null,
    row_count: judgedRowCount,
    disputed_case_count: disputedCaseCount,
    disagreement_rate_mean: disagreementRateMean,
    judge_modes: [...new Set(rows.map((item) => item.judgeSummary.judge_mode))],
    rows: rows.map((item) => ({
      label: item.label,
      scope: item.scope,
      profile: item.profile,
      overall: item.scorecard.overall,
      pass_rate: item.scorecard.pass_rate,
      disputed_case_count: item.caseSummary.disputed_case_count,
      disagreement_rate: item.disagreement.disagreement_rate,
    })),
  };
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
    suiteType === 'ab_regression' ||
    suiteType === 'official_benchmark'
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
  officialPack?: LoadedBenchmarkPack | null;
}): {
  benchmarkContext: BenchmarkContext;
  benchmarkCaseManifest: FrozenBenchmarkCaseManifest | null;
} {
  if (input.officialPack) {
    const manifest = withReplicaIdentity(input.officialPack.frozen_manifest, input.replicaGroup, input.replicaId);
    return {
      benchmarkContext: {
        ...input.officialPack.benchmark_context,
        case_manifest: manifest.manifest,
      },
      benchmarkCaseManifest: manifest,
    };
  }

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

function withReplicaIdentity(
  manifest: FrozenBenchmarkCaseManifest,
  replicaGroup?: string,
  replicaId?: string
): FrozenBenchmarkCaseManifest {
  if (!replicaGroup && !replicaId) {
    return manifest;
  }
  return {
    manifest: {
      ...manifest.manifest,
      replayable: true,
      replay_mode: replicaGroup ? 'replica_summary' : manifest.manifest.replay_mode,
      replica_group: replicaGroup,
      replica_id: replicaId,
    },
    cases: manifest.cases.map((item) => ({ ...item })),
  };
}

function normalizeJudgeMode(input?: string): BenchmarkReportJudgeMode {
  const value = String(input ?? 'both').trim().toLowerCase();
  if (
    value === 'proxy' ||
    value === 'benchmark_single' ||
    value === 'benchmark_dual' ||
    value === 'both'
  ) {
    return value;
  }
  throw new Error('Invalid judge mode. Use proxy|benchmark_single|benchmark_dual|both');
}

function shouldRunBenchmarkJudge(mode?: BenchmarkReportJudgeMode): boolean {
  return mode !== 'proxy';
}

function resolveDualJudgeMode(mode?: BenchmarkReportJudgeMode): boolean {
  return mode !== 'benchmark_single' && mode !== 'proxy';
}

function resolveOfficialReplicaCount(
  requestedReplicas: number | undefined,
  officialPack?: LoadedBenchmarkPack | null
): number {
  if (typeof requestedReplicas === 'number' && Number.isFinite(requestedReplicas)) {
    return Math.max(1, Math.floor(requestedReplicas));
  }
  if (officialPack?.definition.default_replicas) {
    return Math.max(1, officialPack.definition.default_replicas);
  }
  return 1;
}

async function buildBenchmarkJudgeArtifactForRun(input: {
  pack?: LoadedBenchmarkPack | null;
  history?: TrainingProgress[];
  runLabel: string;
  scope: 'profile_sweep' | 'routing_compare';
  profile?: TrainingProfile;
  variant?: string;
  replicaId?: string;
  judgeMode?: BenchmarkReportJudgeMode;
}): Promise<ExperimentBenchmarkRunArtifact | null> {
  if (!input.pack || !input.history || input.history.length === 0 || !shouldRunBenchmarkJudge(input.judgeMode)) {
    return null;
  }

  const traces = collectBenchmarkRunCaseTraces(input.history);
  const judged = await judgeBenchmarkRun({
    pack: input.pack,
    traces,
    dualJudge: resolveDualJudgeMode(input.judgeMode),
  });

  return {
    ...judged,
    run_label: input.runLabel,
    scope: input.scope,
    profile: input.profile,
    variant: input.variant,
    replica_id: input.replicaId,
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

function buildReplicaMeasurement(input: {
  label: string;
  replicaId?: string;
  row: ExperimentSummaryRow;
}): BenchmarkReplicaMeasurement {
  return {
    label: input.label,
    replica_id: input.replicaId,
    run_quality: input.row.run_quality,
    benchmark_overall: input.row.benchmark_scorecard?.overall ?? null,
    avg_quality: input.row.avgQuality,
    coverage: input.row.coverage,
    contradiction_rate: input.row.contradictionRate,
    duplication_rate: input.row.duplicationRate,
    pass_rate: input.row.benchmark_scorecard?.pass_rate ?? null,
    disputed_rate: input.row.benchmark_scorecard?.disputed_rate ?? null,
    disagreement_rate: input.row.benchmark_judge_disagreement?.disagreement_rate ?? null,
  };
}

function aggregateReplicaRunQuality(
  rows: ExperimentSummaryRow[],
  requiredMinCleanReplicas: number
): EvaluationRunQuality {
  const cleanCount = rows.filter((row) => row.run_quality === 'clean').length;
  if (cleanCount >= requiredMinCleanReplicas) return 'clean';
  if (cleanCount > 0) return 'inconclusive';
  if (rows.every((row) => row.run_quality === 'failed')) return 'failed';
  if (rows.every((row) => row.run_quality === 'contaminated')) return 'contaminated';
  if (rows.every((row) => row.run_quality === 'inconclusive')) return 'inconclusive';
  return rows[0]?.run_quality ?? 'inconclusive';
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function runSingleExperimentProfile(input: {
  slug: string;
  profile: TrainingProfile;
  basePersona: Persona;
  baseSoul: Soul;
  store: MemoryStore;
  stamp: string;
  rounds: number;
  questionsPerRound?: number;
  timeoutMs: number;
  providerName?: string;
  kimiStabilityMode?: string;
  trainingSeedHints: string[];
  replayManifestIndex: Map<string, FrozenBenchmarkCaseManifest> | null;
  officialPack: LoadedBenchmarkPack | null;
  judgeMode: BenchmarkReportJudgeMode;
  replicaGroup?: string;
  replicaId?: string;
}): Promise<ExperimentSingleRunResult> {
  const persona: Persona = {
    ...input.basePersona,
    id: crypto.randomUUID(),
    memory_collection: `${input.basePersona.memory_collection}_exp_${input.profile}_${input.stamp}${input.replicaId ? `_${input.replicaId}` : ''}`,
    training_rounds: 0,
    updated_at: new Date().toISOString(),
  };
  const soul: Soul = JSON.parse(JSON.stringify(input.baseSoul));
  soul.training_rounds_completed = 0;

  await input.store.ensureCollection(persona.memory_collection);

  const loop = new TrainingLoop(soul, persona, input.store);
  const replayManifest = input.officialPack
    ? input.officialPack.frozen_manifest
    : findReplayManifest(input.replayManifestIndex, 'profile_sweep', input.profile);
  const replayQuestionRounds = input.officialPack
    ? input.officialPack.question_rounds
    : replayManifest
      ? toFrozenQuestionRounds(replayManifest)
      : null;
  const replayConfig = replayQuestionRounds ? summarizeReplayQuestionRounds(replayQuestionRounds) : null;
  const effectiveRounds = replayConfig?.rounds ?? input.rounds;
  const questionsPerRound = replayConfig?.questionsPerRound ?? Math.max(1, input.questionsPerRound ?? 5);
  const executionSettings = resolveTrainingExecutionSettings({
    providerName: input.providerName,
    rounds: effectiveRounds,
    explicitKimiStabilityMode: input.kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE,
  });

  snapshotAndResetAgentFallbackMetrics();
  try {
    const result = await withTimeout(
      loop.run({
        maxRounds: effectiveRounds,
        profile: input.profile,
        questionsPerRound,
        frozenQuestionRounds: replayQuestionRounds ?? undefined,
        trainingSeedHints: input.trainingSeedHints,
        runtimePreset: executionSettings.runtimePreset,
        runtimeOverrides: executionSettings.runtimeOverrides,
        evaluatorLayered: executionSettings.evaluatorLayered,
        evaluatorDualReview: executionSettings.evaluatorDualReview,
        directorReviewInterval: executionSettings.directorReviewInterval,
        directorAlwaysOnFinalRound: executionSettings.directorAlwaysOnFinalRound,
      }),
      input.timeoutMs,
      `experiment profile ${input.profile}${input.replicaId ? ` (${input.replicaId})` : ''}`
    );

    const runtimeObservability = snapshotAndResetAgentFallbackMetrics();
    const runtimeSnapshot = toRuntimeObservabilitySnapshot(runtimeObservability);
    const judgeProvenance = buildJudgeProvenance({
      layeredMode: executionSettings.evaluatorLayered,
      dualReviewRequested: Boolean(executionSettings.evaluatorDualReview),
      evaluatorFallbacks: runtimeObservability.evaluatorFallbacks,
    });
    const history = result.history;
    const roundHistory = history.map((h) => ({
      round: h.round,
      avgQualityScore: h.avgQualityScore,
      contradictionRate: h.observability.contradictionRate,
      duplicationRate: h.observability.duplicationRate,
      nodesWritten: h.nodesWritten,
      nodesReinforced: h.nodesReinforced,
    }));
    const avgQuality = history.length === 0 ? 0 : average(history.map((h) => h.avgQualityScore));
    const contradictionRate = history.length === 0 ? 0 : average(history.map((h) => h.observability.contradictionRate));
    const duplicationRate = history.length === 0 ? 0 : average(history.map((h) => h.observability.duplicationRate));
    const contamination = classifyEvaluationRun({
      totalRounds: result.totalRounds,
      runtimeObservability: runtimeSnapshot,
      judgeProvenance,
    });
    const benchmarkArtifacts = buildExperimentBenchmarkArtifacts({
      slug: input.slug,
      suiteType: 'profile_sweep',
      profile: input.profile,
      rounds: effectiveRounds,
      questionsPerRound,
      smokeMode: effectiveRounds === 1 && questionsPerRound === 1,
      history,
      providerName: input.providerName,
      executionSettings,
      officialPack: input.officialPack,
      replicaGroup: input.replicaGroup,
      replicaId: input.replicaId,
    });
    const benchmarkJudgment = await buildBenchmarkJudgeArtifactForRun({
      pack: input.officialPack,
      history,
      runLabel: input.profile,
      scope: 'profile_sweep',
      profile: input.profile,
      replicaId: input.replicaId,
      judgeMode: input.judgeMode,
    });
    const row: ExperimentSummaryRow = {
      profile: input.profile,
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
      benchmark_scorecard: benchmarkJudgment?.scorecard,
      benchmark_case_summary: benchmarkJudgment?.case_summary,
      benchmark_judge_summary: benchmarkJudgment?.judge_summary,
      benchmark_judge_disagreement: benchmarkJudgment?.disagreement,
      benchmark_context: benchmarkArtifacts.benchmarkContext,
      runtime_observability: runtimeSnapshot,
    };

    return {
      row,
      roundHistory,
      benchmarkCaseManifest: benchmarkArtifacts.benchmarkCaseManifest,
      benchmarkJudgment,
      replicaMeasurement: buildReplicaMeasurement({
        label: input.profile,
        replicaId: input.replicaId,
        row,
      }),
    };
  } catch (error) {
    const message = String(error);
    const runtimeObservability = snapshotAndResetAgentFallbackMetrics();
    const runtimeSnapshot = toRuntimeObservabilitySnapshot(runtimeObservability);
    const judgeProvenance = buildJudgeProvenance({
      layeredMode: executionSettings.evaluatorLayered,
      dualReviewRequested: Boolean(executionSettings.evaluatorDualReview),
      evaluatorFallbacks: runtimeObservability.evaluatorFallbacks,
    });
    const contamination = classifyEvaluationRun({
      totalRounds: 0,
      runtimeObservability: runtimeSnapshot,
      judgeProvenance,
      failureError: message,
    });
    const benchmarkArtifacts = buildExperimentBenchmarkArtifacts({
      slug: input.slug,
      suiteType: 'profile_sweep',
      profile: input.profile,
      rounds: effectiveRounds,
      questionsPerRound,
      smokeMode: effectiveRounds === 1 && questionsPerRound === 1,
      providerName: input.providerName,
      executionSettings,
      officialPack: input.officialPack,
      replicaGroup: input.replicaGroup,
      replicaId: input.replicaId,
    });
    const row: ExperimentSummaryRow = {
      profile: input.profile,
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
    };
    return {
      row,
      roundHistory: [],
      benchmarkCaseManifest: benchmarkArtifacts.benchmarkCaseManifest,
      benchmarkJudgment: null,
      replicaMeasurement: buildReplicaMeasurement({
        label: input.profile,
        replicaId: input.replicaId,
        row,
      }),
      failure: message,
    };
  }
}

async function runSingleProfileExperiment(input: {
  slug: string;
  profile: TrainingProfile;
  rounds: number;
  questionsPerRound: number;
  basePersona: Persona;
  baseSoul: Soul;
  store: MemoryStore;
  stamp: string;
  providerName?: string;
  trainingSeedHints: string[];
  replayManifest?: FrozenBenchmarkCaseManifest | null;
  replayQuestionRounds?: TrainingQuestion[][] | null;
  effectiveRounds: number;
  executionSettings: TrainingExecutionSettings;
  officialPack?: LoadedBenchmarkPack | null;
  replicaGroup?: string;
  replicaId?: string;
  judgeMode?: BenchmarkReportJudgeMode;
  timeoutMs: number;
}): Promise<ExperimentSingleRunResult> {
  const persona: Persona = {
    ...input.basePersona,
    id: crypto.randomUUID(),
    memory_collection: `${input.basePersona.memory_collection}_exp_${input.profile}_${input.stamp}_${input.replicaId ?? 'single'}`,
    training_rounds: 0,
    updated_at: new Date().toISOString(),
  };
  const soul: Soul = JSON.parse(JSON.stringify(input.baseSoul));
  soul.training_rounds_completed = 0;

  await input.store.ensureCollection(persona.memory_collection);

  const loop = new TrainingLoop(soul, persona, input.store);
  snapshotAndResetAgentFallbackMetrics();

  try {
    const result = await withTimeout(
      loop.run({
        maxRounds: input.effectiveRounds,
        profile: input.profile,
        questionsPerRound: input.questionsPerRound,
        frozenQuestionRounds: input.replayQuestionRounds ?? undefined,
        trainingSeedHints: input.trainingSeedHints,
        runtimePreset: input.executionSettings.runtimePreset,
        runtimeOverrides: input.executionSettings.runtimeOverrides,
        evaluatorLayered: input.executionSettings.evaluatorLayered,
        evaluatorDualReview: input.executionSettings.evaluatorDualReview,
        directorReviewInterval: input.executionSettings.directorReviewInterval,
        directorAlwaysOnFinalRound: input.executionSettings.directorAlwaysOnFinalRound,
      }),
      input.timeoutMs,
      `experiment profile ${input.profile}${input.replicaId ? ` (${input.replicaId})` : ''}`
    );
    const runtimeObservability = snapshotAndResetAgentFallbackMetrics();
    const runtimeSnapshot = toRuntimeObservabilitySnapshot(runtimeObservability);
    const judgeProvenance = buildJudgeProvenance({
      layeredMode: input.executionSettings.evaluatorLayered,
      dualReviewRequested: Boolean(input.executionSettings.evaluatorDualReview),
      evaluatorFallbacks: runtimeObservability.evaluatorFallbacks,
    });
    const history = result.history;
    const roundHistory = history.map((h) => ({
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
      slug: input.slug,
      suiteType: 'profile_sweep',
      profile: input.profile,
      rounds: input.effectiveRounds,
      questionsPerRound: input.questionsPerRound,
      smokeMode: input.effectiveRounds === 1 && input.questionsPerRound === 1,
      history,
      providerName: input.providerName,
      executionSettings: input.executionSettings,
      officialPack: input.officialPack,
      replicaGroup: input.replicaGroup,
      replicaId: input.replicaId,
    });
    const benchmarkJudgeArtifact = await buildBenchmarkJudgeArtifactForRun({
      pack: input.officialPack,
      history,
      runLabel: input.replicaId ? `${input.profile}:${input.replicaId}` : input.profile,
      scope: 'profile_sweep',
      profile: input.profile,
      replicaId: input.replicaId,
      judgeMode: input.judgeMode,
    });

    const row: ExperimentSummaryRow = {
      profile: input.profile,
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
      benchmark_scorecard: benchmarkJudgeArtifact?.scorecard,
      benchmark_case_summary: benchmarkJudgeArtifact?.case_summary,
      benchmark_judge_summary: benchmarkJudgeArtifact?.judge_summary,
      benchmark_judge_disagreement: benchmarkJudgeArtifact?.disagreement,
      benchmark_context: benchmarkArtifacts.benchmarkContext,
      runtime_observability: runtimeSnapshot,
    };

    return {
      row,
      roundHistory,
      benchmarkCaseManifest: benchmarkArtifacts.benchmarkCaseManifest,
      benchmarkJudgment: benchmarkJudgeArtifact,
      replicaMeasurement: {
        label: input.profile,
        replica_id: input.replicaId,
        run_quality: contamination.status,
        benchmark_overall: benchmarkJudgeArtifact?.scorecard.overall ?? null,
        avg_quality: avgQuality,
        coverage: result.soul.coverage_score,
        contradiction_rate: contradictionRate,
        duplication_rate: duplicationRate,
        pass_rate: benchmarkJudgeArtifact?.scorecard.pass_rate ?? null,
        disputed_rate: benchmarkJudgeArtifact?.scorecard.disputed_rate ?? null,
        disagreement_rate: benchmarkJudgeArtifact?.disagreement.disagreement_rate ?? null,
      },
    };
  } catch (error) {
    const message = String(error);
    const runtimeObservability = snapshotAndResetAgentFallbackMetrics();
    const runtimeSnapshot = toRuntimeObservabilitySnapshot(runtimeObservability);
    const judgeProvenance = buildJudgeProvenance({
      layeredMode: input.executionSettings.evaluatorLayered,
      dualReviewRequested: Boolean(input.executionSettings.evaluatorDualReview),
      evaluatorFallbacks: runtimeObservability.evaluatorFallbacks,
    });
    const contamination = classifyEvaluationRun({
      totalRounds: 0,
      runtimeObservability: runtimeSnapshot,
      judgeProvenance,
      failureError: message,
    });
    const benchmarkArtifacts = buildExperimentBenchmarkArtifacts({
      slug: input.slug,
      suiteType: 'profile_sweep',
      profile: input.profile,
      rounds: input.effectiveRounds,
      questionsPerRound: input.questionsPerRound,
      smokeMode: input.effectiveRounds === 1 && input.questionsPerRound === 1,
      providerName: input.providerName,
      executionSettings: input.executionSettings,
      officialPack: input.officialPack,
      replicaGroup: input.replicaGroup,
      replicaId: input.replicaId,
    });
    return {
      row: {
        profile: input.profile,
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
      },
      roundHistory: [],
      benchmarkCaseManifest: benchmarkArtifacts.benchmarkCaseManifest,
      benchmarkJudgment: null,
      replicaMeasurement: {
        label: input.profile,
        replica_id: input.replicaId,
        run_quality: contamination.status,
        benchmark_overall: null,
        avg_quality: 0,
        coverage: 0,
        contradiction_rate: 1,
        duplication_rate: 1,
        pass_rate: null,
        disputed_rate: null,
        disagreement_rate: null,
      },
    };
  }
}

function aggregateReplicaRuns(input: {
  profile: TrainingProfile;
  replicaGroup?: string;
  replicaRuns: ExperimentSingleRunResult[];
  judgeMode?: BenchmarkReportJudgeMode;
}): BenchmarkAggregationResult {
  const cleanRuns = input.replicaRuns.filter((item) => item.row.run_quality === 'clean');
  const selectedRuns = cleanRuns.length > 0 ? cleanRuns : input.replicaRuns;
  const firstRow = input.replicaRuns[0]?.row;
  if (!firstRow) {
    throw new Error(`no replica runs available for profile "${input.profile}"`);
  }

  const runQuality = summarizeAggregateRunQuality(input.replicaRuns.map((item) => item.row.run_quality));
  const avgQuality = mean(selectedRuns.map((item) => item.row.avgQuality));
  const contradictionRate = mean(selectedRuns.map((item) => item.row.contradictionRate));
  const duplicationRate = mean(selectedRuns.map((item) => item.row.duplicationRate));
  const coverage = mean(selectedRuns.map((item) => item.row.coverage));
  const runtimeObservability = summarizeRuntimeObservability(selectedRuns.map((item) => item.row.runtime_observability));
  const benchmarkJudgments = input.replicaRuns
    .map((item) => item.benchmarkJudgment)
    .filter((item): item is ExperimentBenchmarkRunArtifact => Boolean(item));
  const benchmarkScorecard = aggregateBenchmarkScorecard(benchmarkJudgments);
  const benchmarkCaseSummary = aggregateBenchmarkCaseSummary(benchmarkJudgments);
  const benchmarkDisagreement = aggregateBenchmarkDisagreement(benchmarkJudgments);
  const benchmarkJudgeSummary = aggregateBenchmarkJudgeSummary(benchmarkJudgments, benchmarkScorecard, benchmarkCaseSummary, benchmarkDisagreement);
  const benchmarkReplicaSummary = buildBenchmarkReplicaSummary({
    replicaGroup: input.replicaGroup,
    replicas: input.replicaRuns.map((item) => item.replicaMeasurement),
  });

  return {
    row: {
      ...firstRow,
      totalRounds: Math.round(mean(selectedRuns.map((item) => item.row.totalRounds))),
      avgQuality,
      contradictionRate,
      duplicationRate,
      coverage,
      run_quality: runQuality,
      scorecard: buildEvaluationScorecard({
        avgQuality,
        contradictionRate,
        duplicationRate,
        coverage,
        runQuality,
        runtimeObservability: runtimeObservability ?? undefined,
      }),
      benchmark_scorecard: benchmarkScorecard,
      benchmark_case_summary: benchmarkCaseSummary,
      benchmark_judge_summary: benchmarkJudgeSummary,
      benchmark_judge_disagreement: benchmarkDisagreement,
      benchmark_replica_summary: benchmarkReplicaSummary,
      runtime_observability: runtimeObservability ?? undefined,
      judge_provenance: {
        ...(firstRow.judge_provenance ?? buildJudgeProvenance({
          layeredMode: false,
          dualReviewRequested: false,
          evaluatorFallbacks: 0,
        })),
        mode: resolveAggregateJudgeProvenanceMode(input.judgeMode),
        dual_review_requested: resolveDualJudgeMode(input.judgeMode),
        dual_review_active: resolveDualJudgeMode(input.judgeMode),
        fallback_used: (runtimeObservability?.evaluator_fallbacks ?? 0) > 0,
        evaluator_fallbacks: runtimeObservability?.evaluator_fallbacks ?? 0,
      },
    },
    roundHistory: aggregateRoundHistories(selectedRuns.map((item) => item.roundHistory)),
    benchmarkCaseManifests: input.replicaRuns
      .map((item) => item.benchmarkCaseManifest)
      .filter((item): item is FrozenBenchmarkCaseManifest => Boolean(item)),
    benchmarkJudgments,
    replicaMeasurements: input.replicaRuns.map((item) => item.replicaMeasurement),
  };
}

function summarizeAggregateRunQuality(
  qualities: Array<EvaluationRunQuality | undefined>
): EvaluationRunQuality {
  const normalized = qualities.map((item) => item ?? 'clean');
  if (normalized.every((item) => item === 'clean')) return 'clean';
  if (normalized.some((item) => item === 'clean')) return 'contaminated';
  if (normalized.every((item) => item === 'failed')) return 'failed';
  if (normalized.some((item) => item === 'failed')) return 'failed';
  if (normalized.some((item) => item === 'contaminated')) return 'contaminated';
  return 'inconclusive';
}

function summarizeRuntimeObservability(
  values: Array<ExperimentSummaryRow['runtime_observability'] | undefined>
): ExperimentSummaryRow['runtime_observability'] | null {
  const measured = values.filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (measured.length === 0) return null;
  return {
    trainer_fallbacks: measured.reduce((sum, item) => sum + item.trainer_fallbacks, 0),
    persona_fallbacks: measured.reduce((sum, item) => sum + item.persona_fallbacks, 0),
    evaluator_fallbacks: measured.reduce((sum, item) => sum + item.evaluator_fallbacks, 0),
    director_fallbacks: measured.reduce((sum, item) => sum + item.director_fallbacks, 0),
  };
}

function aggregateRoundHistories(histories: ExperimentRoundHistoryItem[][]): ExperimentRoundHistoryItem[] {
  const roundCount = histories.reduce((best, items) => Math.max(best, items.length), 0);
  const aggregated: ExperimentRoundHistoryItem[] = [];
  for (let index = 0; index < roundCount; index += 1) {
    const rows = histories.map((items) => items[index]).filter((item): item is ExperimentRoundHistoryItem => Boolean(item));
    if (rows.length === 0) continue;
    aggregated.push({
      round: index + 1,
      avgQualityScore: mean(rows.map((item) => item.avgQualityScore)),
      contradictionRate: mean(rows.map((item) => item.contradictionRate)),
      duplicationRate: mean(rows.map((item) => item.duplicationRate)),
      nodesWritten: Math.round(mean(rows.map((item) => item.nodesWritten))),
      nodesReinforced: Math.round(mean(rows.map((item) => item.nodesReinforced))),
    });
  }
  return aggregated;
}

function aggregateBenchmarkScorecard(
  judgments: ExperimentBenchmarkRunArtifact[]
): BenchmarkScorecard | undefined {
  if (judgments.length === 0) return undefined;
  const first = judgments[0]!.scorecard;
  const dimensionKeys = [...new Set(judgments.flatMap((item) => Object.keys(item.scorecard.dimension_scores)))];
  return {
    version: 'benchmark-scorecard-v1',
    summary: `Aggregated over ${judgments.length} clean replica(s)`,
    overall: mean(judgments.map((item) => item.scorecard.overall)),
    pass_rate: mean(judgments.map((item) => item.scorecard.pass_rate)),
    abstain_rate: mean(judgments.map((item) => item.scorecard.abstain_rate)),
    disputed_rate: mean(judgments.map((item) => item.scorecard.disputed_rate)),
    case_count: first.case_count,
    dimension_scores: Object.fromEntries(
      dimensionKeys.map((key) => [key, mean(judgments.map((item) => item.scorecard.dimension_scores[key] ?? 0))])
    ),
  };
}

function aggregateBenchmarkCaseSummary(
  judgments: ExperimentBenchmarkRunArtifact[]
): BenchmarkCaseSummary | undefined {
  if (judgments.length === 0) return undefined;
  const first = judgments[0]!.case_summary;
  return {
    case_count: first.case_count,
    judged_case_count: first.judged_case_count,
    pass_count: Math.round(mean(judgments.map((item) => item.case_summary.pass_count))),
    fail_count: Math.round(mean(judgments.map((item) => item.case_summary.fail_count))),
    abstained_count: Math.round(mean(judgments.map((item) => item.case_summary.abstained_count))),
    disputed_case_count: Math.round(mean(judgments.map((item) => item.case_summary.disputed_case_count))),
    missing_trace_count: Math.round(mean(judgments.map((item) => item.case_summary.missing_trace_count))),
  };
}

function aggregateBenchmarkDisagreement(
  judgments: ExperimentBenchmarkRunArtifact[]
): BenchmarkJudgeDisagreement | undefined {
  if (judgments.length === 0) return undefined;
  return {
    active: judgments.some((item) => item.disagreement.active),
    judge_count: Math.max(...judgments.map((item) => item.disagreement.judge_count)),
    disagreement_rate: mean(judgments.map((item) => item.disagreement.disagreement_rate)),
    verdict_conflicts: Math.round(mean(judgments.map((item) => item.disagreement.verdict_conflicts))),
    high_delta_cases: [...new Set(judgments.flatMap((item) => item.disagreement.high_delta_cases))],
    disputed_case_ids: [...new Set(judgments.flatMap((item) => item.disagreement.disputed_case_ids))],
  };
}

function aggregateBenchmarkJudgeSummary(
  judgments: ExperimentBenchmarkRunArtifact[],
  scorecard?: BenchmarkScorecard,
  caseSummary?: BenchmarkCaseSummary,
  disagreement?: BenchmarkJudgeDisagreement
): BenchmarkJudgeSummary | undefined {
  if (judgments.length === 0 || !scorecard || !caseSummary || !disagreement) return undefined;
  const first = judgments[0]!;
  return {
    version: 'benchmark-judge-summary-v1',
    judge_mode: first.judge_mode,
    pack_id: first.pack_id,
    pack_version: first.pack_version,
    case_count: caseSummary.case_count,
    judged_case_count: caseSummary.judged_case_count,
    disputed_case_count: caseSummary.disputed_case_count,
    pass_rate: scorecard.pass_rate,
    overall: scorecard.overall,
    disagreement,
  };
}

function resolveAggregateJudgeProvenanceMode(mode?: BenchmarkReportJudgeMode): JudgeProvenance['mode'] {
  if (mode === 'benchmark_dual' || mode === 'both') return 'dual_review';
  return 'standard';
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildProfileSweepBenchmarkGovernance(input: {
  rows: ExperimentSummaryRow[];
  replicaMeasurements: Record<string, BenchmarkReplicaMeasurement[]>;
  officialPack?: LoadedBenchmarkPack | null;
  benchmarkManifests: BenchmarkCaseManifest[];
  judgeMode?: BenchmarkReportJudgeMode;
  baselineProfile?: TrainingProfile;
  compareProfile?: TrainingProfile;
  significanceEnabled?: boolean;
}) {
  if (!input.officialPack) {
    return {
      benchmarkSignificance: null,
      benchmarkGovernance: null,
    };
  }

  const baselineProfile = input.baselineProfile ?? 'baseline';
  const compareProfile = input.compareProfile ?? 'full';
  const baselineRow = input.rows.find((row) => row.profile === baselineProfile) ?? null;
  const compareRow = input.rows.find((row) => row.profile === compareProfile) ?? null;
  if (!baselineRow || !compareRow) {
    return {
      benchmarkSignificance: null,
      benchmarkGovernance: null,
    };
  }
  const compareReplicaSummary = compareRow?.benchmark_replica_summary ?? null;
  const significance =
    input.significanceEnabled
      ? computePairedBootstrapSignificance({
        groupA: input.replicaMeasurements[baselineProfile] ?? [],
        groupB: input.replicaMeasurements[compareProfile] ?? [],
        seedKey: `${input.officialPack.summary.pack_id}:${baselineProfile}:${compareProfile}`,
      })
      : null;
  const governance = buildBenchmarkGovernanceSummary({
    pack: input.officialPack.summary,
    judgeMode: input.judgeMode ?? 'both',
    homogeneity: summarizeBenchmarkHomogeneity(input.benchmarkManifests),
    replicaSummary: compareReplicaSummary,
    significance,
    requiredMinCleanReplicas:
      input.officialPack.definition.min_clean_replicas ??
      input.officialPack.definition.default_replicas ??
      2,
    judgeDisagreementRate: compareRow?.benchmark_judge_disagreement?.disagreement_rate ?? 0,
  });

  if (compareRow) {
    compareRow.benchmark_governance = governance;
  }

  return {
    benchmarkSignificance: significance,
    benchmarkGovernance: governance,
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
    officialPack?: LoadedBenchmarkPack | null;
    replicas?: number;
    judgeMode?: BenchmarkReportJudgeMode;
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
  const benchmarkJudgments: ExperimentBenchmarkRunArtifact[] = [];
  const replicaMeasurements: Record<string, BenchmarkReplicaMeasurement[]> = {};
  const failures: Array<{ profile: TrainingProfile; error: string }> = [];
  const providerName = resolvePreferredProviderName();
  const trainingSeedMode = normalizeTrainingSeedMode(options?.trainingSeedMode);
  const trainingSeedSelection = loadTrainingSeedHints(dir, trainingSeedMode);
  const replayManifestIndex = buildReplayManifestIndex(options?.benchmarkCaseManifests);
  const officialPack = options?.officialPack ?? null;
  const judgeMode = options?.judgeMode ?? 'both';

  const profileTimeoutMs = Math.max(10_000, options?.timeoutMs ?? EXPERIMENT_PROFILE_TIMEOUT_MS);

  for (const profile of profiles) {
    const replayManifest = officialPack ? officialPack.frozen_manifest : findReplayManifest(replayManifestIndex, 'profile_sweep', profile);
    const replayQuestionRounds = officialPack
      ? officialPack.question_rounds
      : replayManifest
        ? toFrozenQuestionRounds(replayManifest)
        : null;
    const replayConfig = replayQuestionRounds ? summarizeReplayQuestionRounds(replayQuestionRounds) : null;
    const effectiveRounds = replayConfig?.rounds ?? rounds;
    const questionsPerRound = replayConfig?.questionsPerRound ?? Math.max(1, options?.questionsPerRound ?? 5);
    const executionSettings = resolveTrainingExecutionSettings({
      providerName,
      rounds: effectiveRounds,
      explicitKimiStabilityMode: options?.kimiStabilityMode ?? process.env.NEEKO_KIMI_STABILITY_MODE,
    });
    const effectiveReplicas = officialPack
      ? resolveOfficialReplicaCount(options?.replicas, officialPack)
      : 1;
    const replicaGroup = officialPack && effectiveReplicas > 1
      ? `${slug}:${profile}:${stamp}`
      : undefined;
    const replicaRuns: ExperimentSingleRunResult[] = [];

    for (let replicaIndex = 0; replicaIndex < effectiveReplicas; replicaIndex += 1) {
      const replicaId = effectiveReplicas > 1 ? `r${String(replicaIndex + 1).padStart(2, '0')}` : undefined;
      const singleRun = await runSingleProfileExperiment({
        slug,
        profile,
        rounds,
        questionsPerRound,
        basePersona,
        baseSoul,
        store,
        stamp,
        providerName,
        trainingSeedHints: trainingSeedSelection.hints,
        replayManifest,
        replayQuestionRounds,
        effectiveRounds,
        executionSettings,
        officialPack,
        replicaGroup,
        replicaId,
        judgeMode,
        timeoutMs: profileTimeoutMs,
      });
      replicaRuns.push(singleRun);
      if (singleRun.row.run_quality !== 'clean') {
        console.log(
          chalk.yellow(
            `${chalk.bold(profile.padEnd(8))}${replicaId ? ` ${replicaId}` : ''} status=${singleRun.row.run_quality}`
          )
        );
      }
    }

    const aggregated = aggregateReplicaRuns({
      profile,
      replicaGroup,
      replicaRuns,
      judgeMode,
    });

    const failedReplicaCount = replicaRuns.filter((item) => item.row.run_quality !== 'clean').length;
    if (failedReplicaCount > 0) {
      failures.push({
        profile,
        error: `${failedReplicaCount}/${replicaRuns.length} replica(s) were excluded from clean aggregation`,
      });
    }

    rows.push(aggregated.row);
    roundHistories[profile] = aggregated.roundHistory;
    benchmarkCaseManifests.push(...aggregated.benchmarkCaseManifests);
    benchmarkJudgments.push(...aggregated.benchmarkJudgments);
    replicaMeasurements[profile] = aggregated.replicaMeasurements;

    console.log(
      `${chalk.bold(profile.padEnd(8))} replicas=${String(aggregated.replicaMeasurements.length).padEnd(2)} ` +
      `clean=${String(aggregated.row.benchmark_replica_summary?.clean_replica_count ?? (aggregated.row.run_quality === 'clean' ? 1 : 0)).padEnd(2)} ` +
      `quality=${(aggregated.row.avgQuality * 100).toFixed(1).padStart(5)}% ` +
      `contra=${(aggregated.row.contradictionRate * 100).toFixed(1).padStart(5)}% ` +
      `dup=${(aggregated.row.duplicationRate * 100).toFixed(1).padStart(5)}% ` +
      `coverage=${(aggregated.row.coverage * 100).toFixed(1).padStart(5)}% ` +
      `status=${aggregated.row.run_quality}`
    );
  }

  return {
    rows,
    roundHistories,
    benchmarkCaseManifests: collectFrozenBenchmarkCaseManifests(benchmarkCaseManifests),
    benchmarkJudgments,
    replicaMeasurements,
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
    officialPack?: string;
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
    replicas?: string;
    significance?: boolean;
    judgeMode?: string;
  }
): Promise<void> {
  if (options.benchmarkManifest && options.officialPack) {
    throw new Error('--benchmark-manifest and --official-pack cannot be used together');
  }

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
  const judgeMode = normalizeJudgeMode(options.judgeMode);
  const officialPack = options.officialPack
    ? loadBenchmarkPack(options.officialPack, { repoRoot: process.cwd() })
    : null;
  const parsedRequestedReplicas =
    options.replicas === undefined ? undefined : Math.max(1, parseInt(options.replicas, 10));
  if ((options.replicas || options.significance) && !officialPack) {
    throw new Error('--replicas and --significance require --official-pack');
  }
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
  const requestedReplicas = resolveOfficialReplicaCount(parsedRequestedReplicas, officialPack);
  const significanceEnabled = Boolean(officialPack && (options.significance || requestedReplicas > 1 || options.gate));

  if (benchmarkReplayMeta.active) {
    console.log(
      chalk.dim(
        `Replay benchmark source: ${benchmarkReplayMeta.source_path} (${benchmarkReplayMeta.replay_manifest_count} frozen manifest(s))`
      )
    );
  }
  if (officialPack) {
    console.log(
      chalk.dim(
        `Official benchmark pack: ${officialPack.summary.pack_id}@${officialPack.summary.pack_version} ` +
        `(${officialPack.summary.case_count} case(s), source=${officialPack.summary.source_kind})`
      )
    );
  }

  const {
    rows,
    roundHistories,
    benchmarkCaseManifests: profileBenchmarkCaseManifests,
    benchmarkJudgments: profileBenchmarkJudgments,
    replicaMeasurements,
    failures,
  } = options.skipProfileSweep
    ? { rows: [], roundHistories: {}, benchmarkCaseManifests: [], benchmarkJudgments: [], replicaMeasurements: {}, failures: [] }
    : await runExperimentProfiles(slug, rounds, profiles, {
      kimiStabilityMode,
      trainingSeedMode,
      questionsPerRound,
      benchmarkCaseManifests: replayBenchmarkCaseManifests,
      officialPack,
      replicas: requestedReplicas,
      judgeMode,
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
        replayBenchmarkCaseManifests,
        officialPack,
        judgeMode
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
        replayBenchmarkCaseManifests,
        officialPack,
        judgeMode
    )
    : {
      rows: [],
      recommendation: null,
      dynamicScalingRecommendation: null,
      routingDecisionRecord: null,
      benchmarkCaseManifests: [],
      benchmarkJudgments: [],
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
    ...(officialPack ? [officialPack.frozen_manifest] : []),
  ]);
  const replayReportShape = inferReplayReportShape(benchmarkCaseManifests);
  const reportRounds = replayReportShape?.rounds ?? officialPack?.benchmark_context.rounds ?? rounds;
  const reportQuestionsPerRound =
    replayReportShape?.questionsPerRound ?? officialPack?.benchmark_context.questions_per_round ?? questionsPerRound;
  const benchmarkManifests = benchmarkCaseManifests.length > 0
    ? benchmarkCaseManifests.map((item) => item.manifest)
    : officialPack
      ? [officialPack.frozen_manifest.manifest]
      : collectBenchmarkManifests([...rows, ...inputRoutingComparison.rows]);
  const { benchmarkSignificance, benchmarkGovernance } = buildProfileSweepBenchmarkGovernance({
    rows,
    replicaMeasurements,
    officialPack,
    benchmarkManifests,
    judgeMode,
    significanceEnabled,
  });

  const outputDir = options.outputDir ? options.outputDir : join(settings.getPersonaDir(slug), 'experiments');
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outputDir, `experiment-${slug}-${timestamp}.json`);
  const csvPath = join(outputDir, `experiment-${slug}-${timestamp}.csv`);
  const manifestPath = join(outputDir, `experiment-${slug}-${timestamp}.benchmark-manifest.json`);
  const benchmarkJudgmentsPath = join(outputDir, `experiment-${slug}-${timestamp}.benchmark-judgments.json`);
  const benchmarkSummaryPath = join(outputDir, `experiment-${slug}-${timestamp}.benchmark-summary.json`);
  const benchmarkJudgments = [
    ...profileBenchmarkJudgments,
    ...inputRoutingComparison.benchmarkJudgments,
  ];

  const gateResult = evaluateGate(rows, {
    enabled: options.gate === true,
    maxQualityDrop: parseFloat(options.maxQualityDrop ?? '0.02'),
    maxContradictionRise: parseFloat(options.maxContradictionRise ?? '0.03'),
    maxDuplicationRise: parseFloat(options.maxDuplicationRise ?? '0.05'),
    baselineProfile: 'baseline',
    compareProfile: 'full',
    benchmarkGovernance,
  });

  const report = buildExperimentReport({
    slug,
    profiles,
    reportRounds,
    reportQuestionsPerRound,
    rows,
    strictOfficialSummaryRows,
    compatibleOfficialSummaryRows,
    observedBestProfile,
    effectiveBestProfile,
    roundHistories,
    failures: failures ?? [],
    effectiveInputRouting,
    providerName,
    kimiStabilityMode,
    effectiveTrainingSeedMode,
    inputRoutingComparison,
    strictOfficialComparisonRows,
    compatibleOfficialComparisonRows,
    currentGrayPathRecommendation,
    benchmarkManifests,
    benchmarkCaseManifests,
    benchmarkJudgments,
    benchmarkReplayMeta,
    artifactRefs: {
      benchmark_manifest_path: manifestPath,
      benchmark_pack_path: officialPack?.source.resolved_pack_path,
      benchmark_judgments_path: benchmarkJudgments.length > 0 ? benchmarkJudgmentsPath : undefined,
      benchmark_summary_path: benchmarkJudgments.length > 0 ? benchmarkSummaryPath : undefined,
      report_path: jsonPath,
      report_csv_path: csvPath,
    },
    gateResult,
    officialPack,
    benchmarkSignificance,
    benchmarkGovernance,
  });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  if (benchmarkJudgments.length > 0) {
    writeFileSync(
      benchmarkJudgmentsPath,
      JSON.stringify(
        {
          schema_version: 1,
          generated_at: report.generated_at,
          slug,
          benchmark_pack: officialPack?.summary,
          runs: benchmarkJudgments,
        },
        null,
        2
      ),
      'utf-8'
    );
    writeFileSync(
      benchmarkSummaryPath,
      JSON.stringify(
        {
          schema_version: 1,
          generated_at: report.generated_at,
          slug,
          benchmark_pack: officialPack?.summary,
          benchmark_scorecards: report.benchmark_scorecards ?? [],
          benchmark_judge_summary: report.benchmark_judge_summary ?? null,
          benchmark_replica_summaries: report.benchmark_replica_summaries ?? [],
          benchmark_significance: report.benchmark_significance ?? null,
          benchmark_governance: report.benchmark_governance ?? null,
        },
        null,
        2
      ),
      'utf-8'
    );
  }
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schema_version: 2,
        version: 'evaluation-v2-p2',
        generated_at: report.generated_at,
        slug,
        benchmark_pack: officialPack?.summary,
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
  if (benchmarkJudgments.length > 0) {
    console.log(chalk.dim(`Benchmark judgments: ${benchmarkJudgmentsPath}`));
    console.log(chalk.dim(`Benchmark summary:   ${benchmarkSummaryPath}`));
  }
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
  if (benchmarkSignificance) {
    console.log(
      chalk.dim(
        `Benchmark significance: ${benchmarkSignificance.significance_status} ` +
        `(delta=${(benchmarkSignificance.delta_mean ?? 0).toFixed(4)}, ` +
        `ci=[${(benchmarkSignificance.ci_low ?? 0).toFixed(4)}, ${(benchmarkSignificance.ci_high ?? 0).toFixed(4)}])`
      )
    );
  }
  if (benchmarkGovernance) {
    console.log(
      chalk.dim(
        `Benchmark governance: ${benchmarkGovernance.promotion_readiness} ` +
        `(${benchmarkGovernance.significance_status})`
      )
    );
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
  replayBenchmarkCaseManifests?: FrozenBenchmarkCaseManifest[],
  officialPack?: LoadedBenchmarkPack | null,
  judgeMode: BenchmarkReportJudgeMode = 'both'
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
      benchmarkJudgments: [],
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
      benchmarkJudgments: [],
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
  const producedBenchmarkJudgments: ExperimentBenchmarkRunArtifact[] = [];
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
    const replayManifest = officialPack
      ? officialPack.frozen_manifest
      : findReplayManifest(
        replayManifestIndex,
        'routing_compare',
        `${strategy}:${trainingSeedSelection.mode}`
      );
    const replayQuestionRounds = officialPack
      ? officialPack.question_rounds
      : replayManifest
        ? toFrozenQuestionRounds(replayManifest)
        : null;
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
        dualReviewRequested: Boolean(executionSettings.evaluatorDualReview),
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
        officialPack,
      });
      if (benchmarkArtifacts.benchmarkCaseManifest) {
        producedBenchmarkCaseManifests.push(benchmarkArtifacts.benchmarkCaseManifest);
      }
      const benchmarkJudgeArtifact = await buildBenchmarkJudgeArtifactForRun({
        pack: officialPack,
        history,
        runLabel: `${profile}+${strategy}+${trainingSeedSelection.mode}`,
        scope: 'routing_compare',
        profile,
        variant: `${strategy}:${trainingSeedSelection.mode}`,
        judgeMode,
      });
      if (benchmarkJudgeArtifact) {
        producedBenchmarkJudgments.push(benchmarkJudgeArtifact);
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
        benchmark_scorecard: benchmarkJudgeArtifact?.scorecard,
        benchmark_case_summary: benchmarkJudgeArtifact?.case_summary,
        benchmark_judge_summary: benchmarkJudgeArtifact?.judge_summary,
        benchmark_judge_disagreement: benchmarkJudgeArtifact?.disagreement,
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
        dualReviewRequested: Boolean(executionSettings.evaluatorDualReview),
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
        officialPack,
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
          trainer_fallbacks: runtimeObservability.trainerFallbacks,
          persona_fallbacks: runtimeObservability.personaFallbacks,
          evaluator_fallbacks: runtimeObservability.evaluatorFallbacks,
          director_fallbacks: runtimeObservability.directorFallbacks,
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
    benchmarkJudgments: producedBenchmarkJudgments,
  };
}

export const __experimentTestables = {
  buildExperimentReport,
  resolveOfficialReplicaCount,
};

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

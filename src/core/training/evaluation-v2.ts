import { createHash } from 'crypto';
import type { TrainingQuestion } from './types.js';

export type EvaluationAxisKey =
  | 'persona_fidelity'
  | 'groundedness'
  | 'user_usefulness'
  | 'boundary_safety'
  | 'writeback_quality'
  | 'runtime_reliability';

export type EvaluationRunQuality = 'clean' | 'contaminated' | 'failed' | 'inconclusive';

export type EvaluationContaminationReason =
  | 'provider_fallback'
  | 'judge_fallback'
  | 'runtime_timeout'
  | 'schema_drift'
  | 'partial_observability'
  | 'rerun_mismatch';

export interface EvaluationAxisScore {
  score: number;
  basis: 'proxy';
  note: string;
}

export interface EvaluationScorecard {
  version: 'evaluation-v2-p0' | 'evaluation-v2-p1';
  summary: string;
  overall: number;
  axes: Record<EvaluationAxisKey, EvaluationAxisScore>;
}

export interface EvaluationContamination {
  status: EvaluationRunQuality;
  reasons: EvaluationContaminationReason[];
  summary: string;
  details: string[];
}

export interface JudgeProvenance {
  mode: 'standard' | 'dual_review' | 'layered_judge';
  calibration_version: string;
  calibration_examples: number;
  dual_review_requested: boolean;
  dual_review_active: boolean;
  layered_mode: boolean;
  fallback_used: boolean;
  evaluator_fallbacks: number;
}

export interface RuntimeFallbackSummary {
  trainer_fallbacks: number;
  persona_fallbacks: number;
  evaluator_fallbacks: number;
  director_fallbacks: number;
}

export type BenchmarkSuiteType = 'profile_sweep' | 'routing_compare' | 'smoke_pk' | 'ab_regression';

export type BenchmarkSuiteTier = 'official' | 'regression' | 'smoke' | 'ad_hoc';

export type BenchmarkReplayMode = 'recipe_only' | 'replica_summary';

export type BenchmarkFreezeLevel = 'recipe_only' | 'frozen_cases';

export interface BenchmarkCaseEntry {
  case_id: string;
  round: number;
  ordinal: number;
  question: string;
  strategy?: string;
  target_dimension?: string;
  expected_challenge_level?: string;
}

export interface BenchmarkFreezeFingerprints {
  provider_fingerprint: string;
  runtime_fingerprint: string;
  judge_fingerprint: string;
}

export interface BenchmarkCaseManifest {
  manifest_id: string;
  manifest_version: 'benchmark-case-manifest-v1' | 'benchmark-case-manifest-v2';
  pack_version: string;
  recipe_version: 'training-question-recipe-v1';
  suite_label: string;
  suite_tier: BenchmarkSuiteTier;
  flavor: string;
  replayable: boolean;
  replay_mode: BenchmarkReplayMode;
  freeze_level?: BenchmarkFreezeLevel;
  case_manifest_hash?: string;
  question_digest?: string;
  case_count?: number;
  provider_fingerprint?: string;
  runtime_fingerprint?: string;
  judge_fingerprint?: string;
  replica_group?: string;
  replica_id?: string;
}

export interface FrozenBenchmarkCaseManifest {
  manifest: BenchmarkCaseManifest;
  cases: BenchmarkCaseEntry[];
}

export interface BenchmarkContext {
  pack_id: string;
  pack_type: 'ad_hoc' | 'smoke';
  suite_type: BenchmarkSuiteType;
  suite_tier: BenchmarkSuiteTier;
  case_count: number;
  rounds: number;
  questions_per_round: number;
  case_distribution: Record<string, number>;
  case_manifest: BenchmarkCaseManifest;
}

export interface BenchmarkHomogeneitySummary {
  homogeneous: boolean;
  reasons: string[];
  manifest_versions: string[];
  freeze_levels: string[];
  suite_labels: string[];
  pack_versions: string[];
  provider_fingerprints: string[];
  runtime_fingerprints: string[];
  judge_fingerprints: string[];
}

export type EvaluationStabilityLabel = 'stable' | 'provisional' | 'volatile' | 'insufficient_evidence';

export interface EvaluationMetricSpread {
  mean: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
  stddev: number | null;
}

export interface EvaluationRerunStability {
  version: 'evaluation-v2-p1';
  replica_count: number;
  clean_replica_count: number;
  excluded_replica_count: number;
  stability_label: EvaluationStabilityLabel;
  stable: boolean;
  reasons: string[];
  quality: EvaluationMetricSpread;
  coverage: EvaluationMetricSpread;
  contradiction_rate: EvaluationMetricSpread;
  duplication_rate: EvaluationMetricSpread;
}

export function buildJudgeProvenance(input: {
  layeredMode: boolean;
  dualReviewRequested: boolean;
  evaluatorFallbacks: number;
  calibrationVersion?: string;
  calibrationExamples?: number;
}): JudgeProvenance {
  return {
    mode: input.dualReviewRequested ? 'dual_review' : input.layeredMode ? 'layered_judge' : 'standard',
    calibration_version: input.calibrationVersion ?? 'evaluation-rubric-v1-mini',
    calibration_examples: Math.max(0, input.calibrationExamples ?? 3),
    dual_review_requested: input.dualReviewRequested,
    dual_review_active: input.dualReviewRequested,
    layered_mode: input.layeredMode,
    fallback_used: input.evaluatorFallbacks > 0,
    evaluator_fallbacks: input.evaluatorFallbacks,
  };
}

export function buildBenchmarkContext(input: {
  slug: string;
  suiteType: BenchmarkSuiteType;
  profile?: string;
  variant?: string;
  rounds: number;
  questionsPerRound: number;
  smokeMode?: boolean;
  suiteTier?: BenchmarkSuiteTier;
  replicaGroup?: string;
  replicaId?: string;
  caseManifest?: BenchmarkCaseManifest;
}): BenchmarkContext {
  const flavor = input.profile ?? input.variant ?? 'main';
  const suiteTier = input.suiteTier ?? inferBenchmarkSuiteTier(input.suiteType, input.smokeMode);
  const defaultCaseCount = Math.max(1, input.rounds * input.questionsPerRound);
  const signature = stableDigest({
    slug: input.slug,
    suite_type: input.suiteType,
    suite_tier: suiteTier,
    flavor,
    rounds: input.rounds,
    questions_per_round: input.questionsPerRound,
    smoke_mode: Boolean(input.smokeMode),
  });
  const packVersion = `pack-v1-${signature}`;
  const manifestId = `${input.suiteType}:${input.slug}:${flavor}:${signature}`;
  const caseManifest = input.caseManifest ?? {
    manifest_id: manifestId,
    manifest_version: 'benchmark-case-manifest-v1',
    pack_version: packVersion,
    recipe_version: 'training-question-recipe-v1',
    suite_label: `${input.suiteType}:${flavor}`,
    suite_tier: suiteTier,
    flavor,
    replayable: Boolean(input.replicaGroup),
    replay_mode: input.replicaGroup ? 'replica_summary' : 'recipe_only',
    freeze_level: 'recipe_only',
    case_count: defaultCaseCount,
    replica_group: input.replicaGroup,
    replica_id: input.replicaId,
  } satisfies BenchmarkCaseManifest;
  return {
    pack_id: `${input.suiteType}:${input.slug}:${flavor}:${input.rounds}x${input.questionsPerRound}`,
    pack_type: suiteTier === 'smoke' ? 'smoke' : 'ad_hoc',
    suite_type: input.suiteType,
    suite_tier: suiteTier,
    case_count: caseManifest.case_count ?? defaultCaseCount,
    rounds: input.rounds,
    questions_per_round: input.questionsPerRound,
    case_distribution: {
      generated_questions: caseManifest.case_count ?? defaultCaseCount,
    },
    case_manifest: caseManifest,
  };
}

export function buildBenchmarkFingerprints(input: {
  provider: Record<string, unknown>;
  runtime: Record<string, unknown>;
  judge: Record<string, unknown>;
}): BenchmarkFreezeFingerprints {
  return {
    provider_fingerprint: `provider-${stableDigest(input.provider)}`,
    runtime_fingerprint: `runtime-${stableDigest(input.runtime)}`,
    judge_fingerprint: `judge-${stableDigest(input.judge)}`,
  };
}

export function buildFrozenCaseManifest(input: {
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
  cases: BenchmarkCaseEntry[];
  freezeFingerprints: BenchmarkFreezeFingerprints;
}): FrozenBenchmarkCaseManifest {
  const flavor = input.profile ?? input.variant ?? 'main';
  const suiteTier = input.suiteTier ?? inferBenchmarkSuiteTier(input.suiteType, input.smokeMode);
  const questionDigest = stableDigest(
    input.cases.map((item) => ({
      round: item.round,
      ordinal: item.ordinal,
      question: item.question,
      strategy: item.strategy,
      target_dimension: item.target_dimension,
      expected_challenge_level: item.expected_challenge_level,
    }))
  );
  const manifest = {
    manifest_id: `${input.suiteType}:${input.slug}:${flavor}:${questionDigest}`,
    manifest_version: 'benchmark-case-manifest-v2',
    pack_version: `pack-v2-${stableDigest({
      slug: input.slug,
      suite_type: input.suiteType,
      suite_tier: suiteTier,
      flavor,
      question_digest: questionDigest,
      provider: input.freezeFingerprints.provider_fingerprint,
      runtime: input.freezeFingerprints.runtime_fingerprint,
      judge: input.freezeFingerprints.judge_fingerprint,
    })}`,
    recipe_version: 'training-question-recipe-v1',
    suite_label: `${input.suiteType}:${flavor}`,
    suite_tier: suiteTier,
    flavor,
    replayable: true,
    replay_mode: input.replicaGroup ? 'replica_summary' : 'recipe_only',
    freeze_level: 'frozen_cases',
    case_manifest_hash: stableDigest({
      manifest_seed: `${input.suiteType}:${input.slug}:${flavor}`,
      cases: input.cases,
      fingerprints: input.freezeFingerprints,
    }),
    question_digest: questionDigest,
    case_count: input.cases.length,
    provider_fingerprint: input.freezeFingerprints.provider_fingerprint,
    runtime_fingerprint: input.freezeFingerprints.runtime_fingerprint,
    judge_fingerprint: input.freezeFingerprints.judge_fingerprint,
    replica_group: input.replicaGroup,
    replica_id: input.replicaId,
  } satisfies BenchmarkCaseManifest;
  return {
    manifest,
    cases: input.cases,
  };
}

export function summarizeBenchmarkHomogeneity(manifests: BenchmarkCaseManifest[]): BenchmarkHomogeneitySummary {
  const manifestVersions = uniqueStrings(manifests.map((item) => item.manifest_version));
  const freezeLevels = uniqueStrings(manifests.map((item) => item.freeze_level));
  const suiteLabels = uniqueStrings(manifests.map((item) => item.suite_label));
  const packVersions = uniqueStrings(manifests.map((item) => item.pack_version));
  const providerFingerprints = uniqueStrings(manifests.map((item) => item.provider_fingerprint));
  const runtimeFingerprints = uniqueStrings(manifests.map((item) => item.runtime_fingerprint));
  const judgeFingerprints = uniqueStrings(manifests.map((item) => item.judge_fingerprint));
  const reasons: string[] = [];

  if (manifests.length === 0) reasons.push('no benchmark manifests supplied');
  if (manifestVersions.length > 1) reasons.push('mixed manifest versions detected');
  if (freezeLevels.length > 1) reasons.push('mixed freeze levels detected');
  if (suiteLabels.length > 1) reasons.push('mixed suite labels detected');
  if (packVersions.length > 1) reasons.push('mixed pack versions detected');
  if (manifests.some((item) => item.freeze_level !== 'frozen_cases')) {
    reasons.push('benchmark set is not fully frozen at case level');
  }
  if (manifests.some((item) => !item.provider_fingerprint)) reasons.push('provider freeze fingerprint missing');
  if (manifests.some((item) => !item.runtime_fingerprint)) reasons.push('runtime freeze fingerprint missing');
  if (manifests.some((item) => !item.judge_fingerprint)) reasons.push('judge freeze fingerprint missing');
  if (providerFingerprints.length > 1) reasons.push('mixed provider freeze fingerprints detected');
  if (runtimeFingerprints.length > 1) reasons.push('mixed runtime freeze fingerprints detected');
  if (judgeFingerprints.length > 1) reasons.push('mixed judge freeze fingerprints detected');

  return {
    homogeneous: reasons.length === 0,
    reasons,
    manifest_versions: manifestVersions,
    freeze_levels: freezeLevels,
    suite_labels: suiteLabels,
    pack_versions: packVersions,
    provider_fingerprints: providerFingerprints,
    runtime_fingerprints: runtimeFingerprints,
    judge_fingerprints: judgeFingerprints,
  };
}

export function toFrozenQuestionRounds(manifest: FrozenBenchmarkCaseManifest): TrainingQuestion[][] {
  const sortedCases = [...manifest.cases].sort((left, right) => {
    if (left.round !== right.round) return left.round - right.round;
    return left.ordinal - right.ordinal;
  });
  if (sortedCases.length === 0) {
    throw new Error(`frozen benchmark manifest "${manifest.manifest.manifest_id}" does not contain any cases`);
  }

  const roundIds = uniqueNumbers(sortedCases.map((item) => item.round));
  for (let index = 0; index < roundIds.length; index += 1) {
    if (roundIds[index] !== index + 1) {
      throw new Error(
        `frozen benchmark manifest "${manifest.manifest.manifest_id}" must use contiguous round ids starting at 1`
      );
    }
  }

  const grouped = new Map<number, Array<{ ordinal: number; question: TrainingQuestion }>>();
  for (const item of sortedCases) {
    if (!Number.isInteger(item.ordinal) || item.ordinal <= 0) {
      throw new Error(`frozen benchmark manifest "${manifest.manifest.manifest_id}" has invalid ordinal for case ${item.case_id}`);
    }
    const question = String(item.question ?? '').trim();
    if (!question) {
      throw new Error(`frozen benchmark manifest "${manifest.manifest.manifest_id}" has an empty question in case ${item.case_id}`);
    }

    const entries = grouped.get(item.round) ?? [];
    entries.push({
      ordinal: item.ordinal,
      question: {
        question,
        strategy: asQuestionStrategy(item.strategy, manifest.manifest.manifest_id, item.case_id),
        target_dimension: asTargetDimension(item.target_dimension, manifest.manifest.manifest_id, item.case_id),
        expected_challenge_level: asExpectedChallengeLevel(
          item.expected_challenge_level,
          manifest.manifest.manifest_id,
          item.case_id
        ),
      },
    });
    grouped.set(item.round, entries);
  }

  return roundIds.map((round) =>
    (grouped.get(round) ?? [])
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((item) => ({ ...item.question }))
  );
}

export function buildRerunStabilitySummary(input: {
  runs: Array<{
    quality?: number | null;
    coverage?: number | null;
    contradictionRate?: number | null;
    duplicationRate?: number | null;
  }>;
  cleanReplicaCount?: number;
  totalReplicaCount?: number;
}): EvaluationRerunStability {
  const measuredReplicaCount = input.runs.length;
  const totalReplicaCount = Math.max(measuredReplicaCount, input.totalReplicaCount ?? measuredReplicaCount);
  const cleanReplicaCount = Math.max(
    0,
    Math.min(totalReplicaCount, input.cleanReplicaCount ?? measuredReplicaCount)
  );
  const excludedReplicaCount = Math.max(0, totalReplicaCount - cleanReplicaCount);
  const quality = summarizeSpread(input.runs.map((run) => run.quality));
  const coverage = summarizeSpread(input.runs.map((run) => run.coverage));
  const contradictionRate = summarizeSpread(input.runs.map((run) => run.contradictionRate));
  const duplicationRate = summarizeSpread(input.runs.map((run) => run.duplicationRate));
  const reasons: string[] = [];
  let stabilityLabel: EvaluationStabilityLabel = 'insufficient_evidence';
  let stable = false;

  if (excludedReplicaCount > 0) {
    reasons.push(`${excludedReplicaCount} replica(s) were excluded from official stability because they were not clean`);
  }

  if (measuredReplicaCount < 2) {
    reasons.push('need at least 2 measured replicas for stability judgment');
  } else {
    const qualityStable = withinSpread(quality, 0.035, 0.08);
    const coverageStable = withinSpread(coverage, 0.045, 0.1);
    const contradictionStable = withinSpread(contradictionRate, 0.025, 0.06);
    const duplicationStable = withinSpread(duplicationRate, 0.025, 0.06);
    const allStable = qualityStable && coverageStable && contradictionStable && duplicationStable;

    if (allStable && measuredReplicaCount >= 3) {
      stabilityLabel = 'stable';
      stable = true;
      reasons.push('quality, coverage, contradiction, and duplication stayed within the P1 replica spread budget');
    } else if (allStable) {
      stabilityLabel = 'provisional';
      reasons.push('replica spread is narrow, but there are fewer than 3 measured replicas');
    } else {
      stabilityLabel = 'volatile';
      if (!qualityStable) reasons.push('quality spread exceeded the P1 stability budget');
      if (!coverageStable) reasons.push('coverage spread exceeded the P1 stability budget');
      if (!contradictionStable) reasons.push('contradiction spread exceeded the P1 stability budget');
      if (!duplicationStable) reasons.push('duplication spread exceeded the P1 stability budget');
    }
  }

  return {
    version: 'evaluation-v2-p1',
    replica_count: measuredReplicaCount,
    clean_replica_count: cleanReplicaCount,
    excluded_replica_count: excludedReplicaCount,
    stability_label: stabilityLabel,
    stable,
    reasons,
    quality,
    coverage,
    contradiction_rate: contradictionRate,
    duplication_rate: duplicationRate,
  };
}

export function classifyEvaluationRun(input: {
  totalRounds: number;
  runtimeObservability?: Partial<RuntimeFallbackSummary> | {
    trainerFallbacks?: number;
    personaFallbacks?: number;
    evaluatorFallbacks?: number;
    directorFallbacks?: number;
  } | null;
  judgeProvenance?: JudgeProvenance | null;
  failureError?: string | null;
}): EvaluationContamination {
  const runtime = normalizeRuntimeFallbackSummary(input.runtimeObservability);
  const reasons: EvaluationContaminationReason[] = [];
  const details: string[] = [];
  const error = String(input.failureError ?? '').trim();
  const lowerError = error.toLowerCase();

  if (error) {
    if (lowerError.includes('timeout')) {
      reasons.push('runtime_timeout');
      details.push(error);
    }
    if (
      lowerError.includes('schema') ||
      lowerError.includes('structured') ||
      lowerError.includes('json') ||
      lowerError.includes('did not match')
    ) {
      reasons.push('schema_drift');
      details.push(error);
    }
    if (reasons.length === 0) {
      reasons.push('partial_observability');
      details.push(error);
    }

    return {
      status: 'failed',
      reasons: uniqueReasons(reasons),
      summary: `run failed: ${uniqueReasons(reasons).join(', ')}`,
      details,
    };
  }

  if (input.totalRounds <= 0) {
    reasons.push('partial_observability');
  }

  if (runtime.trainer_fallbacks > 0 || runtime.persona_fallbacks > 0 || runtime.director_fallbacks > 0) {
    reasons.push('provider_fallback');
    details.push(
      `trainer=${runtime.trainer_fallbacks}, persona=${runtime.persona_fallbacks}, director=${runtime.director_fallbacks}`
    );
  }

  if ((input.judgeProvenance?.fallback_used ?? false) || runtime.evaluator_fallbacks > 0) {
    reasons.push('judge_fallback');
    details.push(`evaluator=${runtime.evaluator_fallbacks}`);
  }

  const normalizedReasons = uniqueReasons(reasons);
  if (normalizedReasons.length === 0) {
    return {
      status: 'clean',
      reasons: [],
      summary: 'clean benchmark run',
      details: [],
    };
  }

  if (normalizedReasons.includes('partial_observability') && normalizedReasons.length === 1) {
    return {
      status: 'inconclusive',
      reasons: normalizedReasons,
      summary: 'run is inconclusive because observability is incomplete',
      details,
    };
  }

  return {
    status: 'contaminated',
    reasons: normalizedReasons,
    summary: `run is contaminated: ${normalizedReasons.join(', ')}`,
    details,
  };
}

export function buildEvaluationScorecard(input: {
  avgQuality: number;
  contradictionRate: number;
  duplicationRate: number;
  coverage: number;
  runQuality: EvaluationRunQuality;
  runtimeObservability?: Partial<RuntimeFallbackSummary> | {
    trainerFallbacks?: number;
    personaFallbacks?: number;
    evaluatorFallbacks?: number;
    directorFallbacks?: number;
  } | null;
}): EvaluationScorecard {
  const runtime = normalizeRuntimeFallbackSummary(input.runtimeObservability);
  const fallbackCount =
    runtime.trainer_fallbacks +
    runtime.persona_fallbacks +
    runtime.evaluator_fallbacks +
    runtime.director_fallbacks;
  const contradictionPenalty = clamp01(1 - input.contradictionRate);
  const duplicationPenalty = clamp01(1 - input.duplicationRate);
  const quality = clamp01(input.avgQuality);
  const coverage = clamp01(input.coverage);

  const personaFidelity = clamp01((quality * 0.8) + (contradictionPenalty * 0.2));
  const groundedness = clamp01((contradictionPenalty * 0.65) + (duplicationPenalty * 0.35));
  const userUsefulness = clamp01((quality * 0.75) + (coverage * 0.25));
  const boundarySafety = clamp01((contradictionPenalty * 0.8) + (duplicationPenalty * 0.2));
  const writebackQuality = clamp01((quality * 0.25) + (contradictionPenalty * 0.4) + (duplicationPenalty * 0.35));
  const runtimeReliability = computeRuntimeReliability(input.runQuality, fallbackCount);

  const axes: Record<EvaluationAxisKey, EvaluationAxisScore> = {
    persona_fidelity: proxyAxis(personaFidelity, 'Derived from avg_quality and contradiction proxy.'),
    groundedness: proxyAxis(groundedness, 'Derived from contradiction and duplication proxy.'),
    user_usefulness: proxyAxis(userUsefulness, 'Derived from avg_quality and coverage proxy.'),
    boundary_safety: proxyAxis(boundarySafety, 'Derived from contradiction and duplication proxy.'),
    writeback_quality: proxyAxis(writebackQuality, 'Derived from quality, contradiction, and duplication proxy.'),
    runtime_reliability: proxyAxis(runtimeReliability, 'Derived from run quality classification and fallback counts.'),
  };

  const overall = clamp01(
    Object.values(axes).reduce((sum, axis) => sum + axis.score, 0) / Object.values(axes).length
  );

  return {
    version: 'evaluation-v2-p1',
    summary: 'P1 proxy scorecard derived from existing quality/coverage/contradiction/duplication/runtime signals.',
    overall,
    axes,
  };
}

export function isOfficialCleanRun(runQuality?: EvaluationRunQuality | null): boolean {
  return runQuality === 'clean';
}

export function normalizeRuntimeFallbackSummary(
  input?: Partial<RuntimeFallbackSummary> | {
    trainerFallbacks?: number;
    personaFallbacks?: number;
    evaluatorFallbacks?: number;
    directorFallbacks?: number;
  } | null
): RuntimeFallbackSummary {
  return {
    trainer_fallbacks: Math.max(0, input?.trainer_fallbacks ?? input?.trainerFallbacks ?? 0),
    persona_fallbacks: Math.max(0, input?.persona_fallbacks ?? input?.personaFallbacks ?? 0),
    evaluator_fallbacks: Math.max(0, input?.evaluator_fallbacks ?? input?.evaluatorFallbacks ?? 0),
    director_fallbacks: Math.max(0, input?.director_fallbacks ?? input?.directorFallbacks ?? 0),
  };
}

export const __evaluationV2Testables = {
  buildBenchmarkContext,
  buildBenchmarkFingerprints,
  buildFrozenCaseManifest,
  buildRerunStabilitySummary,
  inferBenchmarkSuiteTier,
  summarizeBenchmarkHomogeneity,
  toFrozenQuestionRounds,
};

function computeRuntimeReliability(runQuality: EvaluationRunQuality, fallbackCount: number): number {
  if (runQuality === 'failed') return 0.05;
  if (runQuality === 'inconclusive') return 0.35;
  if (runQuality === 'contaminated') {
    return clamp01(0.7 - Math.min(0.4, fallbackCount * 0.12));
  }
  return clamp01(0.92 - Math.min(0.22, fallbackCount * 0.04));
}

function proxyAxis(score: number, note: string): EvaluationAxisScore {
  return {
    score: clamp01(score),
    basis: 'proxy',
    note,
  };
}

function uniqueReasons(reasons: EvaluationContaminationReason[]): EvaluationContaminationReason[] {
  return Array.from(new Set(reasons));
}

function inferBenchmarkSuiteTier(suiteType: BenchmarkSuiteType, smokeMode?: boolean): BenchmarkSuiteTier {
  if (suiteType === 'smoke_pk' || smokeMode) return 'smoke';
  if (suiteType === 'ab_regression') return 'regression';
  return 'ad_hoc';
}

function stableDigest(value: unknown): string {
  return createHash('sha1')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 12);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function asQuestionStrategy(
  value: string | undefined,
  manifestId: string,
  caseId: string
): TrainingQuestion['strategy'] {
  if (value === 'blind_spot' || value === 'stress_test' || value === 'consistency' || value === 'scenario') {
    return value;
  }
  throw new Error(`frozen benchmark manifest "${manifestId}" is missing a valid strategy for case ${caseId}`);
}

function asTargetDimension(
  value: string | undefined,
  manifestId: string,
  caseId: string
): TrainingQuestion['target_dimension'] {
  if (
    value === 'language_style' ||
    value === 'values' ||
    value === 'thinking_patterns' ||
    value === 'behavioral_traits' ||
    value === 'knowledge_domains' ||
    value === 'general'
  ) {
    return value;
  }
  throw new Error(`frozen benchmark manifest "${manifestId}" is missing a valid target_dimension for case ${caseId}`);
}

function asExpectedChallengeLevel(
  value: string | undefined,
  manifestId: string,
  caseId: string
): TrainingQuestion['expected_challenge_level'] {
  if (value === 'easy' || value === 'medium' || value === 'hard') {
    return value;
  }
  throw new Error(
    `frozen benchmark manifest "${manifestId}" is missing a valid expected_challenge_level for case ${caseId}`
  );
}

function summarizeSpread(values: Array<number | null | undefined>): EvaluationMetricSpread {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numeric.length === 0) {
    return {
      mean: null,
      min: null,
      max: null,
      range: null,
      stddev: null,
    };
  }

  const mean = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const variance = numeric.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / numeric.length;
  return {
    mean,
    min,
    max,
    range: max - min,
    stddev: Math.sqrt(variance),
  };
}

function withinSpread(spread: EvaluationMetricSpread, maxStddev: number, maxRange: number): boolean {
  if (spread.stddev === null || spread.range === null) return true;
  return spread.stddev <= maxStddev && spread.range <= maxRange;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

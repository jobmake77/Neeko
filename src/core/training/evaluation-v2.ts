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
  version: 'evaluation-v2-p0';
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

export interface BenchmarkContext {
  pack_id: string;
  pack_type: 'ad_hoc' | 'smoke';
  suite_type: 'profile_sweep' | 'routing_compare' | 'smoke_pk' | 'ab_regression';
  case_count: number;
  rounds: number;
  questions_per_round: number;
  case_distribution: Record<string, number>;
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
  suiteType: BenchmarkContext['suite_type'];
  profile?: string;
  variant?: string;
  rounds: number;
  questionsPerRound: number;
  smokeMode?: boolean;
}): BenchmarkContext {
  const flavor = input.profile ?? input.variant ?? 'main';
  return {
    pack_id: `${input.suiteType}:${input.slug}:${flavor}:${input.rounds}x${input.questionsPerRound}`,
    pack_type: input.smokeMode ? 'smoke' : 'ad_hoc',
    suite_type: input.suiteType,
    case_count: Math.max(1, input.rounds * input.questionsPerRound),
    rounds: input.rounds,
    questions_per_round: input.questionsPerRound,
    case_distribution: {
      generated_questions: Math.max(1, input.rounds * input.questionsPerRound),
    },
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
    version: 'evaluation-v2-p0',
    summary: 'P0 proxy scorecard derived from existing quality/coverage/contradiction/duplication/runtime signals.',
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

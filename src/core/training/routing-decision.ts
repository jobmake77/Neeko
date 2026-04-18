import type { DynamicScalingRecommendation } from '../pipeline/dynamic-scaling-recommendation.js';
import type { InputRoutingStrategy } from '../pipeline/evidence-routing.js';
import type { EvaluationContamination, EvaluationRunQuality } from './evaluation-v2.js';
import type { CorpusShape, InputRoutingRecommendation } from './strategy-resolver.js';
import type { TrainingSeedMode } from './training-seed.js';

export type AccountRoutingType =
  | 'stable_persona_expression'
  | 'mixed_commentary_stream'
  | 'structure_undetermined';

export type RoutingStageType =
  | 'early_explore'
  | 'mixed_growth'
  | 'dense_large_corpus'
  | 'noise_limited';

export interface RoutingDecisionRuntimeObservability {
  trainer_fallbacks?: number;
  persona_fallbacks?: number;
  evaluator_fallbacks?: number;
  director_fallbacks?: number;
}

export interface RoutingDecisionScalingObservability {
  stable_topic_growth: number;
  duplication_pressure: number;
  seed_maturity: number;
  dynamic_scaling_state: string;
  dynamic_scaling_action: string;
  dynamic_scaling_confidence: number;
  dynamic_scaling_reason: string;
}

export interface RoutingDecisionRow {
  label: string;
  input_routing: InputRoutingStrategy;
  requested_training_seed_mode: TrainingSeedMode;
  training_seed_mode: TrainingSeedMode;
  avgQuality: number;
  coverage: number;
  contradictionRate: number;
  duplicationRate: number;
  run_quality?: EvaluationRunQuality;
  contamination?: EvaluationContamination | null;
  observability: {
    raw_docs: number;
    clean_docs: number;
    chunks: number;
    soul_docs: number;
    memory_docs: number;
    discard_docs: number;
    filtered_low_quality_docs: number;
  };
  scaling_observability?: RoutingDecisionScalingObservability;
  runtime_observability: RoutingDecisionRuntimeObservability;
}

export interface GrayPathRecommendationLike {
  safe_default: {
    input_routing: InputRoutingStrategy;
    training_seed_mode: TrainingSeedMode;
  };
  recommended_gray_path: {
    input_routing: InputRoutingStrategy;
    training_seed_mode: TrainingSeedMode;
  };
}

export interface RoutingDecisionExcludedRun {
  label: string;
  reason: string;
  quality: number;
  coverage: number;
}

export interface RoutingDecisionRecord {
  version: string;
  account_type: AccountRoutingType;
  stage_type: RoutingStageType;
  recommended_routing: {
    input_routing: InputRoutingStrategy;
    training_seed_mode: TrainingSeedMode;
  };
  confidence: number;
  reason: string;
  reasons: string[];
  clean_run_count: number;
  excluded_runs: RoutingDecisionExcludedRun[];
  evidence: {
    corpus_shape: CorpusShape;
    dynamic_scaling_state?: string;
    dynamic_scaling_action?: string;
    dynamic_scaling_confidence?: number;
    raw_doc_count: number;
    clean_doc_count: number;
    stable_topic_growth?: number;
    duplication_pressure?: number;
    seed_maturity?: number;
  };
}

export function buildRoutingDecisionRecord(options: {
  rows: RoutingDecisionRow[];
  routingRecommendation: InputRoutingRecommendation | null;
  dynamicScalingRecommendation: DynamicScalingRecommendation | null;
  currentGrayPathRecommendation: GrayPathRecommendationLike;
}): RoutingDecisionRecord {
  const excludedRuns = detectExcludedRuns(options.rows);
  const excludedLabels = new Set(excludedRuns.map((item) => item.label));
  const cleanRows = options.rows.filter((row) => !excludedLabels.has(row.label));
  const subjectRows = cleanRows.length > 0 ? cleanRows : options.rows;
  const subjectScale = subjectRows[0]?.scaling_observability;
  const rawDocCount = maxNumber(subjectRows.map((row) => row.observability.raw_docs));
  const cleanDocCount = maxNumber(subjectRows.map((row) => row.observability.clean_docs));
  const stageType = classifyRoutingStage({
    cleanDocCount,
    excludedRuns,
  });
  const accountType = classifyAccountType({
    rows: subjectRows,
    routingRecommendation: options.routingRecommendation,
  });
  const recommendedRouting = selectRecommendedRouting({
    rows: subjectRows,
    accountType,
    stageType,
    currentGrayPathRecommendation: options.currentGrayPathRecommendation,
  });
  const confidence = estimateDecisionConfidence({
    rows: subjectRows,
    accountType,
    stageType,
    excludedRuns,
    recommendedRouting,
  });
  const reasons = buildDecisionReasons({
    rows: subjectRows,
    accountType,
    stageType,
    recommendedRouting,
    excludedRuns,
    routingRecommendation: options.routingRecommendation,
  });

  return {
    version: '2026-04-06',
    account_type: accountType,
    stage_type: stageType,
    recommended_routing: recommendedRouting,
    confidence,
    reason: reasons[0] ?? 'insufficient routing signal, staying with the conservative default',
    reasons,
    clean_run_count: subjectRows.length,
    excluded_runs: excludedRuns,
    evidence: {
      corpus_shape: options.routingRecommendation?.shape ?? 'unknown',
      dynamic_scaling_state: options.dynamicScalingRecommendation?.state ?? subjectScale?.dynamic_scaling_state,
      dynamic_scaling_action:
        options.dynamicScalingRecommendation?.recommended_action ?? subjectScale?.dynamic_scaling_action,
      dynamic_scaling_confidence:
        options.dynamicScalingRecommendation?.confidence ?? subjectScale?.dynamic_scaling_confidence,
      raw_doc_count: rawDocCount,
      clean_doc_count: cleanDocCount,
      stable_topic_growth: subjectScale?.stable_topic_growth,
      duplication_pressure: subjectScale?.duplication_pressure,
      seed_maturity: subjectScale?.seed_maturity,
    },
  };
}

function detectExcludedRuns(rows: RoutingDecisionRow[]): RoutingDecisionExcludedRun[] {
  const qualities = rows
    .map((row) => row.avgQuality)
    .filter((value) => Number.isFinite(value));
  const coverages = rows
    .map((row) => row.coverage)
    .filter((value) => Number.isFinite(value));
  const medianQuality = median(qualities);
  const medianCoverage = median(coverages);

  return rows.flatMap((row) => {
    if (row.run_quality && row.run_quality !== 'clean') {
      return [{
        label: row.label,
        reason: row.contamination?.summary ?? `run marked ${row.run_quality}`,
        quality: row.avgQuality,
        coverage: row.coverage,
      }];
    }
    const fallbackCount =
      (row.runtime_observability.trainer_fallbacks ?? 0) +
      (row.runtime_observability.persona_fallbacks ?? 0) +
      (row.runtime_observability.evaluator_fallbacks ?? 0) +
      (row.runtime_observability.director_fallbacks ?? 0);
    const suspiciousLowQuality = row.avgQuality <= Math.max(0.4, medianQuality - 0.25);
    const suspiciousLowCoverage = row.coverage <= Math.max(0.25, medianCoverage - 0.12);
    if (fallbackCount > 0 && (suspiciousLowQuality || suspiciousLowCoverage)) {
      return [{
        label: row.label,
        reason: `fallback-contaminated outlier (${fallbackCount} fallback events)`,
        quality: row.avgQuality,
        coverage: row.coverage,
      }];
    }
    return [];
  });
}

function classifyRoutingStage(input: {
  cleanDocCount: number;
  excludedRuns: RoutingDecisionExcludedRun[];
}): RoutingStageType {
  if (input.excludedRuns.length > 0) return 'noise_limited';
  if (input.cleanDocCount < 500) return 'early_explore';
  if (input.cleanDocCount < 1500) return 'mixed_growth';
  return 'dense_large_corpus';
}

function classifyAccountType(input: {
  rows: RoutingDecisionRow[];
  routingRecommendation: InputRoutingRecommendation | null;
}): AccountRoutingType {
  const legacyOff = findVariantRow(input.rows, 'legacy', 'off');
  const v2Off = findVariantRow(input.rows, 'v2', 'off');
  const seedMaturity = maxNumber(input.rows.map((row) => row.scaling_observability?.seed_maturity ?? 0));

  if (
    legacyOff &&
    v2Off &&
    v2Off.avgQuality >= legacyOff.avgQuality &&
    v2Off.coverage >= legacyOff.coverage &&
    seedMaturity >= 0.78
  ) {
    return 'stable_persona_expression';
  }

  if (
    input.routingRecommendation?.shape === 'dense_noisy_stream' ||
    input.routingRecommendation?.shape === 'balanced_mixed'
  ) {
    return 'mixed_commentary_stream';
  }

  if (legacyOff && v2Off && legacyOff.avgQuality >= v2Off.avgQuality) {
    return 'mixed_commentary_stream';
  }

  if (input.routingRecommendation?.shape === 'high_signal_archive') {
    return 'stable_persona_expression';
  }

  return 'structure_undetermined';
}

function selectRecommendedRouting(input: {
  rows: RoutingDecisionRow[];
  accountType: AccountRoutingType;
  stageType: RoutingStageType;
  currentGrayPathRecommendation: GrayPathRecommendationLike;
}): { input_routing: InputRoutingStrategy; training_seed_mode: TrainingSeedMode } {
  const fallback = input.currentGrayPathRecommendation.recommended_gray_path;
  const legacyOff = findVariantRow(input.rows, 'legacy', 'off');
  const v2Off = findVariantRow(input.rows, 'v2', 'off');
  const bestSignals = input.rows
    .filter((row) => row.input_routing === 'v2' && row.training_seed_mode !== 'off')
    .sort(compareRows)[0];

  if (input.stageType === 'noise_limited') {
    return input.currentGrayPathRecommendation.safe_default;
  }

  if (
    bestSignals &&
    bestSignals.avgQuality >= Math.max(legacyOff?.avgQuality ?? 0, v2Off?.avgQuality ?? 0) + 0.015 &&
    bestSignals.coverage >= Math.max(legacyOff?.coverage ?? 0, v2Off?.coverage ?? 0)
  ) {
    return {
      input_routing: 'v2',
      training_seed_mode: bestSignals.training_seed_mode,
    };
  }

  if (
    input.accountType === 'stable_persona_expression' &&
    v2Off &&
    legacyOff &&
    compareRows(v2Off, legacyOff) < 0
  ) {
    return {
      input_routing: 'v2',
      training_seed_mode: 'off',
    };
  }

  if (
    input.accountType === 'mixed_commentary_stream' &&
    legacyOff &&
    (!v2Off || compareRows(legacyOff, v2Off) <= 0)
  ) {
    return {
      input_routing: 'legacy',
      training_seed_mode: 'off',
    };
  }

  return fallback;
}

function estimateDecisionConfidence(input: {
  rows: RoutingDecisionRow[];
  accountType: AccountRoutingType;
  stageType: RoutingStageType;
  excludedRuns: RoutingDecisionExcludedRun[];
  recommendedRouting: { input_routing: InputRoutingStrategy; training_seed_mode: TrainingSeedMode };
}): number {
  const matchingRows = input.rows.filter((row) =>
    row.input_routing === input.recommendedRouting.input_routing &&
    row.training_seed_mode === input.recommendedRouting.training_seed_mode
  );
  const bestRow = [...input.rows].sort(compareRows)[0];
  const recommendedBest = matchingRows.some((row) => row.label === bestRow?.label);
  let confidence = 0.55;

  if (recommendedBest) confidence += 0.1;
  if (input.accountType === 'stable_persona_expression' || input.accountType === 'mixed_commentary_stream') {
    confidence += 0.08;
  }
  if (input.stageType === 'dense_large_corpus') confidence += 0.08;
  if (input.stageType === 'mixed_growth') confidence += 0.04;
  confidence -= Math.min(0.18, input.excludedRuns.length * 0.08);

  return clamp(confidence);
}

function buildDecisionReasons(input: {
  rows: RoutingDecisionRow[];
  accountType: AccountRoutingType;
  stageType: RoutingStageType;
  recommendedRouting: { input_routing: InputRoutingStrategy; training_seed_mode: TrainingSeedMode };
  excludedRuns: RoutingDecisionExcludedRun[];
  routingRecommendation: InputRoutingRecommendation | null;
}): string[] {
  const reasons: string[] = [];
  const legacyOff = findVariantRow(input.rows, 'legacy', 'off');
  const v2Off = findVariantRow(input.rows, 'v2', 'off');
  const bestRow = [...input.rows].sort(compareRows)[0];

  if (input.excludedRuns.length > 0) {
    reasons.push('provider/runtime noise is present, so noisy runs were excluded before choosing a routing recommendation');
  }

  if (input.accountType === 'stable_persona_expression') {
    reasons.push('the corpus behaves like a stable persona archive, so v2 can be valuable when it preserves quality and coverage');
  } else if (input.accountType === 'mixed_commentary_stream') {
    reasons.push('the corpus behaves like a mixed commentary stream, so over-selective routing can remove useful nuance');
  } else {
    reasons.push('the corpus shape is still underdetermined, so the conservative routing path remains safer');
  }

  if (input.stageType === 'dense_large_corpus') {
    reasons.push('the corpus is already in a dense large-corpus stage, so multi-variant comparison is more reliable than early-stage intuition');
  } else if (input.stageType === 'mixed_growth') {
    reasons.push('the corpus is in a mixed-growth stage, so the system should keep expanding while comparing routing choices conservatively');
  } else if (input.stageType === 'early_explore') {
    reasons.push('the corpus is still early enough that conservative routing is less likely to overfit to sparse evidence');
  }

  if (legacyOff && v2Off) {
    reasons.push(
      `legacy/off=${legacyOff.avgQuality.toFixed(3)}/${legacyOff.coverage.toFixed(3)} vs v2/off=${v2Off.avgQuality.toFixed(3)}/${v2Off.coverage.toFixed(3)}`
    );
  }

  if (bestRow) {
    reasons.push(`best clean variant in this comparison was ${bestRow.label}`);
  }

  if (input.routingRecommendation) {
    reasons.push(`routing observability shape=${input.routingRecommendation.shape} (${input.routingRecommendation.reason})`);
  }

  return reasons;
}

function findVariantRow(
  rows: RoutingDecisionRow[],
  strategy: InputRoutingStrategy,
  trainingSeedMode: TrainingSeedMode
): RoutingDecisionRow | undefined {
  return rows.find((row) => row.input_routing === strategy && row.training_seed_mode === trainingSeedMode);
}

function compareRows(left: RoutingDecisionRow, right: RoutingDecisionRow): number {
  return (
    right.avgQuality - left.avgQuality ||
    right.coverage - left.coverage ||
    left.contradictionRate - right.contradictionRate ||
    left.duplicationRate - right.duplicationRate
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[center - 1] + sorted[center]) / 2;
  }
  return sorted[center];
}

function maxNumber(values: number[]): number {
  return values.reduce((best, value) => Math.max(best, value), 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

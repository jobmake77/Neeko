import {
  buildRoutingDecisionRecord,
  type GrayPathRecommendationLike,
  type RoutingDecisionRecord,
  type RoutingDecisionRow,
} from './routing-decision.js';
import type { InputRoutingStrategy } from '../pipeline/evidence-routing.js';
import type { TrainingSeedMode } from './training-seed.js';
import path from 'node:path';

export interface PkRunSummary {
  variant: string;
  repeat: number;
  attempts?: number;
  successfulAttempt?: number | null;
  exitCode?: number | null;
  reportPath?: string | null;
  quality: number | null;
  coverage: number | null;
  contradictionRate: number | null;
  duplicationRate: number | null;
  inputRouting: InputRoutingStrategy | null;
  trainingSeedMode: TrainingSeedMode | null;
  runtimeObservability?: RoutingDecisionRow['runtime_observability'] | null;
  observability?: RoutingDecisionRow['observability'] | null;
  scalingObservability?: RoutingDecisionRow['scaling_observability'] | null;
  routingDecisionRecord?: RoutingDecisionRecord | null;
}

export interface PkExcludedRun {
  variant: string;
  repeat: number;
  label: string;
  reason: string;
  quality: number;
  coverage: number;
}

export interface PkVariantAggregate {
  variant: string;
  runs: number;
  clean_runs: number;
  excluded_runs: number;
  mean_quality: number | null;
  clean_mean_quality: number | null;
  mean_coverage: number | null;
  clean_mean_coverage: number | null;
  mean_contradiction_rate: number | null;
  clean_mean_contradiction_rate: number | null;
  mean_duplication_rate: number | null;
  clean_mean_duplication_rate: number | null;
  qualities: number[];
  clean_qualities: number[];
  coverages: number[];
  clean_coverages: number[];
  excluded_run_details: PkExcludedRun[];
  excluded_reason_counts: Record<string, number>;
  routing_record_counts: {
    available: number;
    missing: number;
    account_type: Record<string, number>;
    stage_type: Record<string, number>;
    local_recommendation: Record<string, number>;
  };
}

export interface PkRoutingDecisionAggregate {
  overall_record: RoutingDecisionRecord | null;
  clean_run_count: number;
  excluded_run_count: number;
  excluded_runs: PkExcludedRun[];
  excluded_reason_counts: Record<string, number>;
  account_type_counts: Record<string, number>;
  stage_type_counts: Record<string, number>;
  local_recommendation_counts: Record<string, number>;
  record_coverage: {
    available: number;
    missing: number;
  };
}

export interface PkAggregateSummary {
  aggregate: PkVariantAggregate[];
  aggregate_by_variant: Record<string, PkVariantAggregate>;
  routing_decision_aggregate: PkRoutingDecisionAggregate;
}

export function buildPkAggregateSummary(options: {
  runs: PkRunSummary[];
  currentGrayPathRecommendation?: GrayPathRecommendationLike;
}): PkAggregateSummary {
  const successfulRuns = options.runs.filter((run) => isFiniteNumber(run.quality));
  const variants = Array.from(new Set(successfulRuns.map((run) => run.variant)));
  const aggregateRows: PkVariantAggregate[] = [];
  const aggregateByVariant: Record<string, PkVariantAggregate> = {};
  const excludedRuns: PkExcludedRun[] = [];

  for (const variant of variants) {
    const variantRuns = successfulRuns.filter((run) => run.variant === variant);
    const excludedForVariant = detectExcludedRunsForVariant(variantRuns);
    const excludedLabels = new Set(excludedForVariant.map((item) => item.label));
    const cleanRuns = variantRuns.filter((run) => !excludedLabels.has(runLabel(run)));

    const aggregate = {
      variant,
      runs: variantRuns.length,
      clean_runs: cleanRuns.length,
      excluded_runs: excludedForVariant.length,
      mean_quality: mean(variantRuns.map((run) => run.quality)),
      clean_mean_quality: mean(cleanRuns.map((run) => run.quality)),
      mean_coverage: mean(variantRuns.map((run) => run.coverage)),
      clean_mean_coverage: mean(cleanRuns.map((run) => run.coverage)),
      mean_contradiction_rate: mean(variantRuns.map((run) => run.contradictionRate)),
      clean_mean_contradiction_rate: mean(cleanRuns.map((run) => run.contradictionRate)),
      mean_duplication_rate: mean(variantRuns.map((run) => run.duplicationRate)),
      clean_mean_duplication_rate: mean(cleanRuns.map((run) => run.duplicationRate)),
      qualities: compactNumbers(variantRuns.map((run) => run.quality)),
      clean_qualities: compactNumbers(cleanRuns.map((run) => run.quality)),
      coverages: compactNumbers(variantRuns.map((run) => run.coverage)),
      clean_coverages: compactNumbers(cleanRuns.map((run) => run.coverage)),
      excluded_run_details: excludedForVariant,
      excluded_reason_counts: countBy(excludedForVariant.map((run) => run.reason)),
      routing_record_counts: summarizeRoutingRecords(cleanRuns),
    } satisfies PkVariantAggregate;

    aggregateRows.push(aggregate);
    aggregateByVariant[variant] = aggregate;
    excludedRuns.push(...excludedForVariant);
  }

  const representativeRows = buildRepresentativeRows(aggregateRows, successfulRuns);
  const overallRecord = representativeRows.length === 0
    ? null
    : buildRoutingDecisionRecord({
        rows: representativeRows,
        routingRecommendation: null,
        dynamicScalingRecommendation: null,
        currentGrayPathRecommendation: options.currentGrayPathRecommendation ?? defaultCurrentGrayPathRecommendation(),
      });

  return {
    aggregate: aggregateRows,
    aggregate_by_variant: aggregateByVariant,
    routing_decision_aggregate: {
      overall_record: overallRecord,
      clean_run_count: aggregateRows.reduce((sum, row) => sum + row.clean_runs, 0),
      excluded_run_count: excludedRuns.length,
      excluded_runs: excludedRuns,
      excluded_reason_counts: countBy(excludedRuns.map((run) => run.reason)),
      account_type_counts: mergeCountMaps(aggregateRows.map((row) => row.routing_record_counts.account_type)),
      stage_type_counts: mergeCountMaps(aggregateRows.map((row) => row.routing_record_counts.stage_type)),
      local_recommendation_counts: mergeCountMaps(
        aggregateRows.map((row) => row.routing_record_counts.local_recommendation)
      ),
      record_coverage: {
        available: aggregateRows.reduce((sum, row) => sum + row.routing_record_counts.available, 0),
        missing: aggregateRows.reduce((sum, row) => sum + row.routing_record_counts.missing, 0),
      },
    },
  };
}

export function defaultCurrentGrayPathRecommendation(): GrayPathRecommendationLike {
  return {
    safe_default: {
      input_routing: 'legacy',
      training_seed_mode: 'off',
    },
    recommended_gray_path: {
      input_routing: 'v2',
      training_seed_mode: 'off',
    },
  };
}

function detectExcludedRunsForVariant(runs: PkRunSummary[]): PkExcludedRun[] {
  const medianQuality = median(compactNumbers(runs.map((run) => run.quality)));
  const medianCoverage = median(compactNumbers(runs.map((run) => run.coverage)));

  return runs.flatMap((run) => {
    const fallbackCount = runtimeFallbackCount(run.runtimeObservability);
    const quality = run.quality ?? 0;
    const coverage = run.coverage ?? 0;
    const suspiciousLowQuality = quality <= Math.max(0.4, medianQuality - 0.25);
    const suspiciousLowCoverage = coverage <= Math.max(0.25, medianCoverage - 0.12);

    if (fallbackCount > 0 && (suspiciousLowQuality || suspiciousLowCoverage)) {
      return [{
        variant: run.variant,
        repeat: run.repeat,
        label: runLabel(run),
        reason: `fallback-contaminated outlier (${fallbackCount} fallback events)`,
        quality,
        coverage,
      }];
    }

    return [];
  });
}

function buildRepresentativeRows(
  aggregateRows: PkVariantAggregate[],
  successfulRuns: PkRunSummary[]
): RoutingDecisionRow[] {
  return aggregateRows.flatMap((aggregate) => {
    const runs = successfulRuns.filter((run) => run.variant === aggregate.variant);
    const cleanLabels = new Set(
      aggregate.excluded_run_details.map((run) => run.label)
    );
    const cleanRuns = runs.filter((run) => !cleanLabels.has(runLabel(run)));
    const sourceRuns = cleanRuns.length > 0 ? cleanRuns : runs;
    if (sourceRuns.length === 0) return [];

    const firstRun = sourceRuns[0];
    const parsed = parseVariant(aggregate.variant, firstRun);
    const observability = mergeObservability(sourceRuns);
    const scalingObservability = mergeScalingObservability(sourceRuns);
    const runtimeObservability = mergeRuntimeObservability(sourceRuns);

    return [{
      label: aggregate.variant,
      input_routing: parsed.inputRouting,
      requested_training_seed_mode: parsed.trainingSeedMode,
      training_seed_mode: parsed.trainingSeedMode,
      avgQuality: aggregate.clean_mean_quality ?? aggregate.mean_quality ?? 0,
      coverage: aggregate.clean_mean_coverage ?? aggregate.mean_coverage ?? 0,
      contradictionRate: aggregate.clean_mean_contradiction_rate ?? aggregate.mean_contradiction_rate ?? 0,
      duplicationRate: aggregate.clean_mean_duplication_rate ?? aggregate.mean_duplication_rate ?? 0,
      observability,
      scaling_observability: scalingObservability,
      runtime_observability: runtimeObservability,
    }];
  });
}

function summarizeRoutingRecords(runs: PkRunSummary[]): PkVariantAggregate['routing_record_counts'] {
  const records = runs
    .map((run) => run.routingDecisionRecord)
    .filter((record): record is RoutingDecisionRecord => Boolean(record));

  return {
    available: records.length,
    missing: runs.length - records.length,
    account_type: countBy(records.map((record) => record.account_type)),
    stage_type: countBy(records.map((record) => record.stage_type)),
    local_recommendation: countBy(
      records.map(
        (record) => `${record.recommended_routing.input_routing}+${record.recommended_routing.training_seed_mode}`
      )
    ),
  };
}

function parseVariant(
  variant: string,
  fallbackRun: PkRunSummary
): { inputRouting: InputRoutingStrategy; trainingSeedMode: TrainingSeedMode } {
  const [strategyRaw, seedRaw] = variant.split(':');
  const inputRouting = (fallbackRun.inputRouting ?? strategyRaw ?? 'legacy') as InputRoutingStrategy;
  const trainingSeedMode = (fallbackRun.trainingSeedMode ?? seedRaw ?? 'off') as TrainingSeedMode;
  return { inputRouting, trainingSeedMode };
}

function mergeObservability(runs: PkRunSummary[]): RoutingDecisionRow['observability'] {
  return {
    raw_docs: maxNumber(runs.map((run) => run.observability?.raw_docs)),
    clean_docs: maxNumber(runs.map((run) => run.observability?.clean_docs)),
    chunks: maxNumber(runs.map((run) => run.observability?.chunks)),
    soul_docs: roundedMean(runs.map((run) => run.observability?.soul_docs)),
    memory_docs: roundedMean(runs.map((run) => run.observability?.memory_docs)),
    discard_docs: roundedMean(runs.map((run) => run.observability?.discard_docs)),
    filtered_low_quality_docs: roundedMean(runs.map((run) => run.observability?.filtered_low_quality_docs)),
  };
}

function mergeScalingObservability(
  runs: PkRunSummary[]
): RoutingDecisionRow['scaling_observability'] | undefined {
  const withScaling = runs.filter((run) => run.scalingObservability);
  if (withScaling.length === 0) return undefined;

  const first = withScaling[0].scalingObservability!;
  return {
    stable_topic_growth: mean(withScaling.map((run) => run.scalingObservability?.stable_topic_growth)) ?? 0,
    duplication_pressure: mean(withScaling.map((run) => run.scalingObservability?.duplication_pressure)) ?? 0,
    seed_maturity: mean(withScaling.map((run) => run.scalingObservability?.seed_maturity)) ?? 0,
    dynamic_scaling_state: first.dynamic_scaling_state,
    dynamic_scaling_action: first.dynamic_scaling_action,
    dynamic_scaling_confidence: mean(withScaling.map((run) => run.scalingObservability?.dynamic_scaling_confidence)) ?? 0,
    dynamic_scaling_reason: first.dynamic_scaling_reason,
  };
}

function mergeRuntimeObservability(runs: PkRunSummary[]): RoutingDecisionRow['runtime_observability'] {
  return {
    trainer_fallbacks: maxNumber(runs.map((run) => run.runtimeObservability?.trainer_fallbacks)),
    persona_fallbacks: maxNumber(runs.map((run) => run.runtimeObservability?.persona_fallbacks)),
    evaluator_fallbacks: maxNumber(runs.map((run) => run.runtimeObservability?.evaluator_fallbacks)),
    director_fallbacks: maxNumber(runs.map((run) => run.runtimeObservability?.director_fallbacks)),
  };
}

function runtimeFallbackCount(runtime?: RoutingDecisionRow['runtime_observability'] | null): number {
  return (
    (runtime?.trainer_fallbacks ?? 0) +
    (runtime?.persona_fallbacks ?? 0) +
    (runtime?.evaluator_fallbacks ?? 0) +
    (runtime?.director_fallbacks ?? 0)
  );
}

function runLabel(run: PkRunSummary): string {
  const reportSuffix = run.reportPath ? path.basename(run.reportPath, path.extname(run.reportPath)) : 'no-report';
  return `${run.variant}#${String(run.repeat).padStart(2, '0')}@${reportSuffix}`;
}

function compactNumbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => isFiniteNumber(value));
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function mean(values: Array<number | null | undefined>): number | null {
  const numeric = compactNumbers(values);
  if (numeric.length === 0) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[center - 1] + sorted[center]) / 2
    : sorted[center];
}

function maxNumber(values: Array<number | null | undefined>): number {
  return compactNumbers(values).reduce((best, value) => Math.max(best, value), 0);
}

function roundedMean(values: Array<number | null | undefined>): number {
  const value = mean(values);
  return value === null ? 0 : Math.round(value);
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function mergeCountMaps(maps: Array<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

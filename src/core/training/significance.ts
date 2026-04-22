import { createHash } from 'crypto';
import type { BenchmarkPackSummary } from './benchmark-pack.js';
import type { BenchmarkJudgeMode } from './benchmark-judge.js';
import type { BenchmarkHomogeneitySummary, EvaluationMetricSpread, EvaluationRunQuality } from './evaluation-v2.js';

export type BenchmarkSignificanceStatus = 'improved' | 'regressed' | 'not_significant' | 'insufficient_evidence';
export type BenchmarkPromotionReadiness = 'blocked' | 'provisional' | 'promotable';
export type BenchmarkOfficialStatus = 'available' | 'unavailable';
export type BenchmarkReportJudgeMode = BenchmarkJudgeMode | 'proxy' | 'both';

export interface BenchmarkReplicaMeasurement {
  label: string;
  replica_id?: string;
  run_quality?: EvaluationRunQuality;
  benchmark_overall?: number | null;
  avg_quality?: number | null;
  coverage?: number | null;
  contradiction_rate?: number | null;
  duplication_rate?: number | null;
  pass_rate?: number | null;
  disputed_rate?: number | null;
  disagreement_rate?: number | null;
}

export interface BenchmarkReplicaSummary {
  version: 'benchmark-replica-summary-v1';
  replica_group: string | null;
  metric: 'benchmark_overall';
  replica_count: number;
  clean_replica_count: number;
  excluded_replica_count: number;
  benchmark_overall: EvaluationMetricSpread;
  avg_quality: EvaluationMetricSpread;
  coverage: EvaluationMetricSpread;
  contradiction_rate: EvaluationMetricSpread;
  duplication_rate: EvaluationMetricSpread;
  pass_rate: EvaluationMetricSpread;
  disputed_rate: EvaluationMetricSpread;
  disagreement_rate: EvaluationMetricSpread;
}

export interface BenchmarkSignificanceSummary {
  version: 'benchmark-significance-v1';
  method: 'paired_bootstrap';
  metric: 'benchmark_overall';
  replicas_a: number;
  replicas_b: number;
  clean_pairs: number;
  bootstrap_samples: number;
  delta_mean: number | null;
  ci_low: number | null;
  ci_high: number | null;
  significant: boolean;
  significance_status: BenchmarkSignificanceStatus;
  favors: 'a' | 'b' | 'neither';
  explanation: string;
}

export interface BenchmarkGovernanceSummary {
  version: 'benchmark-governance-v1';
  pack_id: string | null;
  pack_version: string | null;
  judge_mode: BenchmarkReportJudgeMode | null;
  official_benchmark_status: BenchmarkOfficialStatus;
  promotion_readiness: BenchmarkPromotionReadiness;
  clean_replica_count: number;
  required_min_clean_replicas: number;
  benchmark_homogeneous: boolean;
  significance_status: BenchmarkSignificanceStatus;
  judge_disagreement_rate: number;
  pack_status: string | null;
  reasons: string[];
}

export function buildBenchmarkReplicaSummary(input: {
  replicaGroup?: string | null;
  replicas: BenchmarkReplicaMeasurement[];
}): BenchmarkReplicaSummary {
  const replicas = input.replicas.map((item) => ({ ...item }));
  const cleanReplicas = replicas.filter((item) => item.run_quality === 'clean');

  return {
    version: 'benchmark-replica-summary-v1',
    replica_group: normalizeString(input.replicaGroup),
    metric: 'benchmark_overall',
    replica_count: replicas.length,
    clean_replica_count: cleanReplicas.length,
    excluded_replica_count: Math.max(0, replicas.length - cleanReplicas.length),
    benchmark_overall: summarizeSpread(cleanReplicas.map((item) => item.benchmark_overall)),
    avg_quality: summarizeSpread(cleanReplicas.map((item) => item.avg_quality)),
    coverage: summarizeSpread(cleanReplicas.map((item) => item.coverage)),
    contradiction_rate: summarizeSpread(cleanReplicas.map((item) => item.contradiction_rate)),
    duplication_rate: summarizeSpread(cleanReplicas.map((item) => item.duplication_rate)),
    pass_rate: summarizeSpread(cleanReplicas.map((item) => item.pass_rate)),
    disputed_rate: summarizeSpread(cleanReplicas.map((item) => item.disputed_rate)),
    disagreement_rate: summarizeSpread(cleanReplicas.map((item) => item.disagreement_rate)),
  };
}

export function computePairedBootstrapSignificance(input: {
  groupA: BenchmarkReplicaMeasurement[];
  groupB: BenchmarkReplicaMeasurement[];
  bootstrapSamples?: number;
  minPairs?: number;
  seedKey?: string;
}): BenchmarkSignificanceSummary {
  const metric = 'benchmark_overall' as const;
  const bootstrapSamples = Math.max(100, Math.floor(input.bootstrapSamples ?? 10_000));
  const minPairs = Math.max(2, Math.floor(input.minPairs ?? 2));
  const paired = alignReplicaPairs(input.groupA, input.groupB);

  if (paired.length < minPairs) {
    return {
      version: 'benchmark-significance-v1',
      method: 'paired_bootstrap',
      metric,
      replicas_a: countCleanMetricReplicas(input.groupA),
      replicas_b: countCleanMetricReplicas(input.groupB),
      clean_pairs: paired.length,
      bootstrap_samples: bootstrapSamples,
      delta_mean: null,
      ci_low: null,
      ci_high: null,
      significant: false,
      significance_status: 'insufficient_evidence',
      favors: 'neither',
      explanation: `paired bootstrap requires at least ${minPairs} clean replica pairs`,
    };
  }

  const deltas = paired.map((item) => item.b - item.a);
  const deltaMean = mean(deltas);
  const rng = createDeterministicRng(input.seedKey ?? JSON.stringify(paired));
  const samples: number[] = [];
  for (let sampleIndex = 0; sampleIndex < bootstrapSamples; sampleIndex += 1) {
    const draw: number[] = [];
    for (let pairIndex = 0; pairIndex < deltas.length; pairIndex += 1) {
      const selectedIndex = Math.floor(rng() * deltas.length);
      draw.push(deltas[selectedIndex] ?? 0);
    }
    samples.push(mean(draw));
  }
  samples.sort((left, right) => left - right);

  const ciLow = percentile(samples, 0.025);
  const ciHigh = percentile(samples, 0.975);
  const significanceStatus: BenchmarkSignificanceStatus =
    ciLow > 0
      ? 'improved'
      : ciHigh < 0
        ? 'regressed'
        : 'not_significant';

  return {
    version: 'benchmark-significance-v1',
    method: 'paired_bootstrap',
    metric,
    replicas_a: countCleanMetricReplicas(input.groupA),
    replicas_b: countCleanMetricReplicas(input.groupB),
    clean_pairs: paired.length,
    bootstrap_samples: bootstrapSamples,
    delta_mean: deltaMean,
    ci_low: ciLow,
    ci_high: ciHigh,
    significant: significanceStatus === 'improved' || significanceStatus === 'regressed',
    significance_status: significanceStatus,
    favors:
      significanceStatus === 'improved'
        ? 'b'
        : significanceStatus === 'regressed'
          ? 'a'
          : 'neither',
    explanation:
      significanceStatus === 'improved'
        ? 'benchmark overall significantly favors group B'
        : significanceStatus === 'regressed'
          ? 'benchmark overall significantly favors group A'
          : 'benchmark overall delta is not statistically significant',
  };
}

export function buildBenchmarkGovernanceSummary(input: {
  pack?: BenchmarkPackSummary | null;
  judgeMode?: BenchmarkReportJudgeMode | null;
  homogeneity?: BenchmarkHomogeneitySummary | null;
  replicaSummary?: BenchmarkReplicaSummary | null;
  significance?: BenchmarkSignificanceSummary | null;
  requiredMinCleanReplicas?: number;
  judgeDisagreementRate?: number | null;
  disagreementThreshold?: number;
}): BenchmarkGovernanceSummary {
  const pack = input.pack ?? null;
  const officialStatus: BenchmarkOfficialStatus = pack ? 'available' : 'unavailable';
  const replicaSummary = input.replicaSummary ?? null;
  const cleanReplicaCount = replicaSummary?.clean_replica_count ?? 0;
  const requiredMinCleanReplicas = Math.max(1, Math.floor(input.requiredMinCleanReplicas ?? 2));
  const homogeneity = input.homogeneity ?? null;
  const significanceStatus = input.significance?.significance_status ?? 'insufficient_evidence';
  const disagreementThreshold = input.disagreementThreshold ?? 0.2;
  const judgeDisagreementRate = clamp01(input.judgeDisagreementRate ?? 0);
  const reasons: string[] = [];
  let promotionReadiness: BenchmarkPromotionReadiness = 'blocked';

  if (!pack) {
    reasons.push('official benchmark pack is not available');
  }
  if (!replicaSummary) {
    reasons.push('benchmark replica summary is missing');
  }
  if (cleanReplicaCount < requiredMinCleanReplicas) {
    reasons.push(`need at least ${requiredMinCleanReplicas} clean replica(s) for official governance`);
  }
  if (homogeneity && !homogeneity.homogeneous) {
    reasons.push(...homogeneity.reasons);
  }
  if (!homogeneity) {
    reasons.push('benchmark homogeneity summary is missing');
  }
  if (judgeDisagreementRate > disagreementThreshold) {
    reasons.push(`judge disagreement rate ${judgeDisagreementRate.toFixed(4)} exceeds ${disagreementThreshold.toFixed(4)}`);
  }

  if (
    officialStatus === 'available' &&
    replicaSummary &&
    cleanReplicaCount >= requiredMinCleanReplicas &&
    Boolean(homogeneity?.homogeneous)
  ) {
    if (significanceStatus === 'regressed') {
      promotionReadiness = 'blocked';
      reasons.push('benchmark significance indicates regression');
    } else if (pack?.status !== 'official') {
      promotionReadiness = 'provisional';
      reasons.push(`pack status is ${pack?.status ?? 'draft'}, so evidence stays provisional`);
    } else if (judgeDisagreementRate > disagreementThreshold) {
      promotionReadiness = 'provisional';
    } else if (significanceStatus === 'improved') {
      promotionReadiness = 'promotable';
    } else if (significanceStatus === 'not_significant') {
      promotionReadiness = 'provisional';
      reasons.push('benchmark significance is not strong enough for promotion');
    } else {
      promotionReadiness = 'provisional';
      reasons.push('benchmark significance does not yet have enough evidence');
    }
  }

  return {
    version: 'benchmark-governance-v1',
    pack_id: pack?.pack_id ?? null,
    pack_version: pack?.pack_version ?? null,
    judge_mode: input.judgeMode ?? null,
    official_benchmark_status: officialStatus,
    promotion_readiness: promotionReadiness,
    clean_replica_count: cleanReplicaCount,
    required_min_clean_replicas: requiredMinCleanReplicas,
    benchmark_homogeneous: Boolean(homogeneity?.homogeneous),
    significance_status: significanceStatus,
    judge_disagreement_rate: judgeDisagreementRate,
    pack_status: pack?.status ?? null,
    reasons: uniqueStrings(reasons),
  };
}

export const __significanceTestables = {
  alignReplicaPairs,
  buildBenchmarkReplicaSummary,
  computePairedBootstrapSignificance,
  buildBenchmarkGovernanceSummary,
  computeBenchmarkSignificance,
};

export function computeBenchmarkSignificance(
  arg1:
    | BenchmarkReplicaMeasurement[]
    | {
      groupA?: BenchmarkReplicaMeasurement[];
      groupB?: BenchmarkReplicaMeasurement[];
      replicasA?: number[];
      replicasB?: number[];
      a?: number[];
      b?: number[];
      bootstrapSamples?: number;
      bootstrap_samples?: number;
      minPairs?: number;
      min_pairs?: number;
      seedKey?: string;
      seed_key?: string;
    },
  arg2?: BenchmarkReplicaMeasurement[] | number[],
  arg3?: {
    bootstrapSamples?: number;
    bootstrap_samples?: number;
    minPairs?: number;
    min_pairs?: number;
    seedKey?: string;
    seed_key?: string;
  }
): BenchmarkSignificanceSummary {
  if (Array.isArray(arg1) && Array.isArray(arg2)) {
    return computePairedBootstrapSignificance({
      groupA: normalizeReplicaInput(arg1),
      groupB: normalizeReplicaInput(arg2),
      bootstrapSamples: arg3?.bootstrapSamples ?? arg3?.bootstrap_samples,
      minPairs: arg3?.minPairs ?? arg3?.min_pairs,
      seedKey: arg3?.seedKey ?? arg3?.seed_key,
    });
  }

  const input = arg1 as {
    groupA?: BenchmarkReplicaMeasurement[];
    groupB?: BenchmarkReplicaMeasurement[];
    replicasA?: number[];
    replicasB?: number[];
    a?: number[];
    b?: number[];
    bootstrapSamples?: number;
    bootstrap_samples?: number;
    minPairs?: number;
    min_pairs?: number;
    seedKey?: string;
    seed_key?: string;
  };
  return computePairedBootstrapSignificance({
    groupA: normalizeReplicaInput(input.groupA ?? input.replicasA ?? input.a ?? []),
    groupB: normalizeReplicaInput(input.groupB ?? input.replicasB ?? input.b ?? []),
    bootstrapSamples: input.bootstrapSamples ?? input.bootstrap_samples,
    minPairs: input.minPairs ?? input.min_pairs,
    seedKey: input.seedKey ?? input.seed_key,
  });
}

function alignReplicaPairs(groupA: BenchmarkReplicaMeasurement[], groupB: BenchmarkReplicaMeasurement[]): Array<{ key: string; a: number; b: number }> {
  const indexA = buildReplicaMetricIndex(groupA);
  const indexB = buildReplicaMetricIndex(groupB);
  const keys = [...indexA.keys()].filter((key) => indexB.has(key)).sort();
  return keys.map((key) => ({
    key,
    a: indexA.get(key) ?? 0,
    b: indexB.get(key) ?? 0,
  }));
}

function normalizeReplicaInput(values: BenchmarkReplicaMeasurement[] | number[]): BenchmarkReplicaMeasurement[] {
  if (values.length === 0) return [];
  const first = values[0];
  if (typeof first === 'number') {
    return (values as number[]).map((value, index) => ({
      label: `replica-${index + 1}`,
      replica_id: `r${index + 1}`,
      run_quality: 'clean',
      benchmark_overall: value,
    }));
  }
  return (values as BenchmarkReplicaMeasurement[]).map((item, index) => ({
    label: item.label ?? `replica-${index + 1}`,
    replica_id: item.replica_id ?? `r${index + 1}`,
    run_quality: item.run_quality ?? 'clean',
    benchmark_overall: item.benchmark_overall ?? null,
    avg_quality: item.avg_quality ?? null,
    coverage: item.coverage ?? null,
    contradiction_rate: item.contradiction_rate ?? null,
    duplication_rate: item.duplication_rate ?? null,
    pass_rate: item.pass_rate ?? null,
    disputed_rate: item.disputed_rate ?? null,
    disagreement_rate: item.disagreement_rate ?? null,
  }));
}

function buildReplicaMetricIndex(replicas: BenchmarkReplicaMeasurement[]): Map<string, number> {
  const index = new Map<string, number>();
  replicas.forEach((item, ordinal) => {
    if (item.run_quality !== 'clean' || !Number.isFinite(item.benchmark_overall)) return;
    const key = normalizeString(item.replica_id) ?? `${item.label}:${ordinal}`;
    index.set(key, clamp01(item.benchmark_overall ?? 0));
  });
  return index;
}

function countCleanMetricReplicas(replicas: BenchmarkReplicaMeasurement[]): number {
  return replicas.filter((item) => item.run_quality === 'clean' && Number.isFinite(item.benchmark_overall)).length;
}

function summarizeSpread(values: Array<number | null | undefined>): EvaluationMetricSpread {
  const measured = values
    .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : null))
    .filter((value): value is number => value !== null);
  if (measured.length === 0) {
    return {
      mean: null,
      min: null,
      max: null,
      range: null,
      stddev: null,
    };
  }

  const min = Math.min(...measured);
  const max = Math.max(...measured);
  const avg = mean(measured);
  const variance = mean(measured.map((value) => (value - avg) ** 2));
  return {
    mean: avg,
    min,
    max,
    range: max - min,
    stddev: Math.sqrt(variance),
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * fraction)));
  return values[index] ?? 0;
}

function createDeterministicRng(seedKey: string): () => number {
  const hex = createHash('sha256').update(seedKey).digest('hex').slice(0, 8);
  let state = Number.parseInt(hex, 16) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeString(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

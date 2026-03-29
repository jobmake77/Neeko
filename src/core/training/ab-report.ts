import { TrainingProfile } from './types.js';

export interface ExperimentSummaryRow {
  profile: TrainingProfile;
  totalRounds: number;
  avgQuality: number;
  contradictionRate: number;
  duplicationRate: number;
  coverage: number;
}

export interface GateThresholds {
  max_quality_drop: number;
  max_contradiction_rise: number;
  max_duplication_rise: number;
}

export interface GateResult {
  enabled: boolean;
  passed: boolean;
  reason: string;
  baseline_profile: TrainingProfile;
  compare_profile: TrainingProfile;
  deltas?: {
    quality_drop: number;
    contradiction_rise: number;
    duplication_rise: number;
  };
  thresholds?: GateThresholds;
}

export interface AbComparisonReport {
  schema_version: 1;
  generated_at: string;
  group_a: TrainingProfile;
  group_b: TrainingProfile;
  metrics: {
    avg_quality: { a: number; b: number };
    contradiction_rate: { a: number; b: number };
    duplication_rate: { a: number; b: number };
    coverage: { a: number; b: number };
  };
  deltas: {
    avg_quality: number;
    contradiction_rate: number;
    duplication_rate: number;
    coverage: number;
  };
  gate_result: GateResult;
}

export function evaluateGate(
  rows: ExperimentSummaryRow[],
  cfg: {
    enabled: boolean;
    maxQualityDrop: number;
    maxContradictionRise: number;
    maxDuplicationRise: number;
    baselineProfile?: TrainingProfile;
    compareProfile?: TrainingProfile;
  }
): GateResult {
  const baselineProfile = cfg.baselineProfile ?? 'baseline';
  const compareProfile = cfg.compareProfile ?? 'full';

  if (!cfg.enabled) {
    return {
      enabled: false,
      passed: true,
      reason: 'gate disabled',
      baseline_profile: baselineProfile,
      compare_profile: compareProfile,
    };
  }

  const baseline = rows.find((r) => r.profile === baselineProfile);
  const compare = rows.find((r) => r.profile === compareProfile);
  if (!baseline || !compare) {
    return {
      enabled: true,
      passed: false,
      reason: `${baselineProfile}/${compareProfile} rows missing`,
      baseline_profile: baselineProfile,
      compare_profile: compareProfile,
    };
  }

  const qualityDrop = baseline.avgQuality - compare.avgQuality;
  const contradictionRise = compare.contradictionRate - baseline.contradictionRate;
  const duplicationRise = compare.duplicationRate - baseline.duplicationRate;

  const qualityOk = qualityDrop <= cfg.maxQualityDrop;
  const contradictionOk = contradictionRise <= cfg.maxContradictionRise;
  const duplicationOk = duplicationRise <= cfg.maxDuplicationRise;
  const passed = qualityOk && contradictionOk && duplicationOk;

  const reason = passed
    ? `${compareProfile} is within regression thresholds vs ${baselineProfile}`
    : [
      !qualityOk ? `quality drop ${qualityDrop.toFixed(4)} > ${cfg.maxQualityDrop.toFixed(4)}` : null,
      !contradictionOk
        ? `contradiction rise ${contradictionRise.toFixed(4)} > ${cfg.maxContradictionRise.toFixed(4)}`
        : null,
      !duplicationOk
        ? `duplication rise ${duplicationRise.toFixed(4)} > ${cfg.maxDuplicationRise.toFixed(4)}`
        : null,
    ]
      .filter(Boolean)
      .join('; ');

  return {
    enabled: true,
    passed,
    reason,
    baseline_profile: baselineProfile,
    compare_profile: compareProfile,
    deltas: {
      quality_drop: qualityDrop,
      contradiction_rise: contradictionRise,
      duplication_rise: duplicationRise,
    },
    thresholds: {
      max_quality_drop: cfg.maxQualityDrop,
      max_contradiction_rise: cfg.maxContradictionRise,
      max_duplication_rise: cfg.maxDuplicationRise,
    },
  };
}

export function buildAbComparisonReport(
  rows: ExperimentSummaryRow[],
  groupA: TrainingProfile,
  groupB: TrainingProfile,
  gateResult: GateResult
): AbComparisonReport {
  const a = rows.find((row) => row.profile === groupA);
  const b = rows.find((row) => row.profile === groupB);
  if (!a || !b) {
    throw new Error(`A/B rows missing: ${groupA}/${groupB}`);
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    group_a: groupA,
    group_b: groupB,
    metrics: {
      avg_quality: { a: a.avgQuality, b: b.avgQuality },
      contradiction_rate: { a: a.contradictionRate, b: b.contradictionRate },
      duplication_rate: { a: a.duplicationRate, b: b.duplicationRate },
      coverage: { a: a.coverage, b: b.coverage },
    },
    deltas: {
      avg_quality: b.avgQuality - a.avgQuality,
      contradiction_rate: b.contradictionRate - a.contradictionRate,
      duplication_rate: b.duplicationRate - a.duplicationRate,
      coverage: b.coverage - a.coverage,
    },
    gate_result: gateResult,
  };
}

export function renderAbComparisonTable(report: AbComparisonReport): string {
  const rows = [
    ['avg_quality', report.metrics.avg_quality.a, report.metrics.avg_quality.b, report.deltas.avg_quality],
    ['contradiction_rate', report.metrics.contradiction_rate.a, report.metrics.contradiction_rate.b, report.deltas.contradiction_rate],
    ['duplication_rate', report.metrics.duplication_rate.a, report.metrics.duplication_rate.b, report.deltas.duplication_rate],
    ['coverage', report.metrics.coverage.a, report.metrics.coverage.b, report.deltas.coverage],
  ];

  const head = `metric               A(${report.group_a})    B(${report.group_b})    delta(B-A)`;
  const body = rows
    .map(([metric, a, b, delta]) => {
      const aVal = Number(a).toFixed(4).padStart(10);
      const bVal = Number(b).toFixed(4).padStart(10);
      const dVal = `${Number(delta) >= 0 ? '+' : ''}${Number(delta).toFixed(4)}`.padStart(10);
      return `${String(metric).padEnd(20)} ${aVal}      ${bVal}      ${dVal}`;
    })
    .join('\n');

  return `${head}\n${body}`;
}

export function toAbComparisonCsv(report: AbComparisonReport): string {
  return [
    'metric,group_a,group_b,delta_b_minus_a',
    `avg_quality,${report.metrics.avg_quality.a.toFixed(6)},${report.metrics.avg_quality.b.toFixed(6)},${report.deltas.avg_quality.toFixed(6)}`,
    `contradiction_rate,${report.metrics.contradiction_rate.a.toFixed(6)},${report.metrics.contradiction_rate.b.toFixed(6)},${report.deltas.contradiction_rate.toFixed(6)}`,
    `duplication_rate,${report.metrics.duplication_rate.a.toFixed(6)},${report.metrics.duplication_rate.b.toFixed(6)},${report.deltas.duplication_rate.toFixed(6)}`,
    `coverage,${report.metrics.coverage.a.toFixed(6)},${report.metrics.coverage.b.toFixed(6)},${report.deltas.coverage.toFixed(6)}`,
  ].join('\n');
}

export function toAbComparisonMarkdown(report: AbComparisonReport): string {
  return [
    '# A/B Regression Report',
    '',
    `- Group A: \`${report.group_a}\``,
    `- Group B: \`${report.group_b}\``,
    `- Generated: ${report.generated_at}`,
    '',
    '| Metric | A | B | Delta (B-A) |',
    '|---|---:|---:|---:|',
    `| avg_quality | ${report.metrics.avg_quality.a.toFixed(4)} | ${report.metrics.avg_quality.b.toFixed(4)} | ${report.deltas.avg_quality.toFixed(4)} |`,
    `| contradiction_rate | ${report.metrics.contradiction_rate.a.toFixed(4)} | ${report.metrics.contradiction_rate.b.toFixed(4)} | ${report.deltas.contradiction_rate.toFixed(4)} |`,
    `| duplication_rate | ${report.metrics.duplication_rate.a.toFixed(4)} | ${report.metrics.duplication_rate.b.toFixed(4)} | ${report.deltas.duplication_rate.toFixed(4)} |`,
    `| coverage | ${report.metrics.coverage.a.toFixed(4)} | ${report.metrics.coverage.b.toFixed(4)} | ${report.deltas.coverage.toFixed(4)} |`,
    '',
    `- Gate: ${report.gate_result.enabled ? (report.gate_result.passed ? 'passed' : 'failed') : 'disabled'}`,
    `- Reason: ${report.gate_result.reason}`,
  ].join('\n');
}

export const __abReportTestables = {
  evaluateGate,
  buildAbComparisonReport,
  renderAbComparisonTable,
  toAbComparisonCsv,
  toAbComparisonMarkdown,
};

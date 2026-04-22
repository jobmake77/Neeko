import { NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ExperimentSummaryRow {
  profile: string;
  totalRounds: number;
  avgQuality: number;
  contradictionRate: number;
  duplicationRate: number;
  coverage: number;
  run_quality?: string;
  benchmark_scorecard?: {
    overall_score?: number;
    pass_rate?: number;
    disputed_case_count?: number;
    scored_case_count?: number;
  };
  benchmark_case_summary?: {
    total_cases?: number;
    passed_cases?: number;
    failed_cases?: number;
    abstained_cases?: number;
    disputed_cases?: number;
  };
  benchmark_judge_disagreement?: {
    active?: boolean;
    judge_count?: number;
    disagreement_rate?: number;
    verdict_conflicts?: number;
    high_delta_cases?: string[];
  };
}

type ExperimentPromotionReadiness = 'blocked' | 'provisional' | 'promotable';
type ExperimentPackStatus = 'draft' | 'candidate' | 'official';

interface ExperimentReport {
  schema_version: number;
  generated_at: string;
  slug: string;
  rounds_per_profile: number;
  profiles: string[];
  summary_rows: ExperimentSummaryRow[];
  official_summary_rows?: ExperimentSummaryRow[];
  best_profile: string | null;
  benchmark_manifests?: Array<{
    suite_tier?: string;
    suite_label?: string;
    pack_id?: string;
    pack_version?: string;
  }>;
  benchmark_pack?: {
    pack_id?: string;
    pack_version?: string;
    suite_type?: string;
    suite_tier?: string;
    status?: ExperimentPackStatus | string;
  };
  benchmark_scorecards?: Array<{
    profile?: string;
    overall_score?: number;
    pass_rate?: number;
    disputed_case_count?: number;
    case_count?: number;
  }>;
  benchmark_judge_summary?: {
    judge_mode?: string;
    scorecard_mode?: 'proxy_only' | 'benchmark_only' | 'both';
    proxy_scorecard_present?: boolean;
    benchmark_scorecard_present?: boolean;
    disputed_case_count?: number;
    disagreement_rate?: number;
  };
  benchmark_significance?: {
    method?: string;
    metric?: string;
    delta_mean?: number;
    ci_low?: number;
    ci_high?: number;
    significant?: boolean;
    favors?: 'a' | 'b' | 'neither';
    replicas_a?: number;
    replicas_b?: number;
  };
  benchmark_governance?: {
    version?: string;
    pack_id?: string;
    pack_version?: string;
    judge_mode?: string;
    official_benchmark_status?: 'available' | 'unavailable';
    promotion_readiness?: ExperimentPromotionReadiness;
    clean_replica_count?: number;
    benchmark_homogeneous?: boolean;
    significance_status?: 'improved' | 'regressed' | 'not_significant' | 'insufficient_evidence';
    judge_disagreement_rate?: number;
  };
  evaluation_v2?: {
    official_status?: 'available' | 'unavailable';
    official_best_profile?: string | null;
    observed_best_profile?: string | null;
    suite_tiers_present?: string[];
    suite_types_present?: string[];
    compatible_official_fallback_used?: boolean;
  };
}

interface AbRegressionReport {
  schema_version: number;
  generated_at: string;
  report_quality?: 'complete' | 'timeout_limited';
  group_a: string;
  group_b: string;
  execution?: {
    elapsed_ms?: number;
    fast_failures?: Array<{ profile: string; error: string }>;
  };
  deltas: {
    avg_quality: number;
    contradiction_rate: number;
    duplication_rate: number;
    coverage: number;
  };
  gate_result?: {
    enabled: boolean;
    passed: boolean;
    reason: string;
  };
}

function isExperimentReport(report: unknown): report is ExperimentReport {
  return Boolean(
    report &&
    typeof report === 'object' &&
    'generated_at' in report &&
    'summary_rows' in report &&
    Array.isArray((report as ExperimentReport).summary_rows)
  );
}

function isAbRegressionReport(report: unknown): report is AbRegressionReport {
  return Boolean(
    report &&
    typeof report === 'object' &&
    'generated_at' in report &&
    'group_a' in report &&
    'group_b' in report
  );
}

function getExperimentDir(slug: string) {
  return join(homedir(), '.neeko', 'personas', slug, 'experiments');
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = getExperimentDir(slug);
  if (!existsSync(dir)) return NextResponse.json([]);

  const reports = readdirSync(dir)
    .filter(
      (name) =>
        name.endsWith('.json') &&
        !name.includes('.benchmark-manifest.') &&
        (name.startsWith('experiment-') || name.startsWith('ab-regression-'))
    )
    .map((name) => {
      const path = join(dir, name);
      try {
        const report = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
        if (!isExperimentReport(report) && !isAbRegressionReport(report)) {
          return null;
        }
        const kind = name.startsWith('ab-regression-') ? 'ab_regression' : 'experiment';
        return {
          kind,
          filename: name,
          report,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ta = new Date(
        (a as { report: ExperimentReport | AbRegressionReport }).report.generated_at
      ).getTime();
      const tb = new Date(
        (b as { report: ExperimentReport | AbRegressionReport }).report.generated_at
      ).getTime();
      return tb - ta;
    });

  return NextResponse.json(reports);
}

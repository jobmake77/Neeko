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
}

interface ExperimentReport {
  schema_version: number;
  generated_at: string;
  slug: string;
  rounds_per_profile: number;
  profiles: string[];
  summary_rows: ExperimentSummaryRow[];
  best_profile: string;
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
        (name.startsWith('experiment-') || name.startsWith('ab-regression-'))
    )
    .map((name) => {
      const path = join(dir, name);
      try {
        const report = JSON.parse(readFileSync(path, 'utf-8')) as
          | ExperimentReport
          | AbRegressionReport;
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

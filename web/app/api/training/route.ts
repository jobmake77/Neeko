import { NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface TrainingReportSummary {
  generated_at: string;
  profile: string;
  total_rounds: number;
  summary: {
    avg_quality_score: number;
    avg_contradiction_rate: number;
    avg_duplication_rate: number;
    avg_low_confidence_coverage: number;
    total_nodes_written: number;
    total_nodes_reinforced: number;
    total_high_value_memories: number;
    total_quarantined_memories: number;
  };
}

function getPersonaRoot() {
  return join(homedir(), '.neeko', 'personas');
}

export async function GET() {
  const root = getPersonaRoot();
  if (!existsSync(root)) return NextResponse.json([]);

  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const data = dirs
    .map((slug) => {
      const personaPath = join(root, slug, 'persona.json');
      const reportPath = join(root, slug, 'training-report.json');
      if (!existsSync(personaPath) || !existsSync(reportPath)) return null;

      try {
        const persona = JSON.parse(readFileSync(personaPath, 'utf-8')) as {
          slug: string;
          name: string;
        };
        const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as TrainingReportSummary;
        return {
          slug: persona.slug,
          name: persona.name,
          report,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ta = new Date((a as { report: TrainingReportSummary }).report.generated_at).getTime();
      const tb = new Date((b as { report: TrainingReportSummary }).report.generated_at).getTime();
      return tb - ta;
    });

  return NextResponse.json(data);
}

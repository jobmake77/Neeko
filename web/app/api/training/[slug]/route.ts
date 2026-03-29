import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

function getPersonaDir(slug: string) {
  return join(homedir(), '.neeko', 'personas', slug);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const reportPath = join(dir, 'training-report.json');
  const manifestPath = join(dir, 'run_manifest.json');
  const checkpointPath = join(dir, 'checkpoint_index.json');
  const evaluationSummaryPath = join(dir, 'evaluation_summary.md');
  const datasetSnapshotPath = join(dir, 'dataset_snapshot.md');

  if (!existsSync(personaPath) || !existsSync(reportPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const persona = JSON.parse(readFileSync(personaPath, 'utf-8'));
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
      : null;
    const checkpointIndex = existsSync(checkpointPath)
      ? JSON.parse(readFileSync(checkpointPath, 'utf-8'))
      : null;
    return NextResponse.json({
      persona,
      report,
      manifest,
      checkpoint_index: checkpointIndex,
      assets: {
        evaluation_summary_exists: existsSync(evaluationSummaryPath),
        dataset_snapshot_exists: existsSync(datasetSnapshotPath),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid report' }, { status: 500 });
  }
}

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
      ? JSON.parse(readFileSync(checkpointPath, 'utf-8')) as {
        checkpoints?: Array<{ id: string; created_at: string; track: string; round: number; stage: string }>;
      }
      : null;
    const sortedCheckpoints = (Array.isArray(checkpointIndex?.checkpoints) ? checkpointIndex.checkpoints : [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const latestCheckpoint = sortedCheckpoints.length > 0 ? sortedCheckpoints[sortedCheckpoints.length - 1] : null;
    return NextResponse.json({
      persona,
      report,
      manifest,
      checkpoint_index: checkpointIndex
        ? {
          ...checkpointIndex,
          checkpoints: sortedCheckpoints,
        }
        : null,
      latest_checkpoint: latestCheckpoint,
      assets: {
        evaluation_summary_exists: existsSync(evaluationSummaryPath),
        dataset_snapshot_exists: existsSync(datasetSnapshotPath),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid report' }, { status: 500 });
  }
}

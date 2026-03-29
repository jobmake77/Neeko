import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const track = new URL(req.url).searchParams.get('track') ?? 'full_serial';
  const dir = join(homedir(), '.neeko', 'personas', slug);
  const reportPath = join(dir, 'training-report.json');
  const manifestPath = join(dir, 'run_manifest.json');

  if (!existsSync(reportPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as Record<string, unknown>;
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf-8')) as { tracks?: Array<{ track: string; acceptance?: Record<string, unknown> }> }
      : null;
    const trackRow = manifest?.tracks?.find((item) => item.track === track) ?? null;

    return NextResponse.json({
      slug,
      track,
      report,
      acceptance: trackRow?.acceptance ?? null,
      manifest,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid report' }, { status: 500 });
  }
}

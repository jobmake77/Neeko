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

  if (!existsSync(personaPath) || !existsSync(reportPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const persona = JSON.parse(readFileSync(personaPath, 'utf-8'));
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    return NextResponse.json({ persona, report });
  } catch {
    return NextResponse.json({ error: 'Invalid report' }, { status: 500 });
  }
}

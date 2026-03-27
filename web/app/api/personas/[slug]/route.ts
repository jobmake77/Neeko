import { NextResponse } from 'next/server';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';

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
  const soulPath = join(dir, 'soul.yaml');
  const reportPath = join(dir, 'training-report.json');

  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const persona = JSON.parse(readFileSync(personaPath, 'utf-8'));
  const soul = existsSync(soulPath)
    ? yaml.load(readFileSync(soulPath, 'utf-8'))
    : null;
  const trainingReport = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf-8'))
    : null;

  return NextResponse.json({ persona, soul, trainingReport });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = getPersonaDir(slug);

  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const persona = JSON.parse(readFileSync(personaPath, 'utf-8'));

  rmSync(dir, { recursive: true, force: true });

  try {
    const CONFIG_PATH = join(homedir(), 'Library', 'Preferences', 'neeko-nodejs', 'config.json');
    const cfg = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) : {};
    const qdrantUrl = cfg.qdrantUrl ?? 'http://localhost:6333';
    await fetch(`${qdrantUrl}/collections/${persona.memory_collection}`, { method: 'DELETE' });
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}

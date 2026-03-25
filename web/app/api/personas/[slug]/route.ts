import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
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

  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const persona = JSON.parse(readFileSync(personaPath, 'utf-8'));
  const soul = existsSync(soulPath)
    ? yaml.load(readFileSync(soulPath, 'utf-8'))
    : null;

  return NextResponse.json({ persona, soul });
}

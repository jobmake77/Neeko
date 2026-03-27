import { NextResponse } from 'next/server';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readRuntimeProgress } from '@/lib/runtime-progress';

function getDataDir() {
  return join(homedir(), '.neeko', 'personas');
}

function isStalled(status: string | undefined, runtimeUpdatedAt?: string): boolean {
  if (status !== 'training') return false;
  if (!runtimeUpdatedAt) return true;
  const ts = new Date(runtimeUpdatedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > 15 * 60 * 1000;
}

export async function GET() {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    return NextResponse.json([]);
  }

  const slugs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const personas = slugs
    .map((slug) => {
      const personaPath = join(dir, slug, 'persona.json');
      if (!existsSync(personaPath)) return null;
      const persona = JSON.parse(readFileSync(personaPath, 'utf-8'));
      const runtimeProgress = readRuntimeProgress(slug);
      const stalled = isStalled(persona.status, runtimeProgress?.updatedAt);
      return {
        ...persona,
        status: stalled ? 'stalled' : persona.status,
        runtime_progress: runtimeProgress,
      };
    })
    .filter(Boolean);

  return NextResponse.json(personas);
}

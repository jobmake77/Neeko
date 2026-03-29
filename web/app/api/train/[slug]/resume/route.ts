import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { enqueueTrainJob, isTrainQueuedOrRunning } from '@/lib/train-queue';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = join(homedir(), '.neeko', 'personas', slug);
  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }

  if (isTrainQueuedOrRunning(slug)) {
    return NextResponse.json({ ok: true, status: 'already_running' });
  }

  const body = (await req.json().catch(() => ({}))) as { checkpointId?: string; track?: 'persona_extract' | 'work_execute' | 'full_serial' };
  const contextPath = join(dir, 'training-context.json');
  let contextRounds = 3;
  let contextProfile = 'full';
  if (existsSync(contextPath)) {
    try {
      const context = JSON.parse(readFileSync(contextPath, 'utf-8')) as { requested_rounds?: number; profile?: string };
      contextRounds = Number.isFinite(context.requested_rounds) ? Math.max(1, Number(context.requested_rounds)) : contextRounds;
      if (context.profile && /^(baseline|a1|a2|a3|a4|full)$/.test(context.profile)) contextProfile = context.profile;
    } catch {
      // ignore
    }
  }

  const track = body.track && /^(persona_extract|work_execute|full_serial)$/.test(body.track)
    ? body.track
    : 'full_serial';

  const enqueued = enqueueTrainJob({
    slug,
    rounds: contextRounds,
    profile: contextProfile,
    retries: 3,
    source: 'api',
    track,
    mode: contextRounds <= 3 ? 'quick' : 'full',
    resumeFrom: body.checkpointId ?? 'latest',
  });

  if (!enqueued.accepted) {
    return NextResponse.json({ ok: false, status: 'rejected', reason: enqueued.reason ?? 'unknown' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, status: 'queued', queuedAhead: enqueued.queuedAhead ?? 0 });
}

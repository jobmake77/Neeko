import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { enqueueTrainJob, isTrainQueuedOrRunning } from '@/lib/train-queue';

function personaPath(slug: string): string {
  return join(homedir(), '.neeko', 'personas', slug, 'persona.json');
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!existsSync(personaPath(slug))) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    track?: 'persona_extract' | 'work_execute' | 'full_serial';
    mode?: 'quick' | 'full';
    rounds?: number;
    trainingProfile?: string;
    retries?: number;
  };

  const mode = body.mode === 'quick' ? 'quick' : 'full';
  const rounds = Number.isFinite(body.rounds)
    ? Math.max(1, Math.floor(Number(body.rounds)))
    : mode === 'quick'
    ? 3
    : 10;
  const track = body.track && /^(persona_extract|work_execute|full_serial)$/.test(body.track)
    ? body.track
    : 'full_serial';
  const profile = body.trainingProfile && /^(baseline|a1|a2|a3|a4|full)$/.test(body.trainingProfile)
    ? body.trainingProfile
    : 'full';
  const retries = Number.isFinite(body.retries) ? Math.max(0, Math.min(5, Number(body.retries))) : 3;

  if (isTrainQueuedOrRunning(slug)) {
    return NextResponse.json({ ok: true, status: 'already_running' });
  }

  const enqueued = enqueueTrainJob({
    slug,
    rounds,
    profile,
    retries,
    source: 'api',
    track,
    mode,
  });

  if (!enqueued.accepted) {
    return NextResponse.json({ ok: false, status: 'rejected', reason: enqueued.reason ?? 'unknown' }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    status: 'queued',
    queuedAhead: enqueued.queuedAhead ?? 0,
    track,
    mode,
  });
}

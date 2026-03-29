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

  const body = (await req.json().catch(() => ({}))) as {
    checkpointId?: string;
    track?: 'persona_extract' | 'work_execute' | 'full_serial';
  };
  const checkpointIndexPath = join(dir, 'checkpoint_index.json');
  const checkpoints = existsSync(checkpointIndexPath)
    ? (() => {
      try {
        const parsed = JSON.parse(readFileSync(checkpointIndexPath, 'utf-8')) as {
          checkpoints?: Array<{ id: string; created_at: string; track: string; round: number; stage: string }>;
        };
        return (Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [])
          .filter((item) => item && typeof item.id === 'string')
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
      } catch {
        return [];
      }
    })()
    : [];
  const latestCheckpoint = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
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
  const requestedCheckpointId = String(body.checkpointId ?? 'latest').trim();
  const resolvedCheckpoint = requestedCheckpointId === '' || requestedCheckpointId === 'latest'
    ? (latestCheckpoint?.id ?? 'latest')
    : requestedCheckpointId;

  if (resolvedCheckpoint !== 'latest' && !checkpoints.some((item) => item.id === resolvedCheckpoint)) {
    return NextResponse.json({
      ok: false,
      error: `checkpoint not found: ${resolvedCheckpoint}`,
    }, { status: 400 });
  }

  const enqueued = enqueueTrainJob({
    slug,
    rounds: contextRounds,
    profile: contextProfile,
    retries: 3,
    source: 'api',
    track,
    mode: contextRounds <= 3 ? 'quick' : 'full',
    resumeFrom: resolvedCheckpoint,
  });

  if (!enqueued.accepted) {
    return NextResponse.json({ ok: false, status: 'rejected', reason: enqueued.reason ?? 'unknown' }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    status: 'queued',
    queuedAhead: enqueued.queuedAhead ?? 0,
    resolvedCheckpoint,
  });
}

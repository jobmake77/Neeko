import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { enqueueSkillRefreshJobWithMode, isTrainQueuedOrRunning } from '@/lib/train-queue';

function getPersonaDir(slug: string): string {
  return join(homedir(), '.neeko', 'personas', slug);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }

  if (isTrainQueuedOrRunning(slug)) {
    return NextResponse.json({
      ok: true,
      status: 'already_running',
      message: '已有训练/刷新任务在队列中',
    });
  }

  const body = await req.json().catch(() => ({})) as { mode?: string };
  const mode = body.mode === 'full' ? 'full' : 'quick';
  const enqueued = enqueueSkillRefreshJobWithMode(slug, mode);
  if (!enqueued.accepted) {
    return NextResponse.json({
      ok: false,
      status: 'rejected',
      reason: enqueued.reason ?? 'unknown',
    }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    status: 'queued',
    queuedAhead: enqueued.queuedAhead ?? 0,
  });
}

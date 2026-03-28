import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { enqueueSkillRefreshJob, isTrainQueuedOrRunning } from '@/lib/train-queue';

function getPersonaDir(slug: string): string {
  return join(homedir(), '.neeko', 'personas', slug);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const skillsPath = join(dir, 'skills.json');

  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }
  if (!existsSync(skillsPath)) {
    return NextResponse.json({
      schema_version: 1,
      persona_slug: slug,
      version: 1,
      updated_at: null,
      source_trace: [],
      origin_skills: [],
      expanded_skills: [],
      clusters: [],
      pending_candidates: [],
      coverage_by_origin: [],
    });
  }
  try {
    const skills = JSON.parse(readFileSync(skillsPath, 'utf-8')) as {
      origin_skills?: Array<{ id?: string; name?: string }>;
      expanded_skills?: Array<{ origin_id?: string }>;
      [key: string]: unknown;
    };
    const origins = Array.isArray(skills.origin_skills) ? skills.origin_skills : [];
    const expanded = Array.isArray(skills.expanded_skills) ? skills.expanded_skills : [];
    const coverageByOrigin = origins.map((origin) => {
      const expandedCount = expanded.filter((item) => item.origin_id === origin.id).length;
      const coverageScore = Math.min(1, expandedCount / 3);
      return {
        origin_id: origin.id ?? '',
        origin_name: origin.name ?? 'unknown',
        expanded_count: expandedCount,
        coverage_score: coverageScore,
        missing_slots: Math.max(0, 3 - expandedCount),
      };
    }).sort((a, b) => a.coverage_score - b.coverage_score);

    return NextResponse.json({
      ...skills,
      coverage_by_origin: coverageByOrigin,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid skills file' }, { status: 500 });
  }
}

export async function POST(
  _req: Request,
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

  const enqueued = enqueueSkillRefreshJob(slug);
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

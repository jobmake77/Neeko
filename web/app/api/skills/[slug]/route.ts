import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { enqueueSkillRefreshJobWithMode, isTrainQueuedOrRunning } from '@/lib/train-queue';

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
      schema_version: 2,
      persona_slug: slug,
      version: 1,
      updated_at: null,
      source_trace: [],
      origin_skills: [],
      distilled_skills: [],
      candidate_skill_pool: [],
      clusters: [],
      pending_candidates: [],
      coverage_by_origin: [],
      quality_summary: {
        accepted_rate: 0,
        avg_quality_score: 0,
      },
    });
  }
  try {
    const skills = JSON.parse(readFileSync(skillsPath, 'utf-8')) as {
      origin_skills?: Array<{ id?: string; name?: string }>;
      distilled_skills?: Array<{ source_origin_ids?: string[]; quality_score?: number }>;
      candidate_skill_pool?: unknown[];
      [key: string]: unknown;
    };
    const origins = Array.isArray(skills.origin_skills) ? skills.origin_skills : [];
    const distilled = Array.isArray(skills.distilled_skills) ? skills.distilled_skills : [];
    const coverageByOrigin = origins.map((origin) => {
      const coveredCount = distilled.filter((item) =>
        Array.isArray(item.source_origin_ids) && item.source_origin_ids.includes(origin.id ?? '')
      ).length;
      const covered = coveredCount > 0 ? 1 : 0;
      return {
        origin_id: origin.id ?? '',
        origin_name: origin.name ?? 'unknown',
        expanded_count: coveredCount,
        coverage_score: covered,
        missing_slots: covered ? 0 : 1,
      };
    }).sort((a, b) => a.coverage_score - b.coverage_score);
    const accepted = distilled.length;
    const total = accepted + (Array.isArray(skills.candidate_skill_pool) ? skills.candidate_skill_pool.length : 0);
    const avgQualityScore =
      accepted === 0
        ? 0
        : distilled.reduce((sum, item) => sum + (item.quality_score ?? 0), 0) / accepted;

    return NextResponse.json({
      ...skills,
      coverage_by_origin: coverageByOrigin,
      quality_summary: {
        accepted_rate: total === 0 ? 0 : accepted / total,
        avg_quality_score: avgQualityScore,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid skills file' }, { status: 500 });
  }
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

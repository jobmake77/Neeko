import { NextResponse } from 'next/server';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isPidAlive, readRuntimeProgress, readRuntimeTaskState } from '@/lib/runtime-progress';
import { maybeAutoRecoverTraining } from '@/lib/auto-recover';
import { readLockHolder } from '@/lib/train-queue';

function getDataDir() {
  return join(homedir(), '.neeko', 'personas');
}

function isStalled(
  slug: string,
  status: string | undefined,
  runtimeUpdatedAt?: string,
  taskState?: { state: string; pid: number | null; updatedAt: string } | null
): boolean {
  if (status !== 'training') return false;
  if (taskState?.state === 'queued') {
    const lockHolder = readLockHolder(slug);
    if (lockHolder) return false;
    const queuedTs = new Date(taskState.updatedAt || runtimeUpdatedAt || 0).getTime();
    if (Number.isFinite(queuedTs) && Date.now() - queuedTs > 90 * 1000) return true;
    return false;
  }
  if (taskState?.state === 'failed') return true;
  if (taskState?.state === 'running') {
    const alive = isPidAlive(taskState.pid);
    if (alive) return false;
    const lastBeat = new Date(taskState.updatedAt || runtimeUpdatedAt || 0).getTime();
    if (Number.isFinite(lastBeat) && Date.now() - lastBeat > 90 * 1000) return true;
  }
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
      const skillsPath = join(dir, slug, 'skills.json');
      const reportPath = join(dir, slug, 'training-report.json');
      const skillSummary = existsSync(skillsPath)
        ? (() => {
          try {
            const parsed = JSON.parse(readFileSync(skillsPath, 'utf-8')) as {
              origin_skills?: unknown[];
              distilled_skills?: unknown[];
              updated_at?: string;
            };
            const report = existsSync(reportPath)
              ? (() => {
                try {
                  return JSON.parse(readFileSync(reportPath, 'utf-8')) as {
                    summary?: { skill_coverage_score?: number; gap_focused_questions_ratio?: number };
                    rounds?: Array<{ gap_focused_questions?: number; total_questions?: number }>;
                  };
                } catch {
                  return null;
                }
              })()
              : null;
            const rounds = Array.isArray(report?.rounds) ? report.rounds : [];
            const last = rounds[rounds.length - 1];
            const prev = rounds[rounds.length - 2];
            const toRatio = (item?: { gap_focused_questions?: number; total_questions?: number }) => {
              if (!item || typeof item.gap_focused_questions !== 'number' || typeof item.total_questions !== 'number') return null;
              if (item.total_questions <= 0) return null;
              return item.gap_focused_questions / item.total_questions;
            };
            const lastRatio = toRatio(last);
            const prevRatio = toRatio(prev);
            const trendDelta =
              typeof lastRatio === 'number' && typeof prevRatio === 'number'
                ? lastRatio - prevRatio
                : null;
            return {
              origin_count: Array.isArray(parsed.origin_skills) ? parsed.origin_skills.length : 0,
              distilled_count: Array.isArray(parsed.distilled_skills) ? parsed.distilled_skills.length : 0,
              updated_at: parsed.updated_at ?? null,
              coverage_score:
                typeof report?.summary?.skill_coverage_score === 'number'
                  ? report.summary.skill_coverage_score
                  : null,
              gap_focused_questions_ratio:
                typeof report?.summary?.gap_focused_questions_ratio === 'number'
                  ? report.summary.gap_focused_questions_ratio
                  : null,
              gap_focused_trend_delta: trendDelta,
            };
          } catch {
            return {
              origin_count: 0,
              distilled_count: 0,
              updated_at: null,
              coverage_score: null,
              gap_focused_questions_ratio: null,
              gap_focused_trend_delta: null,
            };
          }
        })()
        : {
          origin_count: 0,
          distilled_count: 0,
          updated_at: null,
          coverage_score: null,
          gap_focused_questions_ratio: null,
          gap_focused_trend_delta: null,
        };
      const runtimeProgress = readRuntimeProgress(slug);
      const taskState = readRuntimeTaskState(slug);
      const stalled = isStalled(slug, persona.status, runtimeProgress?.updatedAt, taskState);
      const recovering = stalled && maybeAutoRecoverTraining(slug, taskState, runtimeProgress);
      return {
        ...persona,
        status: recovering ? 'recovering' : stalled ? 'stalled' : persona.status,
        skill_summary: skillSummary,
        runtime_progress: runtimeProgress,
        runtime_task: taskState,
      };
    })
    .filter(Boolean);

  return NextResponse.json(personas);
}

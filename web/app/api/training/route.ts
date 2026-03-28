import { NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { isPidAlive, readRuntimeProgress, readRuntimeTaskState } from '@/lib/runtime-progress';
import { maybeAutoRecoverTraining } from '@/lib/auto-recover';
import { readLockHolder } from '@/lib/train-queue';

interface TrainingReportSummary {
  generated_at: string;
  profile: string;
  total_rounds: number;
  summary: {
    avg_quality_score: number;
    avg_contradiction_rate: number;
    avg_duplication_rate: number;
    avg_low_confidence_coverage: number;
    total_nodes_written: number;
    total_nodes_reinforced: number;
    total_high_value_memories: number;
    total_quarantined_memories: number;
    origin_skills_added?: number;
    expanded_skills_added?: number;
    skill_coverage_score?: number;
    gap_focused_questions_ratio?: number;
  };
  rounds?: Array<{
    gap_focused_questions?: number;
    total_questions?: number;
  }>;
}

function getPersonaRoot() {
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
  const root = getPersonaRoot();
  if (!existsSync(root)) return NextResponse.json([]);

  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const data = dirs
    .map((slug) => {
      const personaPath = join(root, slug, 'persona.json');
      const reportPath = join(root, slug, 'training-report.json');
      if (!existsSync(personaPath)) return null;

      try {
        const persona = JSON.parse(readFileSync(personaPath, 'utf-8')) as {
          slug: string;
          name: string;
          status?: string;
        };
        const report = existsSync(reportPath)
          ? (JSON.parse(readFileSync(reportPath, 'utf-8')) as TrainingReportSummary)
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
        const gapFocusedTrendDelta =
          typeof lastRatio === 'number' && typeof prevRatio === 'number'
            ? lastRatio - prevRatio
            : null;
        const runtimeProgress = readRuntimeProgress(slug);
        const taskState = readRuntimeTaskState(slug);
        if (!report && !runtimeProgress) return null;
        const stalled = isStalled(slug, persona.status, runtimeProgress?.updatedAt, taskState);
        const recovering = stalled && maybeAutoRecoverTraining(slug, taskState, runtimeProgress);
        return {
          slug: persona.slug,
          name: persona.name,
          status: recovering ? 'recovering' : stalled ? 'stalled' : persona.status ?? 'created',
          report,
          gap_focused_trend_delta: gapFocusedTrendDelta,
          runtime_progress: runtimeProgress,
          runtime_task: taskState,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aa = a as { gap_focused_trend_delta?: number | null; report?: TrainingReportSummary; runtime_progress?: { updatedAt?: string } };
      const bb = b as { gap_focused_trend_delta?: number | null; report?: TrainingReportSummary; runtime_progress?: { updatedAt?: string } };
      const ad = typeof aa.gap_focused_trend_delta === 'number' ? aa.gap_focused_trend_delta : -Infinity;
      const bd = typeof bb.gap_focused_trend_delta === 'number' ? bb.gap_focused_trend_delta : -Infinity;
      if (ad !== bd) return bd - ad;
      const ta = new Date(aa.report?.generated_at ?? aa.runtime_progress?.updatedAt ?? 0).getTime();
      const tb = new Date(bb.report?.generated_at ?? bb.runtime_progress?.updatedAt ?? 0).getTime();
      return tb - ta;
    });

  return NextResponse.json(data);
}

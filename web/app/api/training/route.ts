import { NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { isPidAlive, readRuntimeProgress, readRuntimeTaskState } from '@/lib/runtime-progress';
import { maybeAutoRecoverTraining } from '@/lib/auto-recover';

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
  };
}

function getPersonaRoot() {
  return join(homedir(), '.neeko', 'personas');
}

function isStalled(
  status: string | undefined,
  runtimeUpdatedAt?: string,
  taskState?: { state: string; pid: number | null; updatedAt: string } | null
): boolean {
  if (status !== 'training') return false;
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
        const runtimeProgress = readRuntimeProgress(slug);
        const taskState = readRuntimeTaskState(slug);
        if (!report && !runtimeProgress) return null;
        const stalled = isStalled(persona.status, runtimeProgress?.updatedAt, taskState);
        const recovering = stalled && maybeAutoRecoverTraining(slug, taskState, runtimeProgress);
        return {
          slug: persona.slug,
          name: persona.name,
          status: recovering ? 'recovering' : stalled ? 'stalled' : persona.status ?? 'created',
          report,
          runtime_progress: runtimeProgress,
          runtime_task: taskState,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ta = new Date((a as { report?: TrainingReportSummary; runtime_progress?: { updatedAt?: string } }).report?.generated_at ?? (a as { runtime_progress?: { updatedAt?: string } }).runtime_progress?.updatedAt ?? 0).getTime();
      const tb = new Date((b as { report?: TrainingReportSummary; runtime_progress?: { updatedAt?: string } }).report?.generated_at ?? (b as { runtime_progress?: { updatedAt?: string } }).runtime_progress?.updatedAt ?? 0).getTime();
      return tb - ta;
    });

  return NextResponse.json(data);
}

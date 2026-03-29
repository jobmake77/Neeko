import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type TrackType = 'persona_extract' | 'work_execute';
export type StartTrackType = TrackType | 'full_serial';
export type TrainMode = 'quick' | 'full';
export type StageStatus = 'pending' | 'running' | 'blocked' | 'repairing' | 'completed';

export type FailureTag =
  | 'provider_timeout'
  | 'fetch_error'
  | 'parse_drift'
  | 'reward_instability'
  | 'lock_stale'
  | 'data_conflict'
  | 'unknown';

export type RecoveryAction =
  | 'heartbeat_renew'
  | 'soft_retry'
  | 'stage_skip_with_flag'
  | 'resume_from_checkpoint'
  | 'manual_intervention';

export interface LightningTrajectoryStep {
  context: string;
  thought_step: string;
  action: string;
  observation: string;
  outcome: string;
  reward: number;
  failure_tag?: FailureTag;
}

export interface LightningTrajectoryV1 {
  schema_version: 1;
  persona_slug: string;
  track: TrackType;
  round: number;
  stage: string;
  created_at: string;
  steps: LightningTrajectoryStep[];
}

export interface ErrorLedgerEntry {
  id: string;
  created_at: string;
  persona_slug: string;
  track: TrackType;
  stage: string;
  tag: FailureTag;
  message: string;
  recovery_action: RecoveryAction;
  recovered: boolean;
}

export interface CheckpointItem {
  id: string;
  created_at: string;
  persona_slug: string;
  track: TrackType;
  stage: string;
  round: number;
  report_rounds: number;
  soul_rounds: number;
  path: string;
}

export interface TrackAcceptance {
  consistency?: number;
  contradiction_rate?: number;
  skill_acceptance_rate?: number;
  distilled_skill_count?: number;
  skill_set_stability?: number;
  task_success_rate?: number;
  first_pass_success?: number;
  repair_success_rate?: number;
  regression_rate?: number;
  p95_stage_latency?: number;
  pass: boolean;
}

export interface TrackRunSummary {
  track: TrackType;
  mode: TrainMode;
  rounds: number;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'completed' | 'failed';
  acceptance?: TrackAcceptance;
  errors: number;
  checkpoints: number;
}

export interface RunManifest {
  schema_version: 1;
  persona_slug: string;
  orchestration: {
    track: StartTrackType;
    mode: TrainMode;
    serial: boolean;
  };
  created_at: string;
  updated_at: string;
  tracks: TrackRunSummary[];
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureDir(join(path, '..'));
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

export function getTrainingAssetPaths(personaDir: string): {
  manifestPath: string;
  errorLedgerPath: string;
  checkpointIndexPath: string;
  datasetSnapshotPath: string;
  evaluationSummaryPath: string;
  replayBufferPath: string;
} {
  return {
    manifestPath: join(personaDir, 'run_manifest.json'),
    errorLedgerPath: join(personaDir, 'error_ledger.json'),
    checkpointIndexPath: join(personaDir, 'checkpoint_index.json'),
    datasetSnapshotPath: join(personaDir, 'dataset_snapshot.md'),
    evaluationSummaryPath: join(personaDir, 'evaluation_summary.md'),
    replayBufferPath: join(personaDir, 'replay_buffer.jsonl'),
  };
}

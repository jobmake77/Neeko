import { StartTrackType, TrackType, TrainMode, RunManifest, TrackRunSummary, TrackAcceptance } from './lightning.js';

interface RunTrackInput {
  track: TrackType;
  mode: TrainMode;
}

interface RunTrackOutput {
  rounds: number;
  errors: number;
  checkpoints: number;
  acceptance: TrackAcceptance;
}

export interface OrchestratorOptions {
  slug: string;
  track: StartTrackType;
  mode: TrainMode;
  onTrackStart?: (payload: RunTrackInput) => void;
  onTrackDone?: (payload: { track: TrackType; output: RunTrackOutput }) => void;
  onManifestUpdate?: (manifest: RunManifest) => void;
  runTrack: (input: RunTrackInput) => Promise<RunTrackOutput>;
}

function plannedTracks(track: StartTrackType): TrackType[] {
  if (track === 'full_serial') return ['persona_extract', 'work_execute'];
  return [track];
}

export async function runTrainingOrchestrator(options: OrchestratorOptions): Promise<RunManifest> {
  const manifest: RunManifest = {
    schema_version: 1,
    persona_slug: options.slug,
    orchestration: {
      track: options.track,
      mode: options.mode,
      serial: true,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tracks: [],
  };

  options.onManifestUpdate?.(manifest);

  for (const track of plannedTracks(options.track)) {
    const startedAt = new Date().toISOString();
    const row: TrackRunSummary = {
      track,
      mode: options.mode,
      rounds: 0,
      started_at: startedAt,
      status: 'running',
      errors: 0,
      checkpoints: 0,
    };
    manifest.tracks.push(row);
    manifest.updated_at = new Date().toISOString();
    options.onManifestUpdate?.(manifest);
    options.onTrackStart?.({ track, mode: options.mode });

    try {
      const output = await options.runTrack({ track, mode: options.mode });
      row.rounds = output.rounds;
      row.errors = output.errors;
      row.checkpoints = output.checkpoints;
      row.acceptance = output.acceptance;
      row.status = output.acceptance.pass ? 'completed' : 'failed';
      row.finished_at = new Date().toISOString();
      manifest.updated_at = row.finished_at;
      options.onTrackDone?.({ track, output });
      options.onManifestUpdate?.(manifest);
      if (!output.acceptance.pass) break;
    } catch {
      row.status = 'failed';
      row.finished_at = new Date().toISOString();
      manifest.updated_at = row.finished_at;
      options.onManifestUpdate?.(manifest);
      break;
    }
  }

  return manifest;
}

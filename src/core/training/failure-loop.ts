import { ErrorLedgerEntry, FailureTag, RecoveryAction } from './lightning.js';

export interface FailureResolution {
  tag: FailureTag;
  recoveryAction: RecoveryAction;
  retryable: boolean;
  stageCanSkip: boolean;
}

export function classifyFailure(error: unknown): FailureResolution {
  const msg = String(error ?? '').toLowerCase();
  if (
    msg.includes('text_probe_failed') ||
    msg.includes('structured_probe_failed') ||
    msg.includes('tool_choice') ||
    msg.includes('not yet supported') ||
    msg.includes('did not match schema') ||
    msg.includes('no object generated')
  ) {
    if (
      msg.includes('tool_choice') ||
      msg.includes('not yet supported')
    ) {
      return { tag: 'capability_mismatch', recoveryAction: 'stage_skip_with_flag', retryable: false, stageCanSkip: true };
    }
    return { tag: 'structured_output_failure', recoveryAction: 'soft_retry', retryable: true, stageCanSkip: false };
  }
  if (msg.includes('timeout')) {
    return { tag: 'generation_timeout', recoveryAction: 'soft_retry', retryable: true, stageCanSkip: false };
  }
  if (
    msg.includes('qdrant') ||
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('econn') ||
    msg.includes('connection')
  ) {
    return { tag: 'transport_error', recoveryAction: 'soft_retry', retryable: true, stageCanSkip: true };
  }
  if (msg.includes('schema') || msg.includes('json') || msg.includes('parse')) {
    return { tag: 'structured_output_failure', recoveryAction: 'soft_retry', retryable: true, stageCanSkip: false };
  }
  if (msg.includes('reward') || msg.includes('score')) {
    return { tag: 'evaluation_instability', recoveryAction: 'stage_skip_with_flag', retryable: true, stageCanSkip: true };
  }
  if (msg.includes('lock')) {
    return { tag: 'lock_stale', recoveryAction: 'heartbeat_renew', retryable: true, stageCanSkip: false };
  }
  if (msg.includes('conflict')) {
    return { tag: 'data_conflict', recoveryAction: 'manual_intervention', retryable: false, stageCanSkip: false };
  }
  return { tag: 'unknown', recoveryAction: 'resume_from_checkpoint', retryable: false, stageCanSkip: false };
}

export function createFailureLedgerEntry(input: {
  slug: string;
  track: 'persona_extract' | 'work_execute';
  stage: string;
  error: unknown;
  recovered: boolean;
}): ErrorLedgerEntry {
  const resolution = classifyFailure(input.error);
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    persona_slug: input.slug,
    track: input.track,
    stage: input.stage,
    tag: resolution.tag,
    message: String(input.error),
    recovery_action: resolution.recoveryAction,
    recovered: input.recovered,
  };
}

export const __failureLoopTestables = {
  classifyFailure,
};

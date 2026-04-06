import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { ProviderName, resolveModel, resolveModelProviderName } from '../../config/model.js';

export type PreflightFailureStage = 'text_probe' | 'structured_probe';
export type PreflightFailureCategory =
  | 'generation_timeout'
  | 'transport_error'
  | 'structured_output_failure'
  | 'capability_mismatch'
  | 'unknown';

export interface ModelPreflightResult {
  ok: boolean;
  latencyMs: number;
  structuredOk: boolean;
  providerName: ProviderName;
  textAttempts: number;
  structuredAttempts: number;
  failureStage?: PreflightFailureStage;
  failureCategory?: PreflightFailureCategory;
  reason?: string;
}

const ProbeSchema = z.object({
  ok: z.boolean(),
  note: z.string(),
});

const MinimalProbeSchema = z.object({
  ok: z.boolean(),
});

export async function runModelPreflight(options?: {
  timeoutMs?: number;
  requireStructured?: boolean;
}): Promise<ModelPreflightResult> {
  const timeoutMs = Math.max(3_000, options?.timeoutMs ?? 12_000);
  const requireStructured = options?.requireStructured ?? true;
  const providerName = resolveModelProviderName();
  const model = resolveModel();
  const startedAt = Date.now();
  let textAttempts = 0;
  try {
    textAttempts = await runTextProbe(model, providerName, timeoutMs);
  } catch (error) {
    const failure = classifyCapabilityFailure(error);
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      structuredOk: false,
      providerName,
      textAttempts,
      structuredAttempts: 0,
      failureStage: 'text_probe',
      failureCategory: failure,
      reason: `text_probe_failed: ${String(error)}`,
    };
  }

  if (!requireStructured) {
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      structuredOk: true,
      providerName,
      textAttempts,
      structuredAttempts: 0,
    };
  }

  let structuredAttempts = 0;
  try {
    structuredAttempts = await runStructuredProbe(model, providerName, timeoutMs);
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      structuredOk: true,
      providerName,
      textAttempts,
      structuredAttempts,
    };
  } catch (error) {
    const failure = classifyCapabilityFailure(error);
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      structuredOk: false,
      providerName,
      textAttempts,
      structuredAttempts,
      failureStage: 'structured_probe',
      failureCategory: failure,
      reason: `structured_probe_failed: ${String(error)}`,
    };
  }
}

async function runTextProbe(
  model: ReturnType<typeof resolveModel>,
  providerName: ReturnType<typeof resolveModelProviderName>,
  timeoutMs: number
): Promise<number> {
  const attempts = providerName === 'kimi' ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const attemptTimeoutMs = providerName === 'kimi'
      ? Math.max(timeoutMs, 20_000) + ((attempt - 1) * 10_000)
      : timeoutMs;
    try {
      await withTimeout(
        generateText({
          model,
          prompt: 'Reply exactly with "pong".',
          maxTokens: 8,
          temperature: 0,
        }),
        attemptTimeoutMs,
        'preflight text probe'
      );
      return attempt;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(600 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runStructuredProbe(
  model: ReturnType<typeof resolveModel>,
  providerName: ReturnType<typeof resolveModelProviderName>,
  timeoutMs: number
): Promise<number> {
  const attempts = providerName === 'kimi' ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const useMinimalProbe = providerName === 'kimi' && attempt > 1;
    const attemptTimeoutMs = providerName === 'kimi'
      ? Math.max(timeoutMs, 25_000) + ((attempt - 1) * 15_000)
      : timeoutMs;
    try {
      await withTimeout(
        generateObject({
          model,
          schema: useMinimalProbe ? MinimalProbeSchema : ProbeSchema,
          prompt: useMinimalProbe
            ? 'Return JSON object with only {"ok": true}.'
            : 'Return JSON object: {"ok": true, "note": "ready"}.',
        }),
        attemptTimeoutMs,
        'preflight structured probe'
      );
      return attempt;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(900 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyCapabilityFailure(error: unknown): PreflightFailureCategory {
  const msg = String(error ?? '').toLowerCase();
  if (msg.includes('timeout')) return 'generation_timeout';
  if (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('econn') ||
    msg.includes('connection')
  ) {
    return 'transport_error';
  }
  if (
    msg.includes('tool_choice') ||
    msg.includes('not yet supported')
  ) {
    return 'capability_mismatch';
  }
  if (
    msg.includes('schema') ||
    msg.includes('json') ||
    msg.includes('parse') ||
    msg.includes('object')
  ) {
    return 'structured_output_failure';
  }
  return 'unknown';
}

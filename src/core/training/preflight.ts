import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { resolveModel, resolveModelProviderName } from '../../config/model.js';

export interface ModelPreflightResult {
  ok: boolean;
  latencyMs: number;
  structuredOk: boolean;
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
  try {
    await runTextProbe(model, providerName, timeoutMs);
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      structuredOk: false,
      reason: `text_probe_failed: ${String(error)}`,
    };
  }

  if (!requireStructured) {
    return { ok: true, latencyMs: Date.now() - startedAt, structuredOk: true };
  }

  try {
    await runStructuredProbe(model, providerName, timeoutMs);
    return { ok: true, latencyMs: Date.now() - startedAt, structuredOk: true };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      structuredOk: false,
      reason: `structured_probe_failed: ${String(error)}`,
    };
  }
}

async function runTextProbe(
  model: ReturnType<typeof resolveModel>,
  providerName: ReturnType<typeof resolveModelProviderName>,
  timeoutMs: number
): Promise<void> {
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
      return;
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
): Promise<void> {
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
      return;
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

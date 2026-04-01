import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../../config/model.js';

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

export async function runModelPreflight(options?: {
  timeoutMs?: number;
  requireStructured?: boolean;
}): Promise<ModelPreflightResult> {
  const timeoutMs = Math.max(3_000, options?.timeoutMs ?? 12_000);
  const requireStructured = options?.requireStructured ?? true;
  const model = resolveModel();
  const startedAt = Date.now();
  try {
    await withTimeout(
      generateText({
        model,
        prompt: 'Reply exactly with "pong".',
        maxTokens: 8,
        temperature: 0,
      }),
      timeoutMs,
      'preflight text probe'
    );
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
    await withTimeout(
      generateObject({
        model,
        schema: ProbeSchema,
        prompt: 'Return JSON object: {"ok": true, "note": "ready"}.',
      }),
      timeoutMs,
      'preflight structured probe'
    );
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


import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import {
  getDefaultModelForProvider,
  listAvailableProviders,
  ProviderName,
  resolveModelForOverride,
  resolvePreferredModelOverride,
} from '../../config/model.js';
import { settings } from '../../config/settings.js';

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
  const startedAt = Date.now();
  const attempts = buildProviderAttempts();
  let lastFailure: {
    providerName: ProviderName;
    textAttempts: number;
    structuredAttempts: number;
    failureStage: PreflightFailureStage;
    error: unknown;
  } | null = null;

  for (const attempt of attempts) {
    const providerName = attempt.provider;
    const model = resolveModelForOverride(attempt, 'training');
    let textAttempts = 0;
    try {
      textAttempts = await runTextProbe(model, providerName, timeoutMs);
    } catch (error) {
      lastFailure = {
        providerName,
        textAttempts,
        structuredAttempts: 0,
        failureStage: 'text_probe',
        error,
      };
      if (shouldAttemptProviderFailover(error, attempt, attempts)) {
        continue;
      }
      break;
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
      lastFailure = {
        providerName,
        textAttempts,
        structuredAttempts,
        failureStage: 'structured_probe',
        error,
      };
      if (shouldAttemptProviderFailover(error, attempt, attempts)) {
        continue;
      }
      break;
    }
  }

  const providerName = lastFailure?.providerName ?? attempts[0]?.provider ?? 'kimi';
  const failure = classifyCapabilityFailure(lastFailure?.error);
  return {
    ok: false,
    latencyMs: Date.now() - startedAt,
    structuredOk: false,
    providerName,
    textAttempts: lastFailure?.textAttempts ?? 0,
    structuredAttempts: lastFailure?.structuredAttempts ?? 0,
    failureStage: lastFailure?.failureStage,
    failureCategory: failure,
    reason: `${lastFailure?.failureStage === 'structured_probe' ? 'structured_probe_failed' : 'text_probe_failed'}: ${String(lastFailure?.error ?? 'unknown preflight failure')}`,
  };
}

function buildProviderAttempts(): Array<{ provider: ProviderName; model?: string }> {
  const preferred = resolvePreferredModelOverride('training');
  const seen = new Set<string>();
  const attempts: Array<{ provider: ProviderName; model?: string }> = [];
  const push = (provider?: ProviderName, model?: string) => {
    if (!provider) return;
    const resolvedModel = String(model || '').trim() || getDefaultModelForProvider(provider);
    const key = `${provider}:${resolvedModel}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ provider, model: resolvedModel });
  };
  push(preferred?.provider, preferred?.model);
  for (const provider of listAvailableProviders('training')) {
    if (provider === preferred?.provider) continue;
    push(provider);
  }
  return attempts;
}

function shouldAttemptProviderFailover(
  error: unknown,
  currentAttempt: { provider: ProviderName },
  attempts: Array<{ provider: ProviderName }>
): boolean {
  const hasNextProvider = attempts.some((attempt) => attempt.provider !== currentAttempt.provider);
  if (!hasNextProvider) return false;
  const msg = String(error ?? '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('usage limit') ||
    msg.includes('limit for this period') ||
    msg.includes('resource exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('overloaded') ||
    msg.includes('service unavailable')
  );
}

async function runTextProbe(
  model: ReturnType<typeof resolveModelForOverride>,
  providerName: ProviderName,
  timeoutMs: number
): Promise<number> {
  if (providerName === 'gemini') {
    await runGeminiPromptProbe({
      model: extractModelId(model),
      prompt: 'Reply exactly with "pong".',
      timeoutMs,
      maxOutputTokens: 16,
    });
    return 1;
  }
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
  model: ReturnType<typeof resolveModelForOverride>,
  providerName: ProviderName,
  timeoutMs: number
): Promise<number> {
  if (providerName === 'gemini') {
    await runGeminiPromptProbe({
      model: extractModelId(model),
      prompt: 'Return JSON object: {"ok": true, "note": "ready"}.',
      timeoutMs,
      maxOutputTokens: 64,
    });
    return 1;
  }
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

function getGeminiApiKey(): string {
  const configured = String(settings.get('geminiApiKey') ?? '').trim();
  if (configured) return configured;
  return String(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '').trim();
}

function extractModelId(model: unknown): string | undefined {
  const candidate = model as { modelId?: string; model?: string };
  return String(candidate?.modelId ?? candidate?.model ?? '').trim() || undefined;
}

async function runGeminiPromptProbe(input: {
  model?: string;
  prompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
}): Promise<void> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing.');
  }
  const requestedModel = String(input.model || '').trim();
  const models = requestedModel
    ? [requestedModel, ...(requestedModel === 'gemini-2.5-flash' ? ['gemini-2.5-flash-lite'] : [])]
    : ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await withTimeout(
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: input.prompt }],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: input.maxOutputTokens,
            },
          }),
        }),
        input.timeoutMs,
        'gemini preflight probe'
      );
      const payload: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error?.message || `Gemini generateContent ${response.status}`;
        throw new Error(message);
      }
      const text = (payload?.candidates ?? [])
        .flatMap((candidate: any) => candidate?.content?.parts ?? [])
        .map((part: any) => typeof part?.text === 'string' ? part.text : '')
        .join('\n')
        .trim();
      if (!text) {
        throw new Error('Gemini returned empty text.');
      }
      return;
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      if (!/high demand|rate limit|resource exhausted|429|503|overloaded|unavailable|unsupported model|not found/.test(message)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini preflight probe failed.');
}

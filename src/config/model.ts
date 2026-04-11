import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { settings } from './settings.js';
import type { LanguageModelV1 } from 'ai';

export type ProviderName = 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek';

const DEFAULT_MODELS: Record<ProviderName, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  kimi: 'moonshot-v1-128k',
  gemini: 'gemini-1.5-flash',
  deepseek: 'deepseek-chat',
};

export function resolvePreferredProviderName(): ProviderName | undefined {
  const cfg = settings.getAll();
  const preferred = String(process.env.NEEKO_ACTIVE_PROVIDER || cfg.activeProvider || '').trim().toLowerCase();
  if (
    preferred === 'claude' ||
    preferred === 'openai' ||
    preferred === 'kimi' ||
    preferred === 'gemini' ||
    preferred === 'deepseek'
  ) {
    return preferred;
  }
  return undefined;
}

function getProviderResolutionContext() {
  const cfg = settings.getAll();
  const anthropicKey = String(cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  const openaiKey = String(cfg.openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
  const kimiKey = String(cfg.kimiApiKey || process.env.KIMI_API_KEY || '').trim();
  const geminiKey = String(cfg.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  const deepseekKey = String(cfg.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  const preferred = resolvePreferredProviderName();
  const rawDefaultModel = String(cfg.defaultModel ?? '').trim();
  const kimiModelFromEnv = String(process.env.NEEKO_KIMI_MODEL ?? process.env.KIMI_MODEL ?? '').trim();
  const isKimiCodeKey = /^sk-kimi-/i.test(kimiKey);
  const kimiModel = isKimiCodeKey
    ? (kimiModelFromEnv || 'kimi-for-coding')
    : (
      kimiModelFromEnv ||
      (/moonshot|kimi/i.test(rawDefaultModel) ? rawDefaultModel : '') ||
      'moonshot-v1-128k'
    );

  const order = [
    preferred,
    'claude', 'openai', 'kimi', 'gemini', 'deepseek',
  ].filter(Boolean) as string[];
  const seen = new Set<string>();
  const deduped = order.filter((p) => !seen.has(p) && seen.add(p));
  const configuredModel = resolveConfiguredModel(rawDefaultModel);

  return {
    anthropicKey,
    openaiKey,
    kimiKey,
    geminiKey,
    deepseekKey,
    configuredModel,
    isKimiCodeKey,
    kimiModel,
    deduped,
  };
}

function resolveConfiguredModel(rawDefaultModel: string): Partial<Record<ProviderName, string>> {
  const value = rawDefaultModel.trim();
  if (!value) return {};
  if (/^claude-/i.test(value)) return { claude: value };
  if (/^(gpt|o1|o3|o4)/i.test(value)) return { openai: value };
  if (/^(moonshot|kimi)/i.test(value)) return { kimi: value };
  if (/^gemini/i.test(value)) return { gemini: value };
  if (/^deepseek/i.test(value)) return { deepseek: value };
  return {};
}

export function resolveModelProviderName(): ProviderName {
  const ctx = getProviderResolutionContext();

  for (const provider of ctx.deduped) {
    if (provider === 'claude' && ctx.anthropicKey) return 'claude';
    if (provider === 'openai' && ctx.openaiKey) return 'openai';
    if (provider === 'kimi' && ctx.kimiKey) return 'kimi';
    if (provider === 'gemini' && ctx.geminiKey) return 'gemini';
    if (provider === 'deepseek' && ctx.deepseekKey) return 'deepseek';
  }

  throw new Error('未配置任何 LLM API Key。请先在设置页填写至少一个模型的 API Key。');
}

/**
 * 返回当前可用的 LLM 模型实例。
 * 优先使用 activeProvider 对应的 key；若该 key 为空则按顺序 fallback 到第一个有值的 provider。
 */
export function resolveModel(): LanguageModelV1 {
  const ctx = getProviderResolutionContext();

  for (const provider of ctx.deduped) {
    if (provider === 'claude' && ctx.anthropicKey) {
      process.env.ANTHROPIC_API_KEY = ctx.anthropicKey;
      const model = ctx.configuredModel.claude ?? DEFAULT_MODELS.claude;
      console.error(`[model] 使用 Claude（Anthropic） model=${model}`);
      return anthropic(model) as unknown as LanguageModelV1;
    }
    if (provider === 'openai' && ctx.openaiKey) {
      process.env.OPENAI_API_KEY = ctx.openaiKey;
      const model = ctx.configuredModel.openai ?? DEFAULT_MODELS.openai;
      console.error(`[model] 使用 OpenAI model=${model}`);
      return openai(model) as unknown as LanguageModelV1;
    }
    if (provider === 'kimi' && ctx.kimiKey) {
      if (ctx.isKimiCodeKey) {
        console.error(`[model] 使用 Kimi Code（Anthropic兼容） model=${ctx.kimiModel}`);
        const kimiCoding = createAnthropic({
          baseURL: 'https://api.kimi.com/coding/v1',
          apiKey: ctx.kimiKey,
        });
        return kimiCoding(ctx.kimiModel as any) as unknown as LanguageModelV1;
      }
      console.error(`[model] 使用 Kimi（月之暗面 OpenAI兼容） model=${ctx.kimiModel}`);
      const kimiOpenAI = createOpenAI({
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: ctx.kimiKey,
      });
      return kimiOpenAI(ctx.kimiModel) as unknown as LanguageModelV1;
    }
    if (provider === 'gemini' && ctx.geminiKey) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = ctx.geminiKey;
      const model = ctx.configuredModel.gemini ?? DEFAULT_MODELS.gemini;
      console.error(`[model] 使用 Gemini（Google） model=${model}`);
      return google(model) as unknown as LanguageModelV1;
    }
    if (provider === 'deepseek' && ctx.deepseekKey) {
      const model = ctx.configuredModel.deepseek ?? DEFAULT_MODELS.deepseek;
      console.error(`[model] 使用 DeepSeek model=${model}`);
      const deepseek = createOpenAI({
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: ctx.deepseekKey,
      });
      return deepseek(model) as unknown as LanguageModelV1;
    }
  }

  throw new Error(
    '未配置任何 LLM API Key。请先在设置页填写至少一个模型的 API Key。'
  );
}

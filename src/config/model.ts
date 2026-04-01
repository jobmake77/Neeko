import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { settings } from './settings.js';
import type { LanguageModelV1 } from 'ai';

/**
 * 返回当前可用的 LLM 模型实例。
 * 优先使用 activeProvider 对应的 key；若该 key 为空则按顺序 fallback 到第一个有值的 provider。
 */
export function resolveModel(): LanguageModelV1 {
  const cfg = settings.getAll();

  const anthropicKey = String(cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  const openaiKey    = String(cfg.openaiApiKey    || process.env.OPENAI_API_KEY    || '').trim();
  const kimiKey      = String(cfg.kimiApiKey      || process.env.KIMI_API_KEY      || '').trim();
  const geminiKey    = String(cfg.geminiApiKey    || process.env.GEMINI_API_KEY    || '').trim();
  const deepseekKey  = String(cfg.deepseekApiKey  || process.env.DEEPSEEK_API_KEY  || '').trim();

  const preferred = cfg.activeProvider as string | undefined;
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

  // Build ordered list: preferred first, then rest
  const order = [
    preferred,
    'claude', 'openai', 'kimi', 'gemini', 'deepseek',
  ].filter(Boolean) as string[];
  const seen = new Set<string>();
  const deduped = order.filter((p) => !seen.has(p) && seen.add(p));

  for (const provider of deduped) {
    if (provider === 'claude' && anthropicKey) {
      process.env.ANTHROPIC_API_KEY = anthropicKey;
      console.error(`[model] 使用 Claude（Anthropic）`);
      return anthropic('claude-sonnet-4-6') as unknown as LanguageModelV1;
    }
    if (provider === 'openai' && openaiKey) {
      process.env.OPENAI_API_KEY = openaiKey;
      console.error(`[model] 使用 OpenAI（gpt-4o-mini）`);
      return openai('gpt-4o-mini') as unknown as LanguageModelV1;
    }
    if (provider === 'kimi' && kimiKey) {
      if (isKimiCodeKey) {
        console.error(`[model] 使用 Kimi Code（Anthropic兼容） model=${kimiModel}`);
        const kimiCoding = createAnthropic({
          baseURL: 'https://api.kimi.com/coding/v1',
          apiKey: kimiKey,
        });
        return kimiCoding(kimiModel as any) as unknown as LanguageModelV1;
      }
      console.error(`[model] 使用 Kimi（月之暗面 OpenAI兼容） model=${kimiModel}`);
      const kimiOpenAI = createOpenAI({
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: kimiKey,
      });
      return kimiOpenAI(kimiModel) as unknown as LanguageModelV1;
    }
    if (provider === 'gemini' && geminiKey) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = geminiKey;
      console.error(`[model] 使用 Gemini（Google）`);
      return google('gemini-1.5-flash') as unknown as LanguageModelV1;
    }
    if (provider === 'deepseek' && deepseekKey) {
      console.error(`[model] 使用 DeepSeek`);
      const deepseek = createOpenAI({
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: deepseekKey,
      });
      return deepseek('deepseek-chat') as unknown as LanguageModelV1;
    }
  }

  throw new Error(
    '未配置任何 LLM API Key。请在 Web UI 设置页填写至少一个模型的 API Key 并保存。'
  );
}

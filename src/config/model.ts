import { anthropic } from '@ai-sdk/anthropic';
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

  const anthropicKey = cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  const openaiKey    = cfg.openaiApiKey    || process.env.OPENAI_API_KEY    || '';
  const kimiKey      = cfg.kimiApiKey      || process.env.KIMI_API_KEY      || '';
  const geminiKey    = cfg.geminiApiKey    || process.env.GEMINI_API_KEY    || '';
  const deepseekKey  = cfg.deepseekApiKey  || process.env.DEEPSEEK_API_KEY  || '';

  const preferred = cfg.activeProvider as string | undefined;

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
      console.error(`[model] 使用 Kimi（月之暗面）`);
      const kimi = createOpenAI({
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: kimiKey,
      });
      return kimi('moonshot-v1-8k') as unknown as LanguageModelV1;
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

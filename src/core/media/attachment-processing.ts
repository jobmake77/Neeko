import { readFileSync, existsSync, statSync } from 'fs';
import { extname } from 'path';
import OpenAI from 'openai';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { settings } from '../../config/settings.js';
import type { AttachmentRef } from '../models/workbench.js';
import { VideoAdapter } from '../pipeline/ingestion/video.js';

export type AttachmentProcessingStatus = 'pending' | 'ready' | 'unsupported' | 'error';
export type AttachmentCapability = 'text_extract' | 'image_understanding' | 'transcription';

export type AttachmentProcessingResult = {
  status: AttachmentProcessingStatus;
  summary?: string;
  provider?: string;
  error?: string;
  capability?: AttachmentCapability;
};

export async function enrichAttachment(item: AttachmentRef): Promise<AttachmentRef> {
  const result = await processAttachment(item);
  return {
    ...item,
    processing_status: result.status,
    processing_summary: result.summary,
    processing_provider: result.provider,
    processing_error: result.error,
    processing_capability: result.capability,
  };
}

export async function processAttachment(item: AttachmentRef): Promise<AttachmentProcessingResult> {
  if (!item.path || !existsSync(item.path) || !statSync(item.path).isFile()) {
    return { status: 'error', error: '附件文件当前不可用。' };
  }

  if (item.type === 'text' || item.type === 'file') {
    const preview = readTextPreview(item.path, 2200);
    if (!preview) return { status: 'unsupported', error: '当前文件类型无法提取文本。', capability: 'text_extract' };
    return {
      status: 'ready',
      summary: preview,
      provider: 'local',
      capability: 'text_extract',
    };
  }

  if (item.type === 'image') {
    return processImageAttachment(item);
  }

  if (item.type === 'audio' || item.type === 'video') {
    return processMediaAttachment(item);
  }

  return { status: 'unsupported', error: '当前附件类型还不支持预处理。' };
}

async function processImageAttachment(item: AttachmentRef): Promise<AttachmentProcessingResult> {
  const openaiKey = String(settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY ?? '').trim();
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey });
      const mimeType = item.mime ?? inferMimeType(item.path, 'image/jpeg');
      const base64 = readFileSync(item.path).toString('base64');
      const result = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content: 'You summarize user-provided images into concise factual context for another model. Focus on visible subjects, text, scene, and notable details.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image in concise Chinese. Keep it factual and short.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      });
      const summary = result.choices[0]?.message?.content?.trim();
      if (summary) {
        return { status: 'ready', summary, provider: 'openai', capability: 'image_understanding' };
      }
    } catch {
      // fall through
    }
  }

  const geminiKey = String(settings.get('geminiApiKey') ?? process.env.GEMINI_API_KEY ?? '').trim();
  if (geminiKey) {
    try {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = geminiKey;
      const bytes = readFileSync(item.path);
      const mimeType = item.mime ?? inferMimeType(item.path, 'image/jpeg');
      const { text } = await generateText({
        model: google('gemini-1.5-flash'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '请用一句简短中文描述这张图片的主要内容。' },
              { type: 'image', image: bytes, mimeType },
            ],
          },
        ],
        maxTokens: 120,
      });
      if (text.trim()) {
        return { status: 'ready', summary: text.trim(), provider: 'gemini', capability: 'image_understanding' };
      }
    } catch {
      // fall through
    }
  }

  const kimiKey = String(settings.get('kimiApiKey') ?? process.env.KIMI_API_KEY ?? '').trim();
  if (kimiKey) {
    return {
      status: 'unsupported',
      provider: 'kimi',
      capability: 'image_understanding',
      error: /^sk-kimi-/i.test(kimiKey)
        ? '当前 Kimi Code key 不能直接用于开放平台图片识别。'
        : '当前 Kimi 图片识别接入尚未单独实现。',
    };
  }

  return {
    status: 'unsupported',
    capability: 'image_understanding',
    error: '未配置可用的图片理解 provider。',
  };
}

async function processMediaAttachment(item: AttachmentRef): Promise<AttachmentProcessingResult> {
  const openaiKey = String(settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY ?? '').trim();
  if (openaiKey) {
    try {
      const adapter = new VideoAdapter(openaiKey);
      const docs = await adapter.fetch(item.path);
      const transcript = docs.map((doc) => doc.content.trim()).filter(Boolean).join(' ');
      if (transcript) {
        return {
          status: 'ready',
          summary: truncateText(transcript, 2200),
          provider: 'openai',
          capability: 'transcription',
        };
      }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (/404|not found/i.test(message)) {
        return {
          status: 'unsupported',
          provider: 'openai',
          capability: 'transcription',
          error: '当前 OpenAI 兼容后端未提供 transcription 接口。',
        };
      }
    }
  }

  const geminiKey = String(settings.get('geminiApiKey') ?? process.env.GEMINI_API_KEY ?? '').trim();
  if (geminiKey) {
    return {
      status: 'unsupported',
      provider: 'gemini',
      capability: 'transcription',
      error: 'Gemini 转写接入位已预留，尚未完成文件上传链路。',
    };
  }

  const kimiKey = String(settings.get('kimiApiKey') ?? process.env.KIMI_API_KEY ?? '').trim();
  if (kimiKey) {
    return {
      status: 'unsupported',
      provider: 'kimi',
      capability: 'transcription',
      error: /^sk-kimi-/i.test(kimiKey)
        ? '当前 Kimi Code key 不支持这条音视频转写链路。'
        : 'Moonshot 转写接入位已预留，尚未完成独立适配。',
    };
  }

  return {
    status: 'unsupported',
    capability: 'transcription',
    error: '未配置可用的音视频转写 provider。',
  };
}

function readTextPreview(path: string, maxChars: number): string | undefined {
  try {
    const ext = extname(path).toLowerCase();
    if (!['.txt', '.md', '.json', '.csv', '.html', '.yml', '.yaml'].includes(ext)) return undefined;
    const content = readFileSync(path, 'utf-8').replace(/\s+/g, ' ').trim();
    if (!content) return undefined;
    return truncateText(content, maxChars);
  } catch {
    return undefined;
  }
}

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars).trimEnd()}...`;
}

function inferMimeType(path: string, fallback = 'application/octet-stream'): string {
  const lower = extname(path).toLowerCase();
  if (['.png'].includes(lower)) return 'image/png';
  if (['.jpg', '.jpeg'].includes(lower)) return 'image/jpeg';
  if (['.webp'].includes(lower)) return 'image/webp';
  if (['.gif'].includes(lower)) return 'image/gif';
  if (['.mp4'].includes(lower)) return 'video/mp4';
  if (['.mov'].includes(lower)) return 'video/quicktime';
  if (['.webm'].includes(lower)) return 'video/webm';
  if (['.mp3'].includes(lower)) return 'audio/mpeg';
  if (['.wav'].includes(lower)) return 'audio/wav';
  if (['.m4a'].includes(lower)) return 'audio/mp4';
  if (['.ogg'].includes(lower)) return 'audio/ogg';
  return fallback;
}

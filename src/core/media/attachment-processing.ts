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

type GeminiFileResource = {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: string | { name?: string };
  error?: { message?: string };
};

export async function enrichAttachment(item: AttachmentRef): Promise<AttachmentRef> {
  const result = await processAttachment(item);
  const validationStatus = result.status === 'ready' ? 'validated' : 'rejected';
  return {
    ...item,
    processing_status: result.status,
    processing_summary: result.summary,
    processing_provider: result.provider,
    processing_error: result.error,
    processing_capability: result.capability,
    validation_status: validationStatus,
    validation_summary: result.status === 'ready'
      ? '附件已通过输入校验，可作为本轮上下文使用。'
      : (result.error ?? '附件未通过输入校验，本轮不会作为上下文使用。'),
  };
}

export async function processAttachment(item: AttachmentRef): Promise<AttachmentProcessingResult> {
  if (!item.path || !existsSync(item.path) || !statSync(item.path).isFile()) {
    return { status: 'error', error: '附件文件当前不可用。' };
  }
  if ((item.size ?? 0) > 200 * 1024 * 1024) {
    return { status: 'error', error: '附件体积超过当前可处理上限。' };
  }
  if (item.mime && !/^(image|audio|video|text|application\/(json|pdf|msword|vnd\.openxmlformats-officedocument))/i.test(item.mime)) {
    return { status: 'unsupported', error: '当前附件 MIME 类型不在可处理范围内。' };
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
  const openaiKey = getConfiguredSecret('openaiApiKey', 'OPENAI_API_KEY');
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

  const geminiKey = getConfiguredSecret('geminiApiKey', 'GEMINI_API_KEY');
  if (geminiKey) {
    try {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = geminiKey;
      const bytes = readFileSync(item.path);
      const mimeType = item.mime ?? inferMimeType(item.path, 'image/jpeg');
      const { text } = await generateText({
        model: google('gemini-1.5-flash') as any,
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

  const kimiKey = getConfiguredSecret('kimiApiKey', 'KIMI_API_KEY');
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
  let openaiFallbackError: string | undefined;
  let geminiFallbackError: string | undefined;

  const openaiKey = getConfiguredSecret('openaiApiKey', 'OPENAI_API_KEY');
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
        openaiFallbackError = '当前 OpenAI 兼容后端未提供 transcription 接口。';
      }
    }
  }

  const geminiKey = getConfiguredSecret('geminiApiKey', 'GEMINI_API_KEY');
  if (geminiKey) {
    try {
      const summary = await summarizeMediaWithGemini(item, geminiKey);
      if (summary) {
        return {
          status: 'ready',
          summary,
          provider: 'gemini',
          capability: 'transcription',
        };
      }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      geminiFallbackError = message || 'Gemini 音视频处理失败。';
      return {
        status: 'error',
        provider: 'gemini',
        capability: 'transcription',
        error: geminiFallbackError,
      };
    }
  }

  const kimiKey = getConfiguredSecret('kimiApiKey', 'KIMI_API_KEY');
  if (kimiKey && !geminiFallbackError) {
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
    status: geminiFallbackError ? 'error' : 'unsupported',
    provider: geminiFallbackError ? 'gemini' : (openaiFallbackError ? 'openai' : undefined),
    capability: 'transcription',
    error: geminiFallbackError ?? openaiFallbackError ?? '未配置可用的音视频转写 provider。',
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

function getConfiguredSecret(settingKey: string, envKey: string): string {
  const configured = String(settings.get(settingKey as any) ?? '').trim();
  if (configured) return configured;
  return String(process.env[envKey] ?? '').trim();
}

async function summarizeMediaWithGemini(item: AttachmentRef, apiKey: string): Promise<string> {
  return retryGeminiMediaOperation(async () => {
    const mimeType = item.mime ?? inferMimeType(item.path, item.type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    const file = await uploadGeminiFile(item.path, mimeType, apiKey);
    if (!file.name || !file.uri) {
      throw new Error('Gemini 未返回可用的文件引用。');
    }

    try {
      const activeFile = await waitForGeminiFileActive(file.name, apiKey);
      if (!activeFile.uri) {
        throw new Error('Gemini 文件处理完成后缺少可用 URI。');
      }
      const prompt = item.type === 'audio'
        ? '请用中文整理这段音频的可读转写。先给出尽量忠实的转写内容，再用两三句话总结重点。如果内容无法完全辨认，请明确标注不确定片段。'
        : '请用中文整理这个视频的可读转写，并简要说明关键画面或事件。先给出尽量忠实的转写内容，再补充 2-3 句视频重点。';

      const text = await generateGeminiMediaSummary(activeFile.uri, activeFile.mimeType ?? mimeType, prompt, apiKey);
      return truncateText(text, 2200);
    } finally {
      await deleteGeminiFile(file.name, apiKey).catch(() => undefined);
    }
  });
}

async function uploadGeminiFile(path: string, mimeType: string, apiKey: string): Promise<GeminiFileResource> {
  const bytes = readFileSync(path);
  const startResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file: {
        display_name: path.split(/[\\/]/).pop() ?? 'media',
      },
    }),
  });

  if (!startResponse.ok) {
    const payload = await startResponse.json().catch(() => ({}));
    const message = extractGeminiErrorMessage(payload) ?? `Gemini upload start ${startResponse.status}`;
    throw new Error(message);
  }

  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini 未返回上传地址。');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });
  const payload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    const message = extractGeminiErrorMessage(payload) ?? `Gemini upload finalize ${uploadResponse.status}`;
    throw new Error(message);
  }

  return normalizeGeminiFile(payload);
}

async function waitForGeminiFileActive(name: string, apiKey: string): Promise<GeminiFileResource> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(apiKey)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = extractGeminiErrorMessage(payload) ?? `Gemini file get ${response.status}`;
      throw new Error(message);
    }

    const file = normalizeGeminiFile(payload);
    const state = normalizeGeminiState(file.state);
    if (state === 'ACTIVE') return file;
    if (state === 'FAILED') {
      throw new Error(file.error?.message ?? 'Gemini 文件处理失败。');
    }
    await sleep(2500);
  }
  throw new Error('Gemini 文件处理超时，请稍后重试。');
}

async function deleteGeminiFile(name: string | undefined, apiKey: string): Promise<void> {
  if (!name) return;
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(apiKey)}`, {
    method: 'DELETE',
  }).catch(() => undefined);
}

function normalizeGeminiFile(payload: unknown): GeminiFileResource {
  const root = (payload && typeof payload === 'object' && 'file' in payload)
    ? (payload as { file?: GeminiFileResource }).file
    : payload as GeminiFileResource | undefined;
  return root ?? {};
}

function normalizeGeminiState(state: GeminiFileResource['state']): string {
  if (typeof state === 'string') return state.toUpperCase();
  if (state && typeof state === 'object' && typeof state.name === 'string') return state.name.toUpperCase();
  return '';
}

function extractGeminiText(payload: any): string {
  return (payload?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractGeminiErrorMessage(payload: any): string | undefined {
  return payload?.error?.message
    ?? payload?.error?.status
    ?? payload?.message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryGeminiMediaOperation<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [0, 2000, 5000];
  let lastError: unknown;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      await sleep(delays[attempt]);
    }
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      if (!/high demand|rate limit|resource exhausted|429|503|overloaded|unavailable/.test(message)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini 音视频处理失败。');
}

async function generateGeminiMediaSummary(fileUri: string, mimeType: string, prompt: string, apiKey: string): Promise<string> {
  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let lastError: unknown;

  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  file_data: {
                    mime_type: mimeType,
                    file_uri: fileUri,
                  },
                },
              ],
            },
          ],
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = extractGeminiErrorMessage(payload) ?? `Gemini generateContent ${response.status}`;
        throw new Error(message);
      }

      const text = extractGeminiText(payload).trim();
      if (!text) {
        throw new Error('Gemini 未返回可读的音视频内容。');
      }
      return text;
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      if (!/high demand|rate limit|resource exhausted|429|503|overloaded|unavailable/.test(message)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini 媒体生成失败。');
}

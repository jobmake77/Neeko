import { createReadStream } from 'fs';
import { extname } from 'path';
import readline from 'readline';
import { ChatMessageEvent } from '../../models/evidence.js';

export async function* streamChatMessageEvents(filePath: string): AsyncGenerator<ChatMessageEvent> {
  const format = await detectChatFileFormat(filePath);
  if (format === 'json_array') {
    for await (const item of streamJsonArrayEvents(filePath)) {
      yield item;
    }
    return;
  }

  if (format === 'jsonl') {
    for await (const item of streamJsonLinesEvents(filePath)) {
      yield item;
    }
    return;
  }

  for await (const item of streamPlainTextEvents(filePath)) {
    yield item;
  }
}

async function detectChatFileFormat(filePath: string): Promise<'json_array' | 'jsonl' | 'plain'> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.jsonl' || ext === '.ndjson') return 'jsonl';

  const stream = createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 512 });
  try {
    for await (const chunk of stream) {
      const trimmed = String(chunk).trimStart();
      if (!trimmed) continue;
      if (trimmed.startsWith('[')) return 'json_array';
      if (trimmed.startsWith('{')) return 'jsonl';
      return 'plain';
    }
  } finally {
    stream.destroy();
  }
  return 'plain';
}

async function* streamJsonLinesEvents(filePath: string): AsyncGenerator<ChatMessageEvent> {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const event = normalizeChatEvent(parsed);
    if (event) yield event;
  }
}

async function* streamPlainTextEvents(filePath: string): AsyncGenerator<ChatMessageEvent> {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  const pattern = /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?)\s+\[(.+?)\]:\s*(.+)$/;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = pattern.exec(trimmed);
    if (!match) {
      yield {
        id: crypto.randomUUID(),
        sender: 'system',
        content: trimmed,
        system_boundary: isSystemBoundary(trimmed),
        metadata: { raw_line: trimmed },
      };
      continue;
    }

    yield {
      id: crypto.randomUUID(),
      sender: match[2].trim(),
      content: match[3].trim(),
      timestamp: safeIso(match[1]),
      system_boundary: false,
    };
  }
}

async function* streamJsonArrayEvents(filePath: string): AsyncGenerator<ChatMessageEvent> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  let objectBuffer = '';
  let capturing = false;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for await (const chunk of stream) {
    for (const ch of String(chunk)) {
      if (!capturing) {
        if (ch === '{') {
          capturing = true;
          depth = 1;
          objectBuffer = '{';
        }
        continue;
      }

      objectBuffer += ch;

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') depth--;

      if (depth === 0) {
        const parsed = JSON.parse(objectBuffer) as Record<string, unknown>;
        const event = normalizeChatEvent(parsed);
        if (event) yield event;
        capturing = false;
        objectBuffer = '';
      }
    }
  }
}

function normalizeChatEvent(value: Record<string, unknown>): ChatMessageEvent | null {
  const content = String(value.content ?? value.text ?? value.message ?? value.body ?? '').trim();
  if (!content) return null;
  const timestamp = safeIso(value.timestamp ?? value.time ?? value.created_at);
  const sender = String(
    value.sender ??
    value.author ??
    value.name ??
    value.sender_name ??
    value.nickname ??
    value.from ??
    'unknown'
  );
  const eventType = optionalString(value.type ?? value.message_type ?? value.msg_type);
  const boundaryByType = eventType ? /system|meta|separator|notification/i.test(eventType) : false;
  return {
    id: crypto.randomUUID(),
    sender,
    content,
    timestamp,
    conversation_id: optionalString(value.conversation_id ?? value.thread_id ?? value.chat_id),
    metadata: {
      ...value,
    },
    system_boundary: boundaryByType || isSystemBoundary(content),
  };
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function safeIso(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isSystemBoundary(content: string): boolean {
  return (
    /^[-=]{3,}$/.test(content) ||
    /^\d{4}-\d{2}-\d{2}$/.test(content) ||
    /(messages below|以下为|系统消息|撤回|joined the chat|left the chat)/i.test(content)
  );
}

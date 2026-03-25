import { readFileSync } from 'fs';
import { BaseSourceAdapter } from './base.js';
import { RawDocument } from '../../models/memory.js';

/**
 * Chat adapter — parses exported WeChat / Feishu chat logs.
 * Expected format: a JSON file with array of { sender, content, timestamp } objects,
 * or a plain text export with lines like: "2024-01-01 10:00 [Name]: message"
 */
export class ChatAdapter extends BaseSourceAdapter {
  readonly sourceType = 'wechat' as const;

  constructor(private readonly platform: 'wechat' | 'feishu' = 'wechat') {
    super();
  }

  async fetch(filePath: string): Promise<RawDocument[]> {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`ChatAdapter: cannot read file "${filePath}": ${String(err)}`);
    }

    // Try JSON first
    try {
      return this.parseJson(raw, filePath);
    } catch {
      // Fall back to plain text
      return this.parsePlainText(raw, filePath);
    }
  }

  private parseJson(raw: string, filePath: string): RawDocument[] {
    const items = JSON.parse(raw) as Array<{
      sender?: string;
      author?: string;
      content?: string;
      text?: string;
      timestamp?: string;
      time?: string;
    }>;

    return items
      .filter((item) => (item.content ?? item.text ?? '').trim().length > 0)
      .map((item) =>
        this.makeDoc({
          source_type: this.platform,
          source_url: filePath,
          content: (item.content ?? item.text ?? '').trim(),
          author: item.sender ?? item.author ?? 'unknown',
          published_at: item.timestamp ?? item.time
            ? new Date(item.timestamp ?? item.time ?? '').toISOString()
            : undefined,
        })
      );
  }

  private parsePlainText(raw: string, filePath: string): RawDocument[] {
    const lines = raw.split('\n');
    const docs: RawDocument[] = [];
    // Pattern: "2024-01-01 10:00 [Name]: message"
    const pattern = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)\s+\[(.+?)\]:\s*(.+)$/;

    for (const line of lines) {
      const m = pattern.exec(line.trim());
      if (m) {
        docs.push(
          this.makeDoc({
            source_type: this.platform,
            source_url: filePath,
            content: m[3].trim(),
            author: m[2].trim(),
            published_at: new Date(m[1]).toISOString(),
          })
        );
      }
    }

    return docs;
  }
}

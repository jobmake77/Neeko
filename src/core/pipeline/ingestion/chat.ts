import { BaseSourceAdapter } from './base.js';
import { RawDocument } from '../../models/memory.js';
import { streamChatMessageEvents } from './chat-stream.js';

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
    const docs: RawDocument[] = [];
    try {
      for await (const item of streamChatMessageEvents(filePath)) {
        if (item.system_boundary) continue;
        docs.push(
          this.makeDoc({
            source_type: this.platform,
            source_url: filePath,
            content: item.content.trim(),
            author: item.sender,
            published_at: item.timestamp,
            metadata: {
              conversation_id: item.conversation_id,
              ...(item.metadata ?? {}),
            },
          })
        );
      }
    } catch (err) {
      throw new Error(`ChatAdapter: cannot read file "${filePath}": ${String(err)}`);
    }
    return docs;
  }
}

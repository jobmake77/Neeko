import { BaseSourceAdapter } from './base.js';
import { RawDocument } from '../../models/memory.js';

/**
 * Article adapter — reads blog posts / web articles via agent-reach or raw HTTP fetch.
 */
export class ArticleAdapter extends BaseSourceAdapter {
  readonly sourceType = 'article' as const;

  async fetch(url: string): Promise<RawDocument[]> {
    // First try agent-reach
    try {
      const { execSync } = await import('child_process');
      const cmd = `agent-reach read --url "${url}" --format json`;
      const output = execSync(cmd, { timeout: 60_000 }).toString();
      const page = JSON.parse(output) as {
        content: string;
        title?: string;
        author?: string;
        published_at?: string;
      };

      return [
        this.makeDoc({
          source_type: 'article',
          source_url: url,
          source_platform: new URL(url).hostname,
          content: page.content,
          author: page.author ?? 'unknown',
          published_at: page.published_at,
          metadata: { title: page.title },
        }),
      ];
    } catch {
      // Fallback: basic fetch
      return this.fetchRaw(url);
    }
  }

  private async fetchRaw(url: string): Promise<RawDocument[]> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ArticleAdapter: HTTP ${res.status} for ${url}`);
    const html = await res.text();

    // Very basic: strip tags
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return [
      this.makeDoc({
        source_type: 'article',
        source_url: url,
        source_platform: new URL(url).hostname,
        content: text.slice(0, 50_000), // cap
        author: 'unknown',
      }),
    ];
  }
}

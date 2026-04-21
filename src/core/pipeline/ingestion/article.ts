import { BaseSourceAdapter } from './base.js';
import { RawDocument } from '../../models/memory.js';

function buildFallbackUrls(rawUrl: string): string[] {
  try {
    const parsed = new URL(rawUrl);
    const urls = [parsed.toString()];
    if (parsed.hostname.startsWith('www.')) {
      const apex = new URL(parsed.toString());
      apex.hostname = parsed.hostname.replace(/^www\./, '');
      urls.push(apex.toString());
    }
    return Array.from(new Set(urls));
  } catch {
    return [rawUrl];
  }
}

function isHostLookupFailure(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    const text = String(current instanceof Error ? (current.stack ?? current.message) : current);
    if (/ENOTFOUND|getaddrinfo|Could not resolve host/i.test(text)) return true;
    if (current instanceof Error && 'cause' in current) {
      queue.push((current as Error & { cause?: unknown }).cause);
    }
  }
  return false;
}

/**
 * Article adapter — reads blog posts / web articles via agent-reach or raw HTTP fetch.
 */
export class ArticleAdapter extends BaseSourceAdapter {
  readonly sourceType = 'article' as const;

  async fetch(url: string): Promise<RawDocument[]> {
    let lastError: unknown;
    for (const candidate of buildFallbackUrls(url)) {
      // First try agent-reach
      try {
        const { execSync } = await import('child_process');
        const cmd = `agent-reach read --json "${candidate}"`;
        const output = execSync(cmd, {
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString();
        const page = JSON.parse(output) as {
          content: string;
          title?: string;
          author?: string;
          published_at?: string;
        };

        return [
          this.makeDoc({
            source_type: 'article',
            source_url: candidate,
            source_platform: new URL(candidate).hostname,
            content: page.content,
            author: page.author ?? 'unknown',
            published_at: page.published_at,
            metadata: { title: page.title },
          }),
        ];
      } catch (error) {
        lastError = error;
      }

      // Fallback: basic fetch
      try {
        return await this.fetchRaw(candidate);
      } catch (error) {
        lastError = error;
      }
    }

    if (isHostLookupFailure(lastError)) {
      throw new Error(`Host lookup failed for ${new URL(url).hostname}`);
    }
    throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? 'article fetch failed')));
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

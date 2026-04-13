import { BaseSourceAdapter, FetchOptions } from './base.js';
import { RawDocument } from '../../models/memory.js';

/**
 * AgentReach adapter — delegates to the `agent-reach` CLI to fetch
 * Twitter/X posts and arbitrary web pages without dealing with API auth.
 *
 * Requires `agent-reach` to be installed and configured in the environment.
 */
export class AgentReachAdapter extends BaseSourceAdapter {
  readonly sourceType = 'twitter' as const;

  constructor(private readonly platform: 'twitter' | 'article' = 'twitter') {
    super();
  }

  async fetch(target: string, options: FetchOptions = {}): Promise<RawDocument[]> {
    const { limit = 100, since, includeReplies = false } = options;

    if (this.platform === 'twitter') {
      return this.fetchTwitter(target, { limit, since, includeReplies });
    } else {
      return this.fetchWebPage(target);
    }
  }

  private async fetchTwitter(
    handle: string,
    options: { limit: number; since?: Date; includeReplies: boolean }
  ): Promise<RawDocument[]> {
    // Build agent-reach CLI invocation for Twitter data
    const { execa } = await import('child_process' as never as string).catch(() => ({
      execa: null,
    }));

    // Use dynamic import of child_process via exec
    const { execSync } = await import('child_process');

    const cleanHandle = handle.replace(/^@/, '');
    const sinceFlag = options.since
      ? `--since ${options.since.toISOString().split('T')[0]}`
      : '';
    const repliesFlag = options.includeReplies ? '--include-replies' : '';

    try {
      const cmd = [
        'agent-reach',
        'search',
        '--platform twitter',
        `--query "from:${cleanHandle}"`,
        `--limit ${options.limit}`,
        sinceFlag,
        repliesFlag,
        '--format json',
      ]
        .filter(Boolean)
        .join(' ');

      const output = execSync(cmd, { timeout: 60_000 }).toString();
      const items = JSON.parse(output) as Array<{
        id: string;
        text: string;
        author: string;
        url?: string;
        created_at?: string;
      }>;

      return items.map((item) =>
        this.makeDoc({
          source_type: 'twitter',
          source_url: item.url ?? `https://x.com/${cleanHandle}/status/${item.id}`,
          source_platform: 'twitter',
          content: item.text,
          author: cleanHandle,
          author_handle: `@${cleanHandle}`,
          published_at: item.created_at,
          metadata: { tweet_id: item.id },
        })
      );
    } catch (err) {
      console.warn(
        `[AgentReachAdapter] agent-reach not available or failed, returning empty: ${String(err).slice(0, 200)}`
      );
      return [];
    }
  }

  private async fetchWebPage(url: string): Promise<RawDocument[]> {
    try {
      const { execSync } = await import('child_process');
      const cmd = `agent-reach read --json "${url}"`;
      const output = execSync(cmd, { timeout: 60_000 }).toString();
      const page = JSON.parse(output) as { content: string; title?: string; author?: string };

      return [
        this.makeDoc({
          source_type: 'article',
          source_url: url,
          source_platform: 'web',
          content: page.content,
          author: page.author ?? 'unknown',
          metadata: { title: page.title },
        }),
      ];
    } catch {
      return [];
    }
  }
}

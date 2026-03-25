import { BaseSourceAdapter, FetchOptions } from './base.js';
import { RawDocument } from '../../models/memory.js';
import { execSync } from 'child_process';

/**
 * OpenCLI adapter — 通过 opencli 复用浏览器登录状态抓取 Twitter/X 推文，
 * 无需任何 API Key 或 OAuth。
 *
 * 安装：npm install -g @jackwener/opencli
 * 文档：https://github.com/jackwener/opencli
 *
 * 输出字段：id, author, text, likes, retweets, replies, views, created_at, url
 */

interface OpenCliTweet {
  id: string;
  author: string;
  text: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
  created_at?: string;
  url?: string;
}

export class TwitterAdapter extends BaseSourceAdapter {
  readonly sourceType = 'twitter' as const;

  async fetch(target: string, options: FetchOptions = {}): Promise<RawDocument[]> {
    const { limit = 100 } = options;
    const cleanHandle = target.replace(/^@/, '');

    // 优先用 search from: 语法抓指定用户推文（结果更精准）
    const tweets = await this.searchByUser(cleanHandle, limit);
    return tweets;
  }

  private async searchByUser(handle: string, limit: number): Promise<RawDocument[]> {
    try {
      // opencli twitter search "from:handle" --limit N --format json
      const cmd = `opencli twitter search "from:${handle}" --limit ${limit} --format json`;
      const output = execSync(cmd, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }).toString().trim();

      const items = JSON.parse(output) as OpenCliTweet[];
      return this.mapTweets(items, handle);
    } catch (err) {
      const msg = String(err).slice(0, 300);
      console.warn(`[TwitterAdapter] opencli search 失败，尝试 timeline 模式: ${msg}`);
      return this.fetchTimeline(handle, limit);
    }
  }

  // fallback：抓 following timeline（需要已关注目标账号）
  private async fetchTimeline(handle: string, limit: number): Promise<RawDocument[]> {
    try {
      const cmd = `opencli twitter timeline --type following --limit ${limit} --format json`;
      const output = execSync(cmd, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      }).toString().trim();

      const allTweets = JSON.parse(output) as OpenCliTweet[];
      // 过滤出目标用户的推文
      const filtered = allTweets.filter(
        (t) => t.author?.toLowerCase().replace(/^@/, '') === handle.toLowerCase()
      );
      return this.mapTweets(filtered, handle);
    } catch (err) {
      console.warn(`[TwitterAdapter] opencli timeline 也失败: ${String(err).slice(0, 200)}`);
      return [];
    }
  }

  private mapTweets(items: OpenCliTweet[], handle: string): RawDocument[] {
    return items
      .filter((t) => t.text?.trim())
      .map((t) =>
        this.makeDoc({
          source_type: 'twitter',
          source_url: t.url ?? `https://x.com/${handle}/status/${t.id}`,
          source_platform: 'twitter',
          content: t.text.trim(),
          author: handle,
          author_handle: `@${handle}`,
          published_at: t.created_at
            ? new Date(t.created_at).toISOString()
            : undefined,
          metadata: {
            tweet_id: t.id,
            likes: t.likes,
            retweets: t.retweets,
            replies: t.replies,
            views: t.views,
          },
        })
      );
  }
}

/**
 * 检查 opencli 是否可用，返回版本号或 null
 */
export function checkOpenCli(): string | null {
  try {
    const out = execSync('opencli --version', { timeout: 5000 }).toString().trim();
    return out;
  } catch {
    return null;
  }
}

import { BaseSourceAdapter, FetchOptions } from './base.js';
import { RawDocument } from '../../models/memory.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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

function normalizeHandleValue(value: string | undefined | null): string {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

function extractTweetDateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

export function filterTweetsByHandle(items: OpenCliTweet[], handle: string): OpenCliTweet[] {
  const normalizedHandle = normalizeHandleValue(handle);
  return items.filter((item) => normalizeHandleValue(item.author) === normalizedHandle && String(item.text ?? '').trim().length > 0);
}

export function computeNextUntilDate(items: OpenCliTweet[]): string | undefined {
  const dates = items
    .map((item) => extractTweetDateOnly(item.created_at))
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates[0];
}

export class TwitterAdapter extends BaseSourceAdapter {
  readonly sourceType = 'twitter' as const;

  async fetch(target: string, options: FetchOptions = {}): Promise<RawDocument[]> {
    const { limit = 100 } = options;
    const cleanHandle = target.replace(/^@/, '');

    // 优先用 search from: + until 分页抓指定用户推文。
    const tweets = await this.searchByUser(cleanHandle, limit);
    return tweets;
  }

  private async searchByUser(handle: string, limit: number): Promise<RawDocument[]> {
    const pageLimit = Math.max(20, Math.min(limit, 100));
    const maxPages = Math.max(1, Math.min(40, Math.ceil(limit / 20)));
    const deduped = new Map<string, OpenCliTweet>();
    let untilDate: string | undefined;
    let previousUntilDate: string | undefined;

    for (let page = 0; page < maxPages && deduped.size < limit; page += 1) {
      const items = await this.searchUserPage(handle, pageLimit, untilDate);
      const matched = filterTweetsByHandle(items, handle);
      for (const item of matched) {
        if (!item.id || deduped.has(item.id)) continue;
        deduped.set(item.id, item);
        if (deduped.size >= limit) break;
      }
      if (matched.length === 0) break;
      const nextUntilDate = computeNextUntilDate(matched);
      if (!nextUntilDate || nextUntilDate === previousUntilDate) break;
      previousUntilDate = untilDate;
      untilDate = nextUntilDate;
      await sleep(900);
    }

    if (deduped.size > 0) {
      return this.mapTweets([...deduped.values()].slice(0, limit), handle);
    }

    console.warn('[TwitterAdapter] search 模式全部失败，尝试 timeline 模式');
    return this.fetchTimeline(handle, limit);
  }

  private async searchUserPage(handle: string, limit: number, untilDate?: string): Promise<OpenCliTweet[]> {
    const opencli = resolveOpenCliBinary();
    const query = untilDate
      ? `from:${handle} until:${untilDate}`
      : `from:${handle}`;
    const candidates = [limit, Math.min(limit, 120), Math.min(limit, 60)]
      .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);

    for (const n of candidates) {
      const cmd = `${shellQuote(opencli)} twitter search "${query}" --limit ${n} --format json`;
      try {
        const items = await this.runOpenCliJson(cmd);
        if (items.length > 0) {
          if (n !== limit) {
            console.warn(`[TwitterAdapter] search 降载重试成功（limit ${limit} -> ${n}）`);
          }
          return items;
        }
      } catch (err) {
        const msg = String(err).slice(0, 300);
        console.warn(`[TwitterAdapter] opencli search 失败（limit=${n}, until=${untilDate ?? 'latest'}）: ${msg}`);
      }
    }

    return [];
  }

  // fallback：抓 following timeline（需要已关注目标账号）
  private async fetchTimeline(handle: string, limit: number): Promise<RawDocument[]> {
    const opencli = resolveOpenCliBinary();
    const candidates = [limit, Math.min(limit, 120), Math.min(limit, 60)]
      .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
    for (const n of candidates) {
      const cmd = `${shellQuote(opencli)} twitter timeline --type following --limit ${n} --format json`;
      try {
        const allTweets = await this.runOpenCliJson(cmd);
        const filtered = filterTweetsByHandle(allTweets, handle);
        if (filtered.length > 0) {
          if (n !== limit) {
            console.warn(`[TwitterAdapter] timeline 降载重试成功（limit ${limit} -> ${n}）`);
          }
          return this.mapTweets(filtered, handle);
        }
      } catch (err) {
        console.warn(`[TwitterAdapter] opencli timeline 失败（limit=${n}）: ${String(err).slice(0, 200)}`);
      }
    }
    return [];
  }

  private mapTweets(items: OpenCliTweet[], handle: string): RawDocument[] {
    return filterTweetsByHandle(items, handle)
      .map((t) =>
        this.makeDoc({
          source_type: 'twitter',
          source_url: t.url ?? `https://x.com/${handle}/status/${t.id}`,
          source_platform: 'twitter',
          content: t.text.trim(),
          author: t.author.replace(/^@/, ''),
          author_handle: `@${t.author.replace(/^@/, '')}`,
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

  private async runOpenCliJson(cmd: string): Promise<OpenCliTweet[]> {
    const maxAttempts = 3;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const output = execSync(cmd, {
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
          env: openCliEnv(),
        }).toString().trim();

        const parsed = JSON.parse(output) as unknown;
        if (Array.isArray(parsed)) return parsed as OpenCliTweet[];
        if (parsed && typeof parsed === 'object') {
          const maybe = (parsed as { tweets?: unknown }).tweets;
          if (Array.isArray(maybe)) return maybe as OpenCliTweet[];
        }
        return [];
      } catch (err) {
        lastError = err;
        const msg = String(err);
        const detached = isRetryableOpenCliDetachError(msg);
        if (detached && attempt < maxAttempts) {
          const waitMs = attempt * 1200;
          console.warn(`[TwitterAdapter] opencli detached，${waitMs}ms 后重试（${attempt}/${maxAttempts}）`);
          await sleep(waitMs);
          continue;
        }
        if (attempt < maxAttempts) {
          const waitMs = attempt * 800;
          await sleep(waitMs);
          continue;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function isRetryableOpenCliDetachError(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('detached while handling command')
    || normalized.includes('debugger is not attached')
    || normalized.includes('target closed')
    || normalized.includes('no target with given id found');
}

/**
 * 检查 opencli 是否可用，返回版本号或 null
 */
export function checkOpenCli(): string | null {
  try {
    const opencli = resolveOpenCliBinary();
    const out = execSync(`${shellQuote(opencli)} --version`, {
      timeout: 5000,
      env: openCliEnv(),
    })
      .toString()
      .trim();
    return out;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveOpenCliBinary(): string {
  if (process.env.OPENCLI_BIN && existsSync(process.env.OPENCLI_BIN)) {
    return process.env.OPENCLI_BIN;
  }

  try {
    const fromWhich = execSync('command -v opencli', {
      timeout: 2000,
      env: openCliEnv(),
    })
      .toString()
      .trim();
    if (fromWhich) return fromWhich;
  } catch {
    // fall through
  }

  const candidate = join(homedir(), '.npm-global', 'bin', 'opencli');
  if (existsSync(candidate)) return candidate;

  return 'opencli';
}

function shellQuote(path: string): string {
  if (/^[a-zA-Z0-9_./-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function openCliEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? '';
  const pathParts = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(homedir(), '.npm-global', 'bin'),
    currentPath,
  ].filter(Boolean);
  return {
    ...process.env,
    PATH: pathParts.join(':'),
  };
}

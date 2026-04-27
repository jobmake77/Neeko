import { BaseSourceAdapter } from './base.js';
import { RawDocument } from '../../models/memory.js';
import {
  type ExtractionQualityAssessment,
  type SourceFailureClass,
} from '../../models/workbench.js';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export function buildFallbackUrls(rawUrl: string): string[] {
  try {
    const parsed = new URL(rawUrl);
    const urls = [parsed.toString()];
    if (parsed.hostname.startsWith('www.')) {
      const apex = new URL(parsed.toString());
      apex.hostname = parsed.hostname.replace(/^www\./, '');
      urls.push(apex.toString());
    } else if (parsed.hostname.split('.').length === 2) {
      const www = new URL(parsed.toString());
      www.hostname = `www.${parsed.hostname}`;
      urls.push(www.toString());
    }
    return Array.from(new Set(urls));
  } catch {
    return [rawUrl];
  }
}

export function isHostLookupFailure(error: unknown): boolean {
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

export function isBrowserErrorPage(content: string): boolean {
  const normalized = String(content || '').toLowerCase();
  return normalized.includes('err_connection_closed')
    || normalized.includes('err_name_not_resolved')
    || normalized.includes('err_connection_refused')
    || normalized.includes('err_timed_out')
    || normalized.includes("this site can't be reached")
    || normalized.includes('无法访问此网站');
}

export function classifySourceFailure(error: unknown): SourceFailureClass {
  const message = String(error instanceof Error ? (error.stack ?? error.message) : error ?? '').toLowerCase();
  if (!message) return 'unknown';
  if (/enotfound|getaddrinfo|could not resolve host|name_not_resolved/.test(message)) return 'dns_failed';
  if (/timed out|timeout|err_timed_out/.test(message)) return 'timeout';
  if (/429|rate limit|too many requests/.test(message)) return 'rate_limited';
  if (/403|401|forbidden|unauthorized|access denied/.test(message)) return 'access_denied';
  if (/404|not found/.test(message)) return 'not_found';
  if (/empty markdown|did not produce a markdown file|returned empty/.test(message)) return 'content_empty';
  if (/provider.*html|provider.*layout|unexpected page structure/.test(message)) return 'provider_structural_failure';
  if (/aggregator|directory/.test(message)) return 'aggregator_or_directory_page';
  if (/too short|thin content/.test(message)) return 'content_too_thin';
  if (/quality gate|browser error page|content quality/.test(message)) return 'extraction_low_quality';
  if (/unsupported|not available/.test(message)) return 'unsupported';
  return 'unknown';
}

export function assessArticleExtractionQuality(contentOrDoc: string | RawDocument): ExtractionQualityAssessment {
  const content = typeof contentOrDoc === 'string'
    ? contentOrDoc
    : String(contentOrDoc.content ?? '');
  const normalized = content.replace(/\s+/g, ' ').trim();
  const paragraphs = content
    .split(/\n{2,}|\r\n\r\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const issueCodes: string[] = [];
  let score = 0.82;

  if (!normalized) {
    return {
      status: 'rejected',
      summary: '提取结果为空，无法作为稳定网页内容使用。',
      score: 0,
      content_length: 0,
      excerpt_count: 0,
      signal_count: 0,
      issue_codes: ['empty_content'],
    };
  }

  if (normalized.length < 280) {
    score -= 0.42;
    issueCodes.push('too_short');
  }
  if (paragraphs.length < 2) {
    score -= 0.18;
    issueCodes.push('low_structure');
  }
  if (isBrowserErrorPage(normalized)) {
    score = 0;
    issueCodes.push('browser_error_page');
  }
  if (/(subscribe|sign in|login|cookie|javascript required|enable javascript)/i.test(normalized)) {
    score -= 0.16;
    issueCodes.push('shell_page_noise');
  }
  const signalCount = [
    /^#\s+/m.test(content),
    /\b(i am|i'm|my|we|our|project|build|work|prefer)\b/i.test(content),
    /[\u4e00-\u9fff]/u.test(content),
  ].filter(Boolean).length;
  if (signalCount === 0) {
    score -= 0.12;
    issueCodes.push('weak_authorial_signal');
  }

  const clampedScore = Math.max(0, Math.min(1, score));
  const status = clampedScore >= 0.58
    ? 'accepted'
    : clampedScore >= 0.34
      ? 'weak'
      : 'rejected';
  const summary = status === 'accepted'
    ? '网页提取质量通过，可继续用于来源校验和摄取。'
    : status === 'weak'
      ? '网页提取拿到了正文，但结构或内容信号偏弱，建议谨慎使用。'
      : '网页提取质量不足，已被质量门禁拦截。';
  return {
    status,
    summary,
    score: clampedScore,
    content_length: normalized.length,
    excerpt_count: paragraphs.length,
    signal_count: signalCount,
    issue_codes: issueCodes,
  };
}

function ensureArticleQuality(contentOrDoc: string | RawDocument, context: string): void {
  const quality = assessArticleExtractionQuality(contentOrDoc);
  if (quality.status === 'rejected') {
    throw new Error(`${context} quality gate rejected: ${quality.issue_codes.join(',') || 'content_quality'}`);
  }
}

/**
 * Article adapter — reads blog posts / web articles via opencli first,
 * then agent-reach, and finally falls back to raw HTTP fetch.
 */
export class ArticleAdapter extends BaseSourceAdapter {
  readonly sourceType = 'article' as const;

  async fetch(url: string): Promise<RawDocument[]> {
    let lastError: unknown;
    for (const candidate of buildFallbackUrls(url)) {
      // First try opencli browser-backed web read
      try {
        const page = await this.fetchViaOpenCli(candidate);
        if (page.content.trim().length > 0) {
          ensureArticleQuality(page.content, 'opencli article extraction');
          return [
            this.makeDoc({
              source_type: 'article',
              source_url: candidate,
              source_platform: new URL(candidate).hostname,
              content: page.content,
              author: page.author ?? 'unknown',
              published_at: page.published_at,
              metadata: { title: page.title, fetched_via: 'opencli_web_read' },
            }),
          ];
        }
      } catch (error) {
        lastError = error;
      }

      // First try agent-reach
      try {
        const cmd = `agent-reach read --json ${shellQuote(candidate)}`;
        const output = execSync(cmd, {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: openCliEnv(),
        }).toString();
        const page = JSON.parse(output) as {
          content: string;
          title?: string;
          author?: string;
          published_at?: string;
        };
        ensureArticleQuality(page.content, 'agent-reach article extraction');

        return [
          this.makeDoc({
            source_type: 'article',
            source_url: candidate,
            source_platform: new URL(candidate).hostname,
            content: page.content,
            author: page.author ?? 'unknown',
            published_at: page.published_at,
            metadata: { title: page.title, fetched_via: 'agent_reach' },
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

  private async fetchViaOpenCli(url: string): Promise<{
    content: string;
    title?: string;
    author?: string;
    published_at?: string;
  }> {
    const opencli = resolveOpenCliCommand();
    if (!opencli) {
      throw new Error('opencli is not available');
    }

    const tmpDir = mkdtempSync(join(homedir(), '.neeko-opencli-web-'));
    try {
      const command = `${opencli} web read --url ${shellQuote(url)} --output ${shellQuote(tmpDir)} -f md --download-images false --wait 2`;
      await runShellWithRetry(command);

      const markdownFile = findFirstMarkdownFile(tmpDir);
      if (!markdownFile) {
        throw new Error('opencli web read did not produce a markdown file');
      }

      const content = readFileSync(markdownFile, 'utf-8').trim();
      if (!content) {
        throw new Error('opencli web read returned empty markdown');
      }
      if (isBrowserErrorPage(content)) {
        throw new Error('opencli web read returned a browser error page');
      }

      const lines = content.split('\n');
      const title = lines.find((line) => line.startsWith('# '))?.replace(/^#\s+/, '').trim();
      return {
        content: content.slice(0, 50_000),
        title,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
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

    const content = text.slice(0, 50_000);
    ensureArticleQuality(content, 'raw article extraction');

    return [
      this.makeDoc({
        source_type: 'article',
        source_url: url,
        source_platform: new URL(url).hostname,
        content,
        author: 'unknown',
        metadata: { fetched_via: 'raw_fetch' },
      }),
    ];
  }
}

async function runShellWithRetry(command: string): Promise<void> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      execSync(command, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: openCliEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return;
    } catch (error) {
      lastError = error;
      const message = String(error);
      if (isRetryableOpenCliDetachError(message) && attempt < maxAttempts) {
        await sleep(attempt * 1200);
        continue;
      }
      if (attempt < maxAttempts) {
        await sleep(attempt * 800);
        continue;
      }
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? 'opencli web read failed')));
}

function findFirstMarkdownFile(root: string): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (stats.isFile() && fullPath.endsWith('.md')) {
        return fullPath;
      }
    }
  }
  return null;
}

function isRetryableOpenCliDetachError(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('detached while handling command')
    || normalized.includes('debugger is not attached')
    || normalized.includes('target closed')
    || normalized.includes('no target with given id found');
}

export function resolveOpenCliCommand(): string | null {
  if (process.env.OPENCLI_BIN && existsSync(process.env.OPENCLI_BIN)) {
    return shellQuote(process.env.OPENCLI_BIN);
  }

  try {
    const fromWhich = execSync('command -v opencli', {
      timeout: 2000,
      env: openCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
    if (fromWhich) return shellQuote(fromWhich);
  } catch {
    // fall through
  }

  const candidate = join(homedir(), '.npm-global', 'bin', 'opencli');
  if (existsSync(candidate)) return shellQuote(candidate);

  try {
    execSync('command -v npx', {
      timeout: 2000,
      env: openCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 'npx -y @jackwener/opencli';
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function openCliEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? '';
  const pathParts = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(homedir(), '.npm-global', 'bin'),
    currentPath,
  ].filter(Boolean);
  const browserCommandTimeoutSeconds = Math.max(
    parseInt(process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '0', 10) || 0,
    180,
  );
  return {
    ...process.env,
    PATH: pathParts.join(':'),
    OPENCLI_BROWSER_COMMAND_TIMEOUT: String(browserCommandTimeoutSeconds),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

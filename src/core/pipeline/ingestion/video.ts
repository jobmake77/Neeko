import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { basename, extname, join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import OpenAI, { toFile } from 'openai';
import { BaseSourceAdapter, FetchOptions } from './base.js';
import { RawDocument } from '../../models/memory.js';

type SubtitleTrack = { url: string; ext?: string };
type SubtitleMap = Record<string, SubtitleTrack[]>;
type VideoJson = {
  id?: string;
  title?: string;
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  webpage_url?: string;
  original_url?: string;
  url?: string;
  extractor?: string;
  upload_date?: string;
  timestamp?: number;
  duration?: number;
  entries?: VideoJson[];
  subtitles?: SubtitleMap;
  automatic_captions?: SubtitleMap;
};

type TranscriptSegment = {
  id?: string | number;
  startMs?: number;
  endMs?: number;
  text: string;
};

const SUBTITLE_LANG_PRIORITY = ['zh-Hans', 'zh-CN', 'zh-TW', 'zh', 'en', 'en-US'];
const SUBTITLE_EXT_PRIORITY = ['json3', 'srv3', 'vtt'];
const REMOTE_VIDEO_LIMIT = 12;

/**
 * Video/Audio adapter.
 * - local file: transcribe via OpenAI Whisper
 * - remote URL/channel: fetch subtitles via yt-dlp; fallback to downloaded audio + Whisper
 */
export class VideoAdapter extends BaseSourceAdapter {
  readonly sourceType = 'video' as const;

  private openai: OpenAI;

  constructor(apiKey?: string) {
    super();
    this.openai = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async fetch(target: string, options: FetchOptions = {}): Promise<RawDocument[]> {
    if (existsSync(target)) {
      return this.fetchLocalFile(target);
    }
    if (/^https?:\/\//i.test(target)) {
      return this.fetchRemote(target, options);
    }
    throw new Error(`VideoAdapter: unsupported target: "${target}"`);
  }

  private async fetchLocalFile(filePath: string): Promise<RawDocument[]> {
    if (!existsSync(filePath)) {
      throw new Error(`VideoAdapter: file not found: "${filePath}"`);
    }

    const filename = basename(filePath) || 'audio';
    const file = await toFile(readFileSync(filePath), filename);
    const transcription = await this.openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      response_format: 'verbose_json',
    });

    const payload = transcription as {
      text?: string;
      duration?: number;
      language?: string;
      segments?: Array<{ id?: number; start?: number; end?: number; text?: string }>;
    };
    const text = typeof transcription === 'string' ? transcription : payload.text ?? '';
    const segments = Array.isArray(payload.segments) ? payload.segments : [];

    if (segments.length > 0) {
      return segments
        .filter((segment) => String(segment.text ?? '').trim().length > 0)
        .map((segment) =>
          this.makeDoc({
            source_type: 'video',
            source_url: filePath,
            source_platform: 'video_transcript',
            content: String(segment.text ?? '').trim(),
            author: 'unknown',
            metadata: {
              filename,
              duration: payload.duration,
              language: payload.language,
              speaker_segments: [],
              segment_start_ms: Math.round((segment.start ?? 0) * 1000),
              segment_end_ms: Math.round((segment.end ?? 0) * 1000),
              nonverbal_signals: [],
              transcript_segment_id: segment.id,
            },
          })
        );
    }

    return [
      this.makeDoc({
        source_type: 'video',
        source_url: filePath,
        source_platform: 'video_transcript',
        content: text,
        author: 'unknown',
        metadata: {
          filename,
          duration: payload.duration,
          language: payload.language,
          speaker_segments: [],
          nonverbal_signals: [],
        },
      }),
    ];
  }

  private async fetchRemote(target: string, options: FetchOptions): Promise<RawDocument[]> {
    const items = this.resolveRemoteEntries(target, options);
    const docs: RawDocument[] = [];

    for (const item of items) {
      const detail = this.loadYtDlpJson(item);
      const transcript = await this.loadRemoteTranscript(detail);
      docs.push(...transcript);
    }

    return docs;
  }

  private resolveRemoteEntries(target: string, options: FetchOptions): string[] {
    const json = this.loadYtDlpJson(target, { flatPlaylist: true, playlistLimit: options.limit ?? REMOTE_VIDEO_LIMIT });
    const since = options.since?.getTime();

    if (!Array.isArray(json.entries) || json.entries.length === 0) {
      return [target];
    }

    const entries = json.entries
      .map((entry) => ({
        url: this.resolveRemoteEntryUrl(entry),
        time: parseUploadTime(entry),
      }))
      .filter((item): item is { url: string; time: number | undefined } => Boolean(item.url))
      .filter((item) => !since || !item.time || item.time >= since)
      .slice(0, options.limit ?? REMOTE_VIDEO_LIMIT);

    return entries.map((item) => item.url);
  }

  private resolveRemoteEntryUrl(entry: VideoJson): string | null {
    if (entry.webpage_url) return entry.webpage_url;
    if (entry.original_url) return entry.original_url;
    if (entry.url && /^https?:\/\//i.test(entry.url)) return entry.url;
    if (entry.extractor?.includes('youtube') && entry.id) return `https://www.youtube.com/watch?v=${entry.id}`;
    if (entry.extractor?.includes('bilibili') && entry.id) return `https://www.bilibili.com/video/${entry.id}`;
    return null;
  }

  private loadYtDlpJson(target: string, options: { flatPlaylist?: boolean; playlistLimit?: number } = {}): VideoJson {
    const args = [
      '--dump-single-json',
      '--no-warnings',
      '--skip-download',
      ...(options.flatPlaylist ? ['--flat-playlist'] : []),
      ...(options.flatPlaylist && options.playlistLimit ? ['--playlist-end', String(options.playlistLimit)] : []),
      target,
    ];
    const output = runYtDlp(args, {
      encoding: 'utf-8',
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(output) as VideoJson;
  }

  private async loadRemoteTranscript(detail: VideoJson): Promise<RawDocument[]> {
    const subtitleTrack = chooseSubtitleTrack(detail.subtitles) ?? chooseSubtitleTrack(detail.automatic_captions);
    const sourceUrl = detail.webpage_url ?? detail.original_url ?? detail.url ?? '';
    const publishedAt = parsePublishedAt(detail);
    const author = detail.uploader ?? detail.channel ?? detail.uploader_id ?? 'unknown';
    const title = detail.title ?? basename(sourceUrl || 'video');

    if (subtitleTrack) {
      const segments = await fetchSubtitleSegments(subtitleTrack);
      if (segments.length > 0) {
        return segments.map((segment, index) =>
          this.makeDoc({
            source_type: 'video',
            source_url: sourceUrl,
            source_platform: normalizeVideoPlatform(sourceUrl),
            content: segment.text,
            author,
            published_at: publishedAt,
            metadata: {
              title,
              duration: detail.duration,
              speaker_segments: [],
              nonverbal_signals: [],
              transcript_segment_id: segment.id ?? index,
              segment_start_ms: segment.startMs,
              segment_end_ms: segment.endMs,
              remote_video_id: detail.id,
              transcript_source: subtitleTrack.ext ?? 'subtitle',
            },
          })
        );
      }
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'neeko-video-'));
    try {
      runYtDlp([
        '--no-warnings',
        '-x',
        '--audio-format', 'mp3',
        '--output', join(tempDir, '%(id)s.%(ext)s'),
        sourceUrl,
      ], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const audioFile = readdirSync(tempDir)
        .map((name) => join(tempDir, name))
        .find((path) => ['.mp3', '.m4a', '.wav', '.webm', '.opus'].includes(extname(path).toLowerCase()));
      if (!audioFile) return [];
      const docs = await this.fetchLocalFile(audioFile);
      return docs.map((doc) => ({
        ...doc,
        source_url: sourceUrl,
        source_platform: normalizeVideoPlatform(sourceUrl),
        author,
        published_at: publishedAt,
        metadata: {
          ...(doc.metadata ?? {}),
          title,
          remote_video_id: detail.id,
          transcript_source: 'audio_fallback',
        },
      }));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function runYtDlp(args: string[], options: { encoding?: BufferEncoding; timeout?: number; maxBuffer?: number }): string {
  const home = process.env.HOME ?? '';
  const envBinary = process.env.NEEKO_YTDLP_BIN?.trim();
  const candidates: Array<{ command: string; prefix?: string[] }> = [
    ...(envBinary ? [{ command: envBinary }] : []),
    ...(home ? [{ command: join(home, 'bin', 'yt-dlp') }] : []),
    ...(home ? [{ command: join(home, 'Library', 'Python', '3.9', 'bin', 'yt-dlp') }] : []),
    ...(home ? [{ command: join(home, '.local', 'bin', 'yt-dlp') }] : []),
    { command: '/opt/homebrew/bin/yt-dlp' },
    { command: '/usr/local/bin/yt-dlp' },
    { command: 'yt-dlp' },
    { command: 'python3.13', prefix: ['-m', 'yt_dlp'] },
    { command: 'python3.12', prefix: ['-m', 'yt_dlp'] },
    { command: 'python3.11', prefix: ['-m', 'yt_dlp'] },
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return execFileSync(candidate.command, [...(candidate.prefix ?? []), ...args], options) as string;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No usable yt-dlp runtime was found.');
}

function parseUploadTime(entry: VideoJson): number | undefined {
  if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) {
    return entry.timestamp * 1000;
  }
  if (entry.upload_date && /^\d{8}$/.test(entry.upload_date)) {
    const iso = `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}T00:00:00.000Z`;
    const value = Date.parse(iso);
    return Number.isNaN(value) ? undefined : value;
  }
  return undefined;
}

function parsePublishedAt(entry: VideoJson): string | undefined {
  const uploadTime = parseUploadTime(entry);
  return uploadTime ? new Date(uploadTime).toISOString() : undefined;
}

function normalizeVideoPlatform(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('bilibili')) return 'bilibili';
    return host.replace(/^www\./, '');
  } catch {
    return 'video_remote';
  }
}

function chooseSubtitleTrack(map?: SubtitleMap): SubtitleTrack | null {
  if (!map) return null;
  for (const language of SUBTITLE_LANG_PRIORITY) {
    const tracks = map[language];
    const chosen = chooseSubtitleTrackFromList(tracks);
    if (chosen) return chosen;
  }
  for (const tracks of Object.values(map)) {
    const chosen = chooseSubtitleTrackFromList(tracks);
    if (chosen) return chosen;
  }
  return null;
}

function chooseSubtitleTrackFromList(tracks?: SubtitleTrack[]): SubtitleTrack | null {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  for (const ext of SUBTITLE_EXT_PRIORITY) {
    const track = tracks.find((item) => item.ext === ext && item.url);
    if (track) return track;
  }
  return tracks.find((item) => item.url) ?? null;
}

async function fetchSubtitleSegments(track: SubtitleTrack): Promise<TranscriptSegment[]> {
  const response = await fetch(track.url);
  if (!response.ok) return [];
  const raw = await response.text();
  const ext = String(track.ext ?? '').toLowerCase();
  if (ext === 'json3' || ext === 'srv3') {
    return parseJson3Transcript(raw);
  }
  return parseVttTranscript(raw);
}

function parseJson3Transcript(raw: string): TranscriptSegment[] {
  const parsed = JSON.parse(raw) as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };
  return (parsed.events ?? [])
    .map((event, index) => ({
      id: index,
      startMs: event.tStartMs,
      endMs: typeof event.tStartMs === 'number' && typeof event.dDurationMs === 'number'
        ? event.tStartMs + event.dDurationMs
        : undefined,
      text: (event.segs ?? []).map((segment) => segment.utf8 ?? '').join('').replace(/\n+/g, ' ').trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

function parseVttTranscript(raw: string): TranscriptSegment[] {
  const lines = raw.replace(/\r/g, '').split('\n');
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current?.text) {
        current.text = current.text.trim();
        segments.push(current);
      }
      current = null;
      continue;
    }
    if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE') || /^\d+$/.test(trimmed)) {
      continue;
    }
    if (trimmed.includes('-->')) {
      const [start, end] = trimmed.split('-->').map((value) => value.trim());
      current = {
        startMs: parseVttTime(start),
        endMs: parseVttTime(end.split(' ')[0]),
        text: '',
      };
      continue;
    }
    if (current) {
      current.text = `${current.text} ${trimmed.replace(/<[^>]+>/g, ' ')}`.trim();
    }
  }

  if (current?.text) {
    segments.push(current);
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function parseVttTime(value: string): number | undefined {
  const normalized = value.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const [hours, minutes, seconds] = parts.length === 3
    ? parts
    : ['0', parts[0], parts[1]];
  const total = (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds);
  return Number.isFinite(total) ? Math.round(total * 1000) : undefined;
}

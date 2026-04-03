import { createReadStream, existsSync } from 'fs';
import { BaseSourceAdapter } from './base.js';
import { RawDocument } from '../../models/memory.js';
import OpenAI from 'openai';

/**
 * Video/Audio adapter — transcribes using OpenAI Whisper API.
 * Keeps CLI lightweight — no local model download required.
 */
export class VideoAdapter extends BaseSourceAdapter {
  readonly sourceType = 'video' as const;

  private openai: OpenAI;

  constructor(apiKey?: string) {
    super();
    this.openai = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async fetch(filePath: string): Promise<RawDocument[]> {
    if (!existsSync(filePath)) {
      throw new Error(`VideoAdapter: file not found: "${filePath}"`);
    }

    const stream = createReadStream(filePath) as unknown as File;
    const filename = filePath.split('/').pop() ?? 'audio';

    const transcription = await this.openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: new File([stream as unknown as Uint8Array], filename),
      response_format: 'verbose_json',
    });

    const payload = transcription as {
      text?: string;
      duration?: number;
      language?: string;
      segments?: Array<{ id?: number; start?: number; end?: number; text?: string }>;
    };
    const text = typeof transcription === 'string'
      ? transcription
      : payload.text ?? '';

    const segments = Array.isArray(payload.segments) ? payload.segments : [];
    if (segments.length > 0) {
      return segments
        .filter((segment) => String(segment.text ?? '').trim().length > 0)
        .map((segment) =>
          this.makeDoc({
            source_type: 'video',
            source_url: filePath,
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
}

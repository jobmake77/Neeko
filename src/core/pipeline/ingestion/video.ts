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

    const text = typeof transcription === 'string'
      ? transcription
      : (transcription as { text: string }).text;

    return [
      this.makeDoc({
        source_type: 'video',
        source_url: filePath,
        content: text,
        author: 'unknown',
        metadata: {
          filename,
          duration: (transcription as { duration?: number }).duration,
          language: (transcription as { language?: string }).language,
        },
      }),
    ];
  }
}

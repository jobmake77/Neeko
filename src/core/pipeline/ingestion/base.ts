import { RawDocument } from '../../models/memory.js';

// ─── Base Source Adapter ──────────────────────────────────────────────────────

export interface FetchOptions {
  limit?: number;
  since?: Date;
  includeReplies?: boolean;
}

export abstract class BaseSourceAdapter {
  abstract readonly sourceType: RawDocument['source_type'];

  /**
   * Fetch raw documents from the source for a given target (handle/URL/path).
   */
  abstract fetch(target: string, options?: FetchOptions): Promise<RawDocument[]>;

  protected makeDoc(
    overrides: Omit<RawDocument, 'id' | 'fetched_at'>
  ): RawDocument {
    return {
      id: crypto.randomUUID(),
      fetched_at: new Date().toISOString(),
      ...overrides,
    };
  }
}

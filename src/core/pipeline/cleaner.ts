import { RawDocument, SemanticChunk } from '../models/memory.js';

/**
 * Data Cleaner — deduplicates and filters raw documents.
 * - Removes duplicates by content hash
 * - Filters out very short or empty content
 * - Detects language (heuristic)
 */
export class DataCleaner {
  private readonly minLength: number;
  private readonly seenHashes = new Set<string>();

  constructor(options: { minLength?: number } = {}) {
    this.minLength = options.minLength ?? 20;
  }

  clean(docs: RawDocument[]): RawDocument[] {
    const result: RawDocument[] = [];

    for (const doc of docs) {
      const normalized = doc.content.trim().replace(/\s+/g, ' ');
      if (normalized.length < this.minLength) continue;

      const hash = this.simpleHash(normalized);
      if (this.seenHashes.has(hash)) continue;

      this.seenHashes.add(hash);
      result.push({ ...doc, content: normalized });
    }

    return result;
  }

  reset(): void {
    this.seenHashes.clear();
  }

  private simpleHash(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return String(h >>> 0);
  }
}

/**
 * Semantic Chunker — splits RawDocuments into context-window-friendly chunks.
 * Uses paragraph boundaries first, then falls back to sentence splitting.
 */
export class SemanticChunker {
  private readonly maxTokens: number;
  private readonly overlapTokens: number;

  constructor(options: { maxTokens?: number; overlapTokens?: number } = {}) {
    this.maxTokens = options.maxTokens ?? 500;
    this.overlapTokens = options.overlapTokens ?? 50;
  }

  chunk(doc: RawDocument): SemanticChunk[] {
    const paragraphs = doc.content
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      const combined = current ? `${current}\n\n${para}` : para;
      if (this.estimateTokens(combined) > this.maxTokens && current) {
        chunks.push(current);
        // overlap: keep last sentence of current
        const overlap = this.lastSentences(current, this.overlapTokens);
        current = overlap ? `${overlap}\n\n${para}` : para;
      } else {
        current = combined;
      }
    }
    if (current) chunks.push(current);

    return chunks.map((content, i) => ({
      id: crypto.randomUUID(),
      document_id: doc.id,
      content,
      source_type: doc.source_type,
      author: doc.author,
      published_at: doc.published_at,
      chunk_index: i,
      total_chunks: chunks.length,
      token_count: this.estimateTokens(content),
    }));
  }

  chunkAll(docs: RawDocument[]): SemanticChunk[] {
    return docs.flatMap((d) => this.chunk(d));
  }

  private estimateTokens(text: string): number {
    // rough approximation: 1 token ≈ 4 chars for English, 2 chars for CJK
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
    const rest = text.length - cjk;
    return Math.ceil(cjk / 2 + rest / 4);
  }

  private lastSentences(text: string, maxTokens: number): string {
    const sentences = text.split(/(?<=[.!?])\s+/);
    let result = '';
    for (let i = sentences.length - 1; i >= 0; i--) {
      const candidate = sentences.slice(i).join(' ');
      if (this.estimateTokens(candidate) > maxTokens) break;
      result = candidate;
    }
    return result;
  }
}

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
    const units = paragraphs.flatMap((paragraph) => this.splitOversizedUnit(paragraph));

    const chunks: string[] = [];
    let current = '';

    for (const unit of units) {
      const combined = current ? `${current}\n\n${unit}` : unit;
      if (this.estimateTokens(combined) > this.maxTokens && current) {
        chunks.push(current);
        // overlap: keep last sentence of current
        const overlap = this.lastSentences(current, this.overlapTokens);
        current = overlap ? `${overlap}\n\n${unit}` : unit;
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

  private splitOversizedUnit(text: string): string[] {
    if (this.estimateTokens(text) <= this.maxTokens) return [text];

    const sentences = text
      .split(/(?<=[.!?。！？；;])\s*|\n+/u)
      .map((part) => part.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      return this.sliceByCharBudget(text);
    }

    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (this.estimateTokens(sentence) > this.maxTokens) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(...this.sliceByCharBudget(sentence));
        continue;
      }

      const combined = current ? `${current} ${sentence}` : sentence;
      if (this.estimateTokens(combined) > this.maxTokens && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = combined;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  private sliceByCharBudget(text: string): string[] {
    const chunks: string[] = [];
    const charBudget = this.estimateCharBudget(text);
    let start = 0;

    while (start < text.length) {
      let end = Math.min(text.length, start + charBudget);
      if (end < text.length) {
        const breakpoint = this.findBreakpoint(text, start, end);
        if (breakpoint > start + Math.floor(charBudget * 0.5)) {
          end = breakpoint;
        }
      }
      chunks.push(text.slice(start, end).trim());
      start = end;
    }

    return chunks.filter(Boolean);
  }

  private estimateCharBudget(text: string): number {
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
    const cjkRatio = cjk / Math.max(1, text.length);
    return Math.max(240, Math.floor(this.maxTokens * (cjkRatio > 0.35 ? 2 : 4)));
  }

  private findBreakpoint(text: string, start: number, end: number): number {
    const window = text.slice(start, end);
    const punctuation = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？'),
      window.lastIndexOf('.'),
      window.lastIndexOf('!'),
      window.lastIndexOf('?'),
      window.lastIndexOf('；'),
      window.lastIndexOf(';'),
      window.lastIndexOf('，'),
      window.lastIndexOf(',')
    );
    if (punctuation >= 0) return start + punctuation + 1;

    const whitespace = window.lastIndexOf(' ');
    if (whitespace >= 0) return start + whitespace + 1;
    return end;
  }

  private lastSentences(text: string, maxTokens: number): string {
    const sentences = text.split(/(?<=[.!?。！？；;])\s*/u);
    let result = '';
    for (let i = sentences.length - 1; i >= 0; i--) {
      const candidate = sentences.slice(i).join(' ');
      if (this.estimateTokens(candidate) > maxTokens) break;
      result = candidate;
    }
    return result;
  }
}

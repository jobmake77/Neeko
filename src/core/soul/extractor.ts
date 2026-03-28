import { generateObject } from 'ai';
import { z } from 'zod';
import { SemanticChunk } from '../models/memory.js';
import { Soul, ConfidentItem } from '../models/soul.js';
import { resolveModel } from '../../config/model.js';

// ─── Extraction result per chunk ─────────────────────────────────────────────

const ChunkExtractionSchema = z.object({
  language_style: z.object({
    vocabulary_preferences: z.array(z.object({ value: z.string(), confidence: z.number() })).optional(),
    sentence_patterns: z.array(z.object({ value: z.string(), confidence: z.number() })).optional(),
    formality_level: z.number().min(0).max(1).optional(),
    frequent_phrases: z.array(z.string()).optional(),
    languages_detected: z.array(z.string()).optional(),
  }),
  values: z.object({
    core_beliefs: z.array(z.object({
      belief: z.string(),
      confidence: z.number(),
      stance: z.enum(['strong', 'moderate', 'nuanced']),
    })).optional(),
  }),
  thinking_patterns: z.object({
    reasoning_observations: z.array(z.object({ value: z.string(), confidence: z.number() })).optional(),
    decision_frameworks: z.array(z.object({ value: z.string(), confidence: z.number() })).optional(),
    cognitive_biases: z.array(z.object({ value: z.string(), confidence: z.number() })).optional(),
  }),
  behavioral_traits: z.object({
    social_patterns: z.array(z.object({ value: z.string(), confidence: z.number() })).optional(),
    signature_behaviors: z.array(z.string()).optional(),
    humor_observed: z.enum(['none', 'dry', 'self-deprecating', 'witty', 'sarcastic', 'absurdist']).optional(),
  }),
  knowledge_domains: z.object({
    expert_domains: z.array(z.string()).optional(),
    familiar_domains: z.array(z.string()).optional(),
  }),
});

type ChunkExtraction = z.infer<typeof ChunkExtractionSchema>;

const EMPTY_EXTRACTION: ChunkExtraction = {
  language_style: {},
  values: {},
  thinking_patterns: {},
  behavioral_traits: {},
  knowledge_domains: {},
};

// ─── Soul Extractor ──────────────────────────────────────────────────────────

export class SoulExtractor {
  private async withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        task,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async extractFromChunk(
    chunk: SemanticChunk,
    targetName: string,
    options?: { timeoutMs?: number; retries?: number }
  ): Promise<ChunkExtraction> {
    const timeoutMs = options?.timeoutMs ?? 45_000;
    const retries = Math.max(0, options?.retries ?? 1);
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { object } = await this.withTimeout(
          generateObject({
            model: resolveModel(),
            schema: ChunkExtractionSchema,
            prompt: `You are analyzing a piece of content written by or attributed to "${targetName}".
Extract structured personality/soul information from this content.
Only extract what is clearly evidenced — do NOT hallucinate traits.
Assign confidence scores (0-1) based on how clearly the evidence supports each observation.

Content:
"""
${chunk.content}
"""

Source type: ${chunk.source_type}
Author: ${chunk.author}`,
          }),
          timeoutMs,
          'soul extraction'
        );

        return object;
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async extractBatch(
    chunks: SemanticChunk[],
    targetName: string,
    concurrency = 5,
    options?: { timeoutMs?: number; retries?: number }
  ): Promise<ChunkExtraction[]> {
    const results: ChunkExtraction[] = [];

    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (c) => {
          try {
            return await this.extractFromChunk(c, targetName, options);
          } catch (error) {
            console.warn(`[SoulExtractor] chunk extraction failed: ${String(error)}`);
            return EMPTY_EXTRACTION;
          }
        })
      );
      results.push(...batchResults);
    }

    return results;
  }
}

// ─── Soul Aggregator ─────────────────────────────────────────────────────────

export class SoulAggregator {
  aggregate(
    soul: Soul,
    extractions: ChunkExtraction[],
    sourceChunks: SemanticChunk[]
  ): Soul {
    const updated = { ...soul, updated_at: new Date().toISOString() };

    // ── Language Style ──────────────────────────────────────────────────────
    const vocabMap = new Map<string, { total_confidence: number; count: number; quotes: string[] }>();
    const phraseSet = new Set<string>();
    const langSet = new Set<string>(updated.language_style.languages_used);
    let formalitySum = 0;
    let formalityCount = 0;

    for (let idx = 0; idx < extractions.length; idx++) {
      const ex = extractions[idx];
      const chunk = sourceChunks[idx];

      if (ex.language_style.vocabulary_preferences) {
        for (const v of ex.language_style.vocabulary_preferences) {
          const entry = vocabMap.get(v.value) ?? { total_confidence: 0, count: 0, quotes: [] };
          entry.total_confidence += v.confidence;
          entry.count++;
          entry.quotes.push(chunk.content.slice(0, 100));
          vocabMap.set(v.value, entry);
        }
      }
      if (ex.language_style.frequent_phrases) {
        for (const p of ex.language_style.frequent_phrases) phraseSet.add(p);
      }
      if (ex.language_style.languages_detected) {
        for (const l of ex.language_style.languages_detected) langSet.add(l);
      }
      if (ex.language_style.formality_level !== undefined) {
        formalitySum += ex.language_style.formality_level;
        formalityCount++;
      }
    }

    updated.language_style.vocabulary_preferences = Array.from(vocabMap.entries())
      .map(([value, d]) => ({
        value,
        confidence: d.total_confidence / d.count,
        evidence_count: d.count,
        evidence_quotes: d.quotes.slice(0, 3),
      }))
      .filter((v) => v.confidence >= 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);

    updated.language_style.frequent_phrases = Array.from(phraseSet).slice(0, 30);
    updated.language_style.languages_used = Array.from(langSet);
    if (formalityCount > 0) {
      updated.language_style.formality_level = formalitySum / formalityCount;
    }

    // ── Values ──────────────────────────────────────────────────────────────
    const beliefMap = new Map<string, { confidence: number; count: number; stance: string }>();
    for (const ex of extractions) {
      if (ex.values.core_beliefs) {
        for (const b of ex.values.core_beliefs) {
          const existing = beliefMap.get(b.belief);
          if (existing) {
            existing.confidence = (existing.confidence + b.confidence) / 2;
            existing.count++;
          } else {
            beliefMap.set(b.belief, { confidence: b.confidence, count: 1, stance: b.stance });
          }
        }
      }
    }
    updated.values.core_beliefs = Array.from(beliefMap.entries())
      .filter(([, v]) => v.confidence >= 0.4)
      .map(([belief, v]) => ({
        belief,
        priority: 5,
        confidence: v.confidence,
        evidence_count: v.count,
        stance: v.stance as 'strong' | 'moderate' | 'nuanced',
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 15);

    // ── Thinking Patterns ────────────────────────────────────────────────────
    const reasoningItems = this.mergeConfidentItems(
      extractions.flatMap((e) => e.thinking_patterns.reasoning_observations ?? [])
    );
    updated.thinking_patterns.reasoning_style = reasoningItems.slice(0, 10);

    const frameworkItems = this.mergeConfidentItems(
      extractions.flatMap((e) => e.thinking_patterns.decision_frameworks ?? [])
    );
    updated.thinking_patterns.decision_frameworks = frameworkItems.slice(0, 10);

    const biasItems = this.mergeConfidentItems(
      extractions.flatMap((e) => e.thinking_patterns.cognitive_biases ?? [])
    );
    updated.thinking_patterns.cognitive_biases = biasItems.slice(0, 10);

    // ── Behavioral Traits ────────────────────────────────────────────────────
    const socialItems = this.mergeConfidentItems(
      extractions.flatMap((e) => e.behavioral_traits.social_patterns ?? [])
    );
    updated.behavioral_traits.social_patterns = socialItems.slice(0, 10);

    const sigBehaviors = [
      ...new Set(extractions.flatMap((e) => e.behavioral_traits.signature_behaviors ?? [])),
    ];
    updated.behavioral_traits.signature_behaviors = sigBehaviors.slice(0, 15);

    // Humor: take the most common non-"none" value
    const humorVotes = new Map<string, number>();
    for (const ex of extractions) {
      if (ex.behavioral_traits.humor_observed) {
        humorVotes.set(
          ex.behavioral_traits.humor_observed,
          (humorVotes.get(ex.behavioral_traits.humor_observed) ?? 0) + 1
        );
      }
    }
    if (humorVotes.size > 0) {
      const topHumor = Array.from(humorVotes.entries()).sort((a, b) => b[1] - a[1])[0][0];
      updated.behavioral_traits.humor_style = topHumor as Soul['behavioral_traits']['humor_style'];
    }

    // ── Knowledge Domains ────────────────────────────────────────────────────
    const expertSet = new Set<string>(updated.knowledge_domains.expert);
    const familiarSet = new Set<string>(updated.knowledge_domains.familiar);
    for (const ex of extractions) {
      for (const d of ex.knowledge_domains.expert_domains ?? []) expertSet.add(d);
      for (const d of ex.knowledge_domains.familiar_domains ?? []) familiarSet.add(d);
    }
    updated.knowledge_domains.expert = Array.from(expertSet);
    updated.knowledge_domains.familiar = Array.from(familiarSet).filter(
      (d) => !expertSet.has(d)
    );

    // ── Overall Confidence ───────────────────────────────────────────────────
    updated.total_chunks_processed += sourceChunks.length;
    updated.overall_confidence = this.computeOverallConfidence(updated);
    updated.version++;

    return updated;
  }

  private mergeConfidentItems(
    items: Array<{ value: string; confidence: number }>
  ): ConfidentItem[] {
    const map = new Map<string, { total: number; count: number }>();
    for (const item of items) {
      const entry = map.get(item.value) ?? { total: 0, count: 0 };
      entry.total += item.confidence;
      entry.count++;
      map.set(item.value, entry);
    }
    return Array.from(map.entries())
      .map(([value, d]) => ({
        value,
        confidence: d.total / d.count,
        evidence_count: d.count,
      }))
      .filter((v) => v.confidence >= 0.3)
      .sort((a, b) => b.confidence - a.confidence);
  }

  private computeOverallConfidence(soul: Soul): number {
    const scores = [
      soul.language_style.vocabulary_preferences.length > 5 ? 0.8 : 0.4,
      soul.values.core_beliefs.length > 3 ? 0.8 : 0.3,
      soul.thinking_patterns.reasoning_style.length > 2 ? 0.7 : 0.3,
      soul.behavioral_traits.signature_behaviors.length > 2 ? 0.7 : 0.3,
      soul.knowledge_domains.expert.length > 0 ? 0.8 : 0.3,
    ];
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }
}

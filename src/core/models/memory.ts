import { z } from 'zod';

// ─── Raw Document (output of any Source Adapter) ─────────────────────────────

export const RawDocumentSchema = z.object({
  id: z.string().uuid(),
  source_type: z.enum(['twitter', 'wechat', 'feishu', 'article', 'video', 'custom']),
  source_url: z.string().optional(),
  source_platform: z.string().optional(),
  content: z.string(),
  author: z.string(),
  author_handle: z.string().optional(),
  published_at: z.string().datetime().optional(),
  fetched_at: z.string().datetime(),
  language: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type RawDocument = z.infer<typeof RawDocumentSchema>;

// ─── Semantic Chunk ──────────────────────────────────────────────────────────

export const SemanticChunkSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  source_type: RawDocumentSchema.shape.source_type,
  author: z.string(),
  published_at: z.string().datetime().optional(),
  chunk_index: z.number().int().min(0),
  total_chunks: z.number().int().min(1),
  token_count: z.number().int().min(0),
});
export type SemanticChunk = z.infer<typeof SemanticChunkSchema>;

// ─── Memory Node ─────────────────────────────────────────────────────────────

export const MemoryRelationSchema = z.object({
  target_id: z.string().uuid(),
  relation_type: z.enum(['SUPPORTS', 'CONTRADICTS', 'TEMPORAL_FOLLOWS', 'ELABORATES', 'OPPOSES']),
  weight: z.number().min(0).max(1).default(1),
});
export type MemoryRelation = z.infer<typeof MemoryRelationSchema>;

export const MemoryNodeSchema = z.object({
  id: z.string().uuid(),
  persona_id: z.string().uuid(),

  // content
  original_text: z.string(),
  summary: z.string(),
  category: z.enum([
    'belief',
    'value',
    'fact',
    'opinion',
    'behavior',
    'knowledge',
    'preference',
    'experience',
  ]),
  soul_dimension: z.enum([
    'language_style',
    'values',
    'thinking_patterns',
    'behavioral_traits',
    'knowledge_domains',
    'general',
  ]),

  // provenance
  source_chunk_id: z.string().uuid(),
  source_type: RawDocumentSchema.shape.source_type,
  source_url: z.string().optional(),
  time_reference: z.string().datetime().optional(),

  // quality
  confidence: z.number().min(0).max(1),
  reinforcement_count: z.number().int().min(0).default(0),
  semantic_tags: z.array(z.string()),

  // temporal status
  status: z.enum(['active', 'archived']).default('active'),
  superseded_by: z.string().uuid().optional(),

  // relations
  relations: z.array(MemoryRelationSchema).default([]),

  // embedding stored separately in Qdrant
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type MemoryNode = z.infer<typeof MemoryNodeSchema>;

export const MemoryProvenanceStatusSchema = z.enum(['verified', 'supported', 'weak', 'blocked']);
export type MemoryProvenanceStatus = z.infer<typeof MemoryProvenanceStatusSchema>;

export const MemoryProvenanceCueSchema = z.object({
  kind: z.enum(['entity', 'relation', 'context', 'identity_arc', 'signal', 'source']),
  value: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type MemoryProvenanceCue = z.infer<typeof MemoryProvenanceCueSchema>;

export const MemoryProvenanceAssessmentSchema = z.object({
  status: MemoryProvenanceStatusSchema,
  score: z.number().min(0).max(1),
  matched_cues: z.array(MemoryProvenanceCueSchema).default([]),
  missing_signals: z.array(z.string()).default([]),
  reasons: z.array(z.string()).default([]),
});
export type MemoryProvenanceAssessment = z.infer<typeof MemoryProvenanceAssessmentSchema>;

export function createMemoryNode(
  partial: Omit<MemoryNode, 'id' | 'created_at' | 'updated_at' | 'reinforcement_count' | 'status' | 'relations'>
): MemoryNode {
  const now = new Date().toISOString();
  return {
    ...partial,
    id: crypto.randomUUID(),
    reinforcement_count: 0,
    status: 'active',
    relations: [],
    created_at: now,
    updated_at: now,
  };
}

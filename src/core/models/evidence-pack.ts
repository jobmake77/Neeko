import { z } from 'zod';
import { RawDocumentSchema } from './memory.js';

export const EvidencePackSceneProfileSchema = z.enum([
  'public',
  'work',
  'private',
  'intimate',
  'conflict',
  'casual',
  'mixed',
  'unknown',
]);
export type EvidencePackSceneProfile = z.infer<typeof EvidencePackSceneProfileSchema>;

export const EvidencePackSpeakerRoleSchema = z.enum([
  'target',
  'self',
  'other',
  'unknown',
  'mixed',
]);
export type EvidencePackSpeakerRole = z.infer<typeof EvidencePackSpeakerRoleSchema>;

export const EvidencePackModalitySchema = z.enum(['text', 'chat', 'transcript', 'mixed']);
export type EvidencePackModality = z.infer<typeof EvidencePackModalitySchema>;

export const EvidencePackTimeWindowSchema = z.object({
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  days_span: z.number().int().min(0).optional(),
});
export type EvidencePackTimeWindow = z.infer<typeof EvidencePackTimeWindowSchema>;

export const EvidencePackStatsSchema = z.object({
  item_count: z.number().int().min(0),
  raw_doc_count: z.number().int().min(0),
  total_chars: z.number().int().min(0),
  estimated_tokens: z.number().int().min(0),
  avg_item_chars: z.number().min(0),
  target_ratio: z.number().min(0).max(1),
  cross_session_stable_ratio: z.number().min(0).max(1),
});
export type EvidencePackStats = z.infer<typeof EvidencePackStatsSchema>;

export const EvidencePackScoresSchema = z.object({
  quality: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  risk: z.number().min(0).max(1),
  target_relevance: z.number().min(0).max(1),
  duplication_pressure: z.number().min(0).max(1),
  value: z.number().min(0).max(1),
});
export type EvidencePackScores = z.infer<typeof EvidencePackScoresSchema>;

export const EvidencePackRoutingProjectionSchema = z.object({
  soul_candidate_items: z.number().int().min(0),
  memory_candidate_items: z.number().int().min(0),
  discard_candidate_items: z.number().int().min(0),
});
export type EvidencePackRoutingProjection = z.infer<typeof EvidencePackRoutingProjectionSchema>;

export const EvidencePackSchema = z.object({
  id: z.string().uuid(),
  persona_slug: z.string().optional(),
  source_type: RawDocumentSchema.shape.source_type,
  modality: EvidencePackModalitySchema,
  scene_profile: EvidencePackSceneProfileSchema,
  time_window: EvidencePackTimeWindowSchema,
  item_ids: z.array(z.string().uuid()),
  raw_document_ids: z.array(z.string().uuid()),
  conversation_ids: z.array(z.string()),
  session_ids: z.array(z.string()),
  primary_speaker_role: EvidencePackSpeakerRoleSchema,
  topic_signature: z.array(z.string()),
  stats: EvidencePackStatsSchema,
  scores: EvidencePackScoresSchema,
  routing_projection: EvidencePackRoutingProjectionSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type EvidencePack = z.infer<typeof EvidencePackSchema>;

export const PackBuildStatsSchema = z.object({
  raw_item_count: z.number().int().min(0),
  produced_pack_count: z.number().int().min(0),
  avg_items_per_pack: z.number().min(0),
  avg_tokens_per_pack: z.number().min(0),
  mixed_source_pack_count: z.number().int().min(0),
  high_risk_pack_count: z.number().int().min(0),
  high_duplication_pack_count: z.number().int().min(0),
  target_dominant_pack_count: z.number().int().min(0),
});
export type PackBuildStats = z.infer<typeof PackBuildStatsSchema>;

export const DynamicScalingMetricsSchema = z.object({
  stable_topic_growth: z.number().min(0).max(1),
  marginal_coverage_gain: z.number().min(0).max(1),
  duplication_pressure: z.number().min(0).max(1),
  conflict_pressure: z.number().min(0).max(1),
  runtime_pressure: z.number().min(0).max(1),
  seed_maturity: z.number().min(0).max(1),
});
export type DynamicScalingMetrics = z.infer<typeof DynamicScalingMetricsSchema>;

export const EvidencePackBuildResultSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime(),
  persona_slug: z.string().optional(),
  packs: z.array(EvidencePackSchema),
  stats: PackBuildStatsSchema,
  metrics: DynamicScalingMetricsSchema,
  config: z.object({
    bucket_days: z.number().int().min(1),
    target_tokens_per_pack: z.number().int().min(1),
    max_tokens_per_pack: z.number().int().min(1),
  }),
});
export type EvidencePackBuildResult = z.infer<typeof EvidencePackBuildResultSchema>;

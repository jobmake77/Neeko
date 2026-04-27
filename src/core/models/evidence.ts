import { z } from 'zod';
import { RawDocumentSchema } from './memory.js';

export const EvidenceSpeakerRoleSchema = z.enum(['target', 'self', 'other', 'unknown']);
export type EvidenceSpeakerRole = z.infer<typeof EvidenceSpeakerRoleSchema>;

export const EvidenceSceneSchema = z.enum(['public', 'work', 'private', 'intimate', 'conflict', 'casual', 'unknown']);
export type EvidenceScene = z.infer<typeof EvidenceSceneSchema>;

export const EvidenceModalitySchema = z.enum(['text', 'chat', 'transcript']);
export type EvidenceModality = z.infer<typeof EvidenceModalitySchema>;

export const EvidenceWindowRoleSchema = z.enum(['target_centered', 'context_only', 'standalone']);
export type EvidenceWindowRole = z.infer<typeof EvidenceWindowRoleSchema>;

export const EvidenceKindSchema = z.enum([
  'statement',
  'reply',
  'explanation',
  'preference',
  'decision',
  'behavior_signal',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const TargetManifestSchema = z.object({
  target_name: z.string().min(1),
  target_aliases: z.array(z.string()).default([]),
  self_aliases: z.array(z.string()).default([]),
  known_other_aliases: z.array(z.string()).default([]),
  default_scene: z.enum(['public', 'work', 'private']).optional(),
});
export type TargetManifest = z.infer<typeof TargetManifestSchema>;

export const EvidenceContextMessageSchema = z.object({
  speaker_name: z.string(),
  speaker_role: EvidenceSpeakerRoleSchema,
  content: z.string(),
  timestamp: z.string().datetime().optional(),
});
export type EvidenceContextMessage = z.infer<typeof EvidenceContextMessageSchema>;

export const EvidenceStabilityHintsSchema = z.object({
  repeated_count: z.number().int().min(0).default(0),
  repeated_in_sessions: z.number().int().min(0).default(0),
  cross_session_stable: z.boolean().default(false),
});
export type EvidenceStabilityHints = z.infer<typeof EvidenceStabilityHintsSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string().uuid(),
  raw_document_id: z.string().uuid(),
  source_type: RawDocumentSchema.shape.source_type,
  modality: EvidenceModalitySchema,
  content: z.string(),
  speaker_role: EvidenceSpeakerRoleSchema,
  speaker_name: z.string(),
  target_confidence: z.number().min(0).max(1),
  scene: EvidenceSceneSchema,
  conversation_id: z.string().optional(),
  session_id: z.string().optional(),
  window_role: EvidenceWindowRoleSchema,
  timestamp_start: z.string().datetime().optional(),
  timestamp_end: z.string().datetime().optional(),
  context_before: z.array(EvidenceContextMessageSchema).default([]),
  context_after: z.array(EvidenceContextMessageSchema).default([]),
  evidence_kind: EvidenceKindSchema,
  stability_hints: EvidenceStabilityHintsSchema.default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidenceStatsSchema = z.object({
  raw_messages: z.number().int().min(0).default(0),
  sessions: z.number().int().min(0).default(0),
  windows: z.number().int().min(0).default(0),
  target_windows: z.number().int().min(0).default(0),
  context_only_windows: z.number().int().min(0).default(0),
  downgraded_scene_items: z.number().int().min(0).default(0),
  blocked_scene_items: z.number().int().min(0).default(0),
  cross_session_stable_items: z.number().int().min(0).default(0),
  speaker_role_counts: z.record(z.string(), z.number().int().min(0)).default({}),
  scene_counts: z.record(z.string(), z.number().int().min(0)).default({}),
  modality_counts: z.record(z.string(), z.number().int().min(0)).default({}),
  source_type_counts: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type EvidenceStats = z.infer<typeof EvidenceStatsSchema>;

export const EvidenceBatchSchema = z.object({
  items: z.array(EvidenceItemSchema),
  stats: EvidenceStatsSchema,
  speaker_summary: z.record(z.string(), z.number().int().min(0)),
  scene_summary: z.record(z.string(), z.number().int().min(0)),
});
export type EvidenceBatch = z.infer<typeof EvidenceBatchSchema>;

export const EvidenceReferenceSchema = z.object({
  evidence_id: z.string().optional(),
  raw_document_id: z.string().uuid().optional(),
  source_url: z.string().optional(),
  speaker_name: z.string().optional(),
  speaker_role: EvidenceSpeakerRoleSchema.optional(),
  excerpt: z.string().optional(),
  timestamp_start: z.string().datetime().optional(),
  timestamp_end: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const PersonaWebEntityTypeSchema = z.enum([
  'person',
  'organization',
  'project',
  'product',
  'topic',
  'value',
  'community',
  'place',
  'artifact',
  'identity_facet',
  'unknown',
]);
export type PersonaWebEntityType = z.infer<typeof PersonaWebEntityTypeSchema>;

export const PersonaWebRelationTypeSchema = z.enum([
  'self_describes',
  'builds',
  'works_on',
  'uses',
  'prefers',
  'collaborates_with',
  'learns_from',
  'teaches',
  'cares_about',
  'avoids',
  'belongs_to',
  'influences',
  'associated_with',
]);
export type PersonaWebRelationType = z.infer<typeof PersonaWebRelationTypeSchema>;

export const PersonaWebRelationDirectionSchema = z.enum(['directed', 'undirected']);
export type PersonaWebRelationDirection = z.infer<typeof PersonaWebRelationDirectionSchema>;

export const PersonaWebRelationValenceSchema = z.enum(['positive', 'neutral', 'negative', 'mixed']);
export type PersonaWebRelationValence = z.infer<typeof PersonaWebRelationValenceSchema>;

export const PersonaIdentityFacetSchema = z.enum([
  'role',
  'value',
  'style',
  'focus',
  'relationship',
  'trajectory',
  'boundary',
  'preference',
]);
export type PersonaIdentityFacet = z.infer<typeof PersonaIdentityFacetSchema>;

export const PersonaIdentityTrajectorySchema = z.enum([
  'emerging',
  'steady',
  'evolving',
  'episodic',
  'historical',
]);
export type PersonaIdentityTrajectory = z.infer<typeof PersonaIdentityTrajectorySchema>;

export const PersonaWebEntitySchema = z.object({
  id: z.string(),
  canonical_name: z.string(),
  entity_type: PersonaWebEntityTypeSchema,
  aliases: z.array(z.string()).default([]),
  handles: z.array(z.string()).default([]),
  normalized_urls: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  first_seen_at: z.string().datetime().optional(),
  last_seen_at: z.string().datetime().optional(),
  evidence_refs: z.array(EvidenceReferenceSchema).default([]),
  background_summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type PersonaWebEntity = z.infer<typeof PersonaWebEntitySchema>;

export const PersonaWebContextFrameSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  scene: EvidenceSceneSchema,
  speaker_names: z.array(z.string()).default([]),
  participant_entity_ids: z.array(z.string()).default([]),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1),
  evidence_refs: z.array(EvidenceReferenceSchema).default([]),
});
export type PersonaWebContextFrame = z.infer<typeof PersonaWebContextFrameSchema>;

export const PersonaWebRelationSchema = z.object({
  id: z.string(),
  source_entity_id: z.string(),
  target_entity_id: z.string(),
  relation_type: PersonaWebRelationTypeSchema,
  semantic_type: z.enum([
    'founded',
    'built',
    'maintains',
    'works_on',
    'contributes_to',
    'member_of',
    'collaborates_with',
    'speaks_about',
    'recommends',
    'invests_in',
    'uses',
    'hosts',
    'appears_on',
    'writes_at',
    'owns_site',
    'associated_with',
  ]).default('associated_with'),
  direction: PersonaWebRelationDirectionSchema.default('directed'),
  valence: PersonaWebRelationValenceSchema.default('neutral'),
  confidence: z.number().min(0).max(1),
  ownership_signals: z.object({
    first_person_count: z.number().int().min(0).default(0),
    profile_claim_count: z.number().int().min(0).default(0),
    repeated_support_count: z.number().int().min(0).default(0),
    multi_source_count: z.number().int().min(0).default(0),
  }).default({}),
  context_frame_ids: z.array(z.string()).default([]),
  evidence_refs: z.array(EvidenceReferenceSchema).default([]),
  first_seen_at: z.string().datetime().optional(),
  last_seen_at: z.string().datetime().optional(),
  summary: z.string(),
});
export type PersonaWebRelation = z.infer<typeof PersonaWebRelationSchema>;

export const PersonaIdentityArcSchema = z.object({
  id: z.string(),
  facet: PersonaIdentityFacetSchema,
  label: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  trajectory: PersonaIdentityTrajectorySchema,
  related_entity_ids: z.array(z.string()).default([]),
  first_seen_at: z.string().datetime().optional(),
  last_seen_at: z.string().datetime().optional(),
  evidence_refs: z.array(EvidenceReferenceSchema).default([]),
});
export type PersonaIdentityArc = z.infer<typeof PersonaIdentityArcSchema>;

export const PersonaWebGraphSourceSchema = z.object({
  documents_path: z.string().optional(),
  evidence_index_path: z.string().optional(),
  prep_artifact_id: z.string().optional(),
  evidence_import_id: z.string().optional(),
});
export type PersonaWebGraphSource = z.infer<typeof PersonaWebGraphSourceSchema>;

export const PersonaWebGraphStatsSchema = z.object({
  document_count: z.number().int().min(0),
  evidence_count: z.number().int().min(0),
  entity_count: z.number().int().min(0),
  relation_count: z.number().int().min(0),
  context_count: z.number().int().min(0),
  identity_arc_count: z.number().int().min(0),
  high_confidence_entity_count: z.number().int().min(0),
  high_confidence_relation_count: z.number().int().min(0),
});
export type PersonaWebGraphStats = z.infer<typeof PersonaWebGraphStatsSchema>;

export const PersonaWebGraphSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime(),
  persona_slug: z.string().optional(),
  target_name: z.string().optional(),
  source: PersonaWebGraphSourceSchema.default({}),
  stats: PersonaWebGraphStatsSchema,
  entities: z.array(PersonaWebEntitySchema).default([]),
  relations: z.array(PersonaWebRelationSchema).default([]),
  context_frames: z.array(PersonaWebContextFrameSchema).default([]),
  identity_arcs: z.array(PersonaIdentityArcSchema).default([]),
});
export type PersonaWebGraph = z.infer<typeof PersonaWebGraphSchema>;

export const TrainingSeedV3StatsSchema = z.object({
  entity_count: z.number().int().min(0),
  relation_count: z.number().int().min(0),
  context_count: z.number().int().min(0),
  identity_arc_count: z.number().int().min(0),
  provenance_coverage_score: z.number().min(0).max(1),
  verified_relation_count: z.number().int().min(0),
  guarded_claim_count: z.number().int().min(0),
});
export type TrainingSeedV3Stats = z.infer<typeof TrainingSeedV3StatsSchema>;

export const TrainingSeedV3Schema = z.object({
  schema_version: z.literal(3),
  generated_at: z.string().datetime(),
  persona_slug: z.string().optional(),
  target_name: z.string().optional(),
  summary: z.string(),
  stats: TrainingSeedV3StatsSchema,
  dominant_domains: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  signals: z.array(z.string()).default([]),
  relationship_hints: z.array(z.string()).default([]),
  context_hints: z.array(z.string()).default([]),
  identity_hints: z.array(z.string()).default([]),
  entity_cards: z.array(z.object({
    id: z.string(),
    name: z.string(),
    entity_type: PersonaWebEntityTypeSchema,
    background_summary: z.string().optional(),
    aliases: z.array(z.string()).default([]),
  })).default([]),
  relation_summaries: z.array(z.object({
    id: z.string(),
    semantic_type: z.string(),
    summary: z.string(),
    confidence: z.number().min(0).max(1),
  })).default([]),
  high_confidence_claims: z.array(z.object({
    claim: z.string(),
    ownership: z.enum([
      'self_owned',
      'self_participated',
      'self_related',
      'self_mentioned',
      'third_party_background',
      'unknown',
    ]),
    confidence: z.number().min(0).max(1),
  })).default([]),
  provenance_guardrails: z.array(z.string()).default([]),
});
export type TrainingSeedV3 = z.infer<typeof TrainingSeedV3Schema>;

export const PersonaWebProvenanceReportSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime(),
  persona_slug: z.string().optional(),
  target_name: z.string().optional(),
  coverage_score: z.number().min(0).max(1),
  verified_entity_count: z.number().int().min(0),
  verified_relation_count: z.number().int().min(0),
  low_confidence_entity_count: z.number().int().min(0),
  low_confidence_relation_count: z.number().int().min(0),
  guardrail_notes: z.array(z.string()).default([]),
});
export type PersonaWebProvenanceReport = z.infer<typeof PersonaWebProvenanceReportSchema>;

export const PersonaWebIndexSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime(),
  persona_slug: z.string().optional(),
  target_name: z.string().optional(),
  entity_lookup: z.record(z.string(), z.array(z.string())).default({}),
  relation_lookup: z.record(z.string(), z.array(z.string())).default({}),
  domain_lookup: z.record(z.string(), z.array(z.string())).default({}),
  adjacency: z.record(z.string(), z.array(z.string())).default({}),
  canonical_aliases: z.record(z.string(), z.array(z.string())).default({}),
});
export type PersonaWebIndex = z.infer<typeof PersonaWebIndexSchema>;

export const PersonaWebEvidenceMapSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime(),
  persona_slug: z.string().optional(),
  target_name: z.string().optional(),
  entity_to_evidence: z.record(z.string(), z.array(z.string())).default({}),
  relation_to_evidence: z.record(z.string(), z.array(z.string())).default({}),
  context_to_evidence: z.record(z.string(), z.array(z.string())).default({}),
});
export type PersonaWebEvidenceMap = z.infer<typeof PersonaWebEvidenceMapSchema>;

export const PersonaWebCommunitySummarySchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime(),
  persona_slug: z.string().optional(),
  target_name: z.string().optional(),
  dominant_domains: z.array(z.string()).default([]),
  communities: z.array(z.object({
    id: z.string(),
    label: z.string(),
    entity_ids: z.array(z.string()).default([]),
    summary: z.string(),
  })).default([]),
});
export type PersonaWebCommunitySummary = z.infer<typeof PersonaWebCommunitySummarySchema>;

export const PersonaWebArtifactsSchema = z.object({
  entity_index_path: z.string(),
  relation_index_path: z.string(),
  context_index_path: z.string(),
  identity_arc_path: z.string(),
  graph_path: z.string(),
  training_seed_v3_path: z.string(),
  provenance_report_path: z.string(),
  network_index_path: z.string().optional(),
  evidence_map_path: z.string().optional(),
  community_summary_path: z.string().optional(),
});
export type PersonaWebArtifacts = z.infer<typeof PersonaWebArtifactsSchema>;

export interface ChatMessageEvent {
  id: string;
  sender: string;
  content: string;
  timestamp?: string;
  conversation_id?: string;
  metadata?: Record<string, unknown>;
  system_boundary?: boolean;
}

export interface EvidenceRoutingMetadata {
  speaker_role?: EvidenceSpeakerRole;
  speaker_name?: string;
  target_confidence?: number;
  scene?: EvidenceScene;
  modality?: EvidenceModality;
  window_role?: EvidenceWindowRole;
  evidence_kind?: EvidenceKind;
  conversation_id?: string;
  session_id?: string;
  timestamp_start?: string;
  timestamp_end?: string;
  context_before?: EvidenceContextMessage[];
  context_after?: EvidenceContextMessage[];
  stability_hints?: EvidenceStabilityHints;
}

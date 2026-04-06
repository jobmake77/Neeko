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

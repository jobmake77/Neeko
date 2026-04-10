import { z } from 'zod';
import { EvidenceItemSchema, EvidenceStatsSchema, TargetManifestSchema } from './evidence.js';

export const CitationItemSchema = z.object({
  id: z.string(),
  summary: z.string(),
  category: z.string().optional(),
  soul_dimension: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type CitationItem = z.infer<typeof CitationItemSchema>;

export const WorkbenchMemorySourceAssetSchema = z.object({
  kind: z.enum(['web_url', 'local_file', 'evidence_import', 'training_prep', 'promotion_handoff', 'synthetic']),
  title: z.string(),
  summary: z.string(),
  id: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  preview: z.string().optional(),
  badges: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type WorkbenchMemorySourceAsset = z.infer<typeof WorkbenchMemorySourceAssetSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  persona_slug: z.string(),
  title: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  status: z.enum(['active', 'idle', 'archived']).default('active'),
  message_count: z.number().int().min(0).default(0),
  last_message_preview: z.string().optional(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationMessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  created_at: z.string().datetime(),
  retrieved_memory_ids: z.array(z.string()).default([]),
  persona_dimensions: z.array(z.string()).default([]),
  citation_items: z.array(CitationItemSchema).default([]),
  writeback_candidate_ids: z.array(z.string()).default([]),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const MemoryCandidateSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  source_message_ids: z.array(z.string().uuid()).default([]),
  candidate_type: z.enum(['belief', 'value', 'behavior', 'knowledge', 'preference', 'general']),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['pending', 'accepted', 'rejected']).default('pending'),
  promotion_state: z.enum(['idle', 'ready']).default('idle'),
  created_at: z.string().datetime(),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export const PromotionHandoffItemSchema = z.object({
  candidate_id: z.string().uuid(),
  candidate_type: z.enum(['belief', 'value', 'behavior', 'knowledge', 'preference', 'general']),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  source_message_ids: z.array(z.string().uuid()).default([]),
  created_at: z.string().datetime(),
});
export type PromotionHandoffItem = z.infer<typeof PromotionHandoffItemSchema>;

export const PromotionHandoffSchema = z.object({
  id: z.string().uuid(),
  persona_slug: z.string(),
  conversation_id: z.string().uuid(),
  candidate_ids: z.array(z.string().uuid()).default([]),
  status: z.enum(['drafted', 'queued', 'archived']).default('drafted'),
  summary: z.string(),
  session_summary: z.string().optional(),
  items: z.array(PromotionHandoffItemSchema).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PromotionHandoff = z.infer<typeof PromotionHandoffSchema>;

export const WorkbenchEvidenceImportArtifactsSchema = z.object({
  evidence_index_path: z.string(),
  evidence_stats_path: z.string(),
  speaker_summary_path: z.string(),
  scene_summary_path: z.string(),
  target_manifest_path: z.string().optional(),
  documents_path: z.string(),
});
export type WorkbenchEvidenceImportArtifacts = z.infer<typeof WorkbenchEvidenceImportArtifactsSchema>;

export const WorkbenchEvidenceImportSchema = z.object({
  id: z.string().uuid(),
  persona_slug: z.string(),
  conversation_id: z.string().uuid().optional(),
  source_kind: z.enum(['chat', 'video']),
  source_platform: z.string().optional(),
  source_path: z.string(),
  target_manifest_path: z.string(),
  status: z.enum(['completed', 'failed']).default('completed'),
  item_count: z.number().int().min(0),
  summary: z.string(),
  stats: EvidenceStatsSchema,
  artifacts: WorkbenchEvidenceImportArtifactsSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type WorkbenchEvidenceImport = z.infer<typeof WorkbenchEvidenceImportSchema>;

export const WorkbenchEvidenceImportDetailSchema = z.object({
  import: WorkbenchEvidenceImportSchema,
  manifest: TargetManifestSchema.nullable(),
  sample_items: z.array(EvidenceItemSchema).default([]),
});
export type WorkbenchEvidenceImportDetail = z.infer<typeof WorkbenchEvidenceImportDetailSchema>;

export const TrainingPrepArtifactSchema = z.object({
  id: z.string().uuid(),
  persona_slug: z.string(),
  conversation_id: z.string().uuid().optional(),
  handoff_id: z.string().uuid(),
  status: z.enum(['drafted', 'exported']).default('drafted'),
  item_count: z.number().int().min(0),
  summary: z.string(),
  evidence_index_path: z.string(),
  documents_path: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type TrainingPrepArtifact = z.infer<typeof TrainingPrepArtifactSchema>;

export const SessionSummarySchema = z.object({
  conversation_id: z.string().uuid(),
  summary: z.string(),
  updated_at: z.string().datetime(),
  message_count: z.number().int().min(0),
  candidate_count: z.number().int().min(0),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const WorkbenchRunSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['create', 'train', 'experiment', 'export']),
  persona_slug: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  recovery_state: z.enum(['idle', 'recovering', 'exhausted']).default('idle'),
  attempt_count: z.number().int().min(1).default(1),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().optional(),
  report_path: z.string().optional(),
  summary: z.string().optional(),
  log_path: z.string().optional(),
  pid: z.number().int().optional(),
  command: z.array(z.string()).default([]),
});
export type WorkbenchRun = z.infer<typeof WorkbenchRunSchema>;

export const WorkbenchRunReportSchema = z.object({
  run: WorkbenchRunSchema,
  report: z.unknown().optional(),
  context: z.unknown().optional(),
  context_path: z.string().optional(),
});
export type WorkbenchRunReport = z.infer<typeof WorkbenchRunReportSchema>;

export const PersonaConfigSchema = z.object({
  persona_slug: z.string(),
  name: z.string(),
  source_type: z.enum(['social', 'chat_file', 'video_file']),
  source_target: z.string().optional(),
  source_path: z.string().optional(),
  target_manifest_path: z.string().optional(),
  platform: z.string().optional(),
  updated_at: z.string().datetime(),
});
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;

export const PersonaDetailSchema = z.object({
  persona: z.object({
    slug: z.string(),
    name: z.string(),
    status: z.string(),
    doc_count: z.number().int().min(0),
    memory_node_count: z.number().int().min(0),
    training_rounds: z.number().int().min(0),
    updated_at: z.string().datetime(),
  }),
  config: PersonaConfigSchema,
});
export type PersonaDetail = z.infer<typeof PersonaDetailSchema>;

export const PersonaMutationResultSchema = z.object({
  persona: PersonaDetailSchema.shape.persona,
  run: WorkbenchRunSchema.nullable(),
});
export type PersonaMutationResult = z.infer<typeof PersonaMutationResultSchema>;

export interface PersonaSummary {
  slug: string;
  name: string;
  status: string;
  doc_count: number;
  memory_node_count: number;
  training_rounds: number;
  updated_at: string;
  is_ready?: boolean;
  progress_percent?: number;
  current_stage?: string;
  current_round?: number;
  total_rounds?: number;
}

export interface PersonaSkillSummary {
  origin_skills: Array<{ id: string; name: string; confidence: number }>;
  distilled_skills: Array<{ id: string; name: string; quality_score: number }>;
}

export interface CultivationDetail {
  persona: PersonaSummary;
  skills: PersonaSkillSummary;
  progress: {
    percent: number;
    current_stage: string;
    current_round: number;
    total_rounds: number;
    stages: Array<{
      key: string;
      label: string;
      completed: boolean;
      active: boolean;
    }>;
  };
  assets: {
    evidence_imports: WorkbenchEvidenceImport[];
    training_preps: TrainingPrepArtifact[];
  };
}

export interface PersonaWorkbenchProfile {
  persona: unknown;
  soul: unknown;
  summary: {
    language_style: string[];
    core_beliefs: string[];
    expert_domains: string[];
    coverage_score?: number;
  };
}

export interface ConversationBundle {
  conversation: Conversation;
  messages: ConversationMessage[];
  session_summary: SessionSummary | null;
}

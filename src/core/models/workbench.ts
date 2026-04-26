import { z } from 'zod';
import {
  EvidenceItemSchema,
  EvidenceStatsSchema,
  PersonaWebArtifactsSchema,
  TargetManifestSchema,
} from './evidence.js';

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

export const AttachmentRefSchema = z.object({
  id: z.string(),
  type: z.enum(['image', 'video', 'audio', 'text', 'file']),
  name: z.string(),
  path: z.string(),
  mime: z.string().optional(),
  size: z.number().int().min(0).optional(),
  processing_status: z.enum(['pending', 'ready', 'unsupported', 'error']).optional(),
  processing_summary: z.string().optional(),
  processing_provider: z.string().optional(),
  processing_error: z.string().optional(),
  processing_capability: z.enum(['text_extract', 'image_understanding', 'transcription']).optional(),
  validation_status: z.enum(['validated', 'rejected']).optional(),
  validation_summary: z.string().optional(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const SourceValidationResultSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'quarantined']),
  reason_code: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1).default(0),
  identity_match: z.number().min(0).max(1).default(0),
  source_integrity: z.number().min(0).max(1).default(0),
  evidence: z.array(z.string()).default([]),
});
export type SourceValidationResult = z.infer<typeof SourceValidationResultSchema>;

export const SourcePreviewTargetSchema = z.object({
  target: z.string(),
  status: z.enum(['accepted', 'rejected', 'quarantined', 'error']),
  summary: z.string(),
  fetched_via: z.string().optional(),
  source_url: z.string().optional(),
  source_platform: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  content_preview: z.string().optional(),
  identity_match: z.number().min(0).max(1).optional(),
  source_integrity: z.number().min(0).max(1).optional(),
  reason_code: z.string().optional(),
  evidence: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type SourcePreviewTarget = z.infer<typeof SourcePreviewTargetSchema>;

export const PersonaSourcePreviewSchema = z.object({
  source: z.object({
    id: z.string(),
    type: z.enum(['social', 'chat_file', 'video_file', 'audio_file', 'article']),
    mode: z.enum(['handle', 'remote_url', 'channel_url', 'single_url', 'local_file']).default('handle'),
    platform: z.string().optional(),
    handle_or_url: z.string().optional(),
    links: z.array(z.string()).default([]),
  }),
  status: z.enum(['accepted', 'rejected', 'quarantined', 'error']),
  summary: z.string(),
  target_results: z.array(SourcePreviewTargetSchema).default([]),
});
export type PersonaSourcePreview = z.infer<typeof PersonaSourcePreviewSchema>;

export const ConversationOrchestrationSchema = z.object({
  mode: z.enum(['answer', 'clarify', 'refuse_internal']).default('answer'),
  intent: z.enum(['greeting', 'factual', 'opinion', 'creative', 'relationship', 'meta', 'unknown']).default('unknown'),
  reason: z.string().optional(),
  persona_stability: z.enum(['strict', 'balanced']).default('balanced'),
  answer_style: z.enum(['concise', 'normal']).default('normal'),
  followup_question: z.string().optional(),
  disclosure_protected: z.boolean().default(false),
});
export type ConversationOrchestration = z.infer<typeof ConversationOrchestrationSchema>;

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
  attachments: z.array(AttachmentRefSchema).default([]),
  orchestration: ConversationOrchestrationSchema.optional(),
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
  persona_web_artifacts: PersonaWebArtifactsSchema.optional(),
});
export type WorkbenchEvidenceImportArtifacts = z.infer<typeof WorkbenchEvidenceImportArtifactsSchema>;

export const WorkbenchEvidenceImportSchema = z.object({
  id: z.string().uuid(),
  persona_slug: z.string(),
  conversation_id: z.string().uuid().optional(),
  source_kind: z.enum(['chat', 'video', 'article', 'audio']),
  source_platform: z.string().optional(),
  source_path: z.string(),
  target_manifest_path: z.string(),
  status: z.enum(['completed', 'failed', 'quarantined']).default('completed'),
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
  handoff_id: z.string().uuid().optional(),
  status: z.enum(['drafted', 'exported']).default('drafted'),
  item_count: z.number().int().min(0),
  summary: z.string(),
  evidence_index_path: z.string(),
  documents_path: z.string(),
  persona_web_artifacts: PersonaWebArtifactsSchema.optional(),
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
  type: z.enum(['create', 'train', 'experiment', 'export', 'source_sync']),
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

export const DiscoveredSourceCandidateSchema = z.object({
  id: z.string(),
  persona_slug: z.string(),
  type: z.enum([
    'official_site',
    'blog/article',
    'youtube_channel',
    'youtube_video',
    'podcast_episode_page',
    'interview/article_page',
  ]),
  platform: z.string().optional(),
  candidate_role: z.enum(['related_context', 'background_context']).optional(),
  anchor_entity_id: z.string().optional(),
  anchor_label: z.string().optional(),
  provenance_class: z.enum(['related_first_party', 'related_context', 'background_domain']).optional(),
  url_or_handle: z.string(),
  title: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  discovered_at: z.string().datetime(),
  discovered_from: z.string().optional(),
  status: z.enum(['pending', 'accepted', 'rejected']).default('pending'),
});
export type DiscoveredSourceCandidate = z.infer<typeof DiscoveredSourceCandidateSchema>;

export const PersonaSourceSchema = z.object({
  id: z.string(),
  type: z.enum(['social', 'chat_file', 'video_file', 'audio_file', 'article']),
  mode: z.enum(['handle', 'remote_url', 'channel_url', 'single_url', 'local_file']).default('handle'),
  platform: z.string().optional(),
  handle_or_url: z.string().optional(),
  links: z.array(z.string()).default([]),
  local_path: z.string().optional(),
  manifest_path: z.string().optional(),
  target_label: z.string().optional(),
  target_aliases: z.array(z.string()).default([]),
  source_role: z.enum(['self', 'related_context', 'background_context']).optional(),
  anchor_entity_id: z.string().optional(),
  sync_strategy: z.enum(['deep_window', 'incremental']).default('deep_window'),
  horizon_mode: z.enum(['recent_3y', 'deep_archive']).default('recent_3y'),
  horizon_years: z.number().int().min(1).max(10).optional(),
  batch_limit: z.number().int().min(10).max(500).optional(),
  enabled: z.boolean().default(true),
  last_synced_at: z.string().datetime().optional(),
  last_cursor: z.string().optional(),
  last_seen_published_at: z.string().datetime().optional(),
  status: z.enum(['idle', 'syncing', 'ready', 'error']).default('idle'),
  summary: z.string().optional(),
});
export type PersonaSource = z.infer<typeof PersonaSourceSchema>;

export const CultivationSummarySchema = z.object({
  status: z.string(),
  progress_percent: z.number().int().min(0).max(100).default(0),
  current_round: z.number().int().min(0).default(0),
  total_rounds: z.number().int().min(0).default(0),
  skill_summary: z.object({
    origin_count: z.number().int().min(0).default(0),
    distilled_count: z.number().int().min(0).default(0),
  }).default({ origin_count: 0, distilled_count: 0 }),
  source_summary: z.object({
    total_sources: z.number().int().min(0).default(0),
    enabled_sources: z.number().int().min(0).default(0),
    source_breakdown: z.record(z.string(), z.number().int().min(0)).default({}),
    document_count: z.number().int().min(0).default(0),
    recent_delta_count: z.number().int().min(0).default(0),
    current_operation: z.enum(['idle', 'deep_fetch', 'incremental_sync', 'discovery', 'web_build']).optional(),
    current_source_label: z.string().optional(),
    last_update_check_at: z.string().datetime().optional(),
    latest_update_result: z.string().optional(),
    phase: z.enum(['queued', 'deep_fetching', 'incremental_syncing', 'normalizing', 'building_evidence', 'building_network', 'training', 'continuing_collection', 'soft_closed', 'ready', 'error']).optional(),
    last_heartbeat_at: z.string().datetime().optional(),
    completed_windows: z.number().int().min(0).optional(),
    estimated_total_windows: z.number().int().min(0).optional(),
    active_window: z.object({
      source_id: z.string().optional(),
      source_label: z.string().optional(),
      window_start: z.string().datetime().optional(),
      window_end: z.string().datetime().optional(),
      provider: z.string().optional(),
      filter_mode: z.string().optional(),
      status: z.enum(['running', 'completed', 'empty', 'timeout', 'failed', 'skipped']).optional(),
      attempt: z.number().int().min(0).optional(),
      started_at: z.string().datetime().optional(),
      finished_at: z.string().datetime().optional(),
      updated_at: z.string().datetime().optional(),
      duration_ms: z.number().int().min(0).optional(),
      result_count: z.number().int().min(0).optional(),
      new_count: z.number().int().min(0).optional(),
      matched_count: z.number().int().min(0).optional(),
      rejected_count: z.number().int().min(0).optional(),
      quarantined_count: z.number().int().min(0).optional(),
      error: z.string().optional(),
    }).optional(),
    latest_window: z.object({
      source_id: z.string().optional(),
      source_label: z.string().optional(),
      window_start: z.string().datetime().optional(),
      window_end: z.string().datetime().optional(),
      provider: z.string().optional(),
      filter_mode: z.string().optional(),
      status: z.enum(['running', 'completed', 'empty', 'timeout', 'failed', 'skipped']).optional(),
      attempt: z.number().int().min(0).optional(),
      started_at: z.string().datetime().optional(),
      finished_at: z.string().datetime().optional(),
      updated_at: z.string().datetime().optional(),
      duration_ms: z.number().int().min(0).optional(),
      result_count: z.number().int().min(0).optional(),
      new_count: z.number().int().min(0).optional(),
      matched_count: z.number().int().min(0).optional(),
      rejected_count: z.number().int().min(0).optional(),
      quarantined_count: z.number().int().min(0).optional(),
      error: z.string().optional(),
    }).optional(),
    training_threshold: z.number().int().min(1).optional(),
    training_threshold_met: z.boolean().optional(),
    training_block_reason: z.string().optional(),
    clean_document_count: z.number().int().min(0).optional(),
    evaluation_passed: z.boolean().optional(),
    last_training_prep_count: z.number().int().min(0).optional(),
    retrain_delta_count: z.number().int().min(0).optional(),
    retrain_required_delta: z.number().int().min(0).optional(),
    retrain_progress_ratio: z.number().min(0).optional(),
    retrain_ready: z.boolean().optional(),
    collection_cycle: z.number().int().min(0).optional(),
    collection_stop_reason: z.string().optional(),
    history_exhausted: z.boolean().optional(),
    provider_exhausted: z.boolean().optional(),
    soft_closed: z.boolean().optional(),
    soft_closed_at: z.string().datetime().optional(),
    soft_close_reason: z.string().optional(),
    cache_reuse: z.object({
      active: z.boolean(),
      source_id: z.string().optional(),
      source_label: z.string().optional(),
      reused_document_count: z.number().int().min(0),
      summary: z.string(),
    }).optional(),
    network_summary: z.object({
      entity_count: z.number().int().min(0),
      relation_count: z.number().int().min(0),
      context_pack_count: z.number().int().min(0),
      pending_candidate_count: z.number().int().min(0),
      dominant_domains: z.array(z.string()).default([]),
      arc_count: z.number().int().min(0),
    }).optional(),
  }).default({ total_sources: 0, enabled_sources: 0, source_breakdown: {}, document_count: 0, recent_delta_count: 0 }),
  last_update_check_at: z.string().datetime().optional(),
});
export type CultivationSummary = z.infer<typeof CultivationSummarySchema>;

export const PersonaConfigSchema = z.object({
  persona_slug: z.string(),
  name: z.string(),
  sources: z.array(PersonaSourceSchema).default([]),
  update_policy: z.object({
    auto_check_remote: z.boolean().default(true),
    check_interval_minutes: z.number().int().min(5).default(60),
    training_threshold: z.number().int().min(1).max(20000).optional(),
    strategy: z.enum(['incremental']).default('incremental'),
    current_operation: z.enum(['idle', 'deep_fetch', 'incremental_sync', 'discovery', 'web_build']).optional(),
    current_source_label: z.string().optional(),
    last_checked_at: z.string().datetime().optional(),
    latest_result: z.string().optional(),
    evaluation_passed: z.boolean().optional(),
    collection_cycle: z.number().int().min(0).optional(),
    collection_stop_reason: z.string().optional(),
    history_exhausted: z.boolean().optional(),
    provider_exhausted: z.boolean().optional(),
    last_training_prep_count: z.number().int().min(0).optional(),
    last_training_baseline_clean_count: z.number().int().min(0).optional(),
    last_training_prep_id: z.string().optional(),
    last_deep_fetch_settled_clean_count: z.number().int().min(0).optional(),
    no_progress_deep_fetch_streak: z.number().int().min(0).optional(),
    soft_closed_at: z.string().datetime().optional(),
    soft_close_reason: z.enum(['material_exhausted']).optional(),
  }).default({
    auto_check_remote: true,
    check_interval_minutes: 60,
    strategy: 'incremental',
  }),
  updated_at: z.string().datetime(),
  // Legacy single-source fields for migration.
  source_type: z.enum(['social', 'chat_file', 'video_file', 'audio_file', 'article']).optional(),
  source_target: z.string().optional(),
  source_path: z.string().optional(),
  target_manifest_path: z.string().optional(),
  platform: z.string().optional(),
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
  cultivation_summary: CultivationSummarySchema.optional(),
  sources_summary: z.object({
    total_sources: z.number().int().min(0),
    enabled_sources: z.number().int().min(0),
    source_types: z.array(z.string()).default([]),
  }).optional(),
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
  source_count?: number;
  source_type_count?: number;
}

export interface PersonaSkillSummary {
  origin_skills: Array<{ id: string; name: string; confidence: number }>;
  distilled_skills: Array<{ id: string; name: string; quality_score: number }>;
}

export interface PersonaNetworkSummary {
  entity_count: number;
  relation_count: number;
  context_pack_count: number;
  pending_candidate_count: number;
  dominant_domains: string[];
  arc_count: number;
}

export interface CultivationDetail {
  persona: PersonaSummary;
  phase?: 'queued' | 'deep_fetching' | 'incremental_syncing' | 'normalizing' | 'building_evidence' | 'building_network' | 'training' | 'continuing_collection' | 'soft_closed' | 'ready' | 'error';
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
  raw_document_count?: number;
  clean_document_count?: number;
  training_threshold?: number;
  training_threshold_met?: boolean;
  training_block_reason?: string;
  evaluation_passed?: boolean;
  last_training_prep_count?: number;
  retrain_delta_count?: number;
  retrain_required_delta?: number;
  retrain_progress_ratio?: number;
  retrain_ready?: boolean;
  collection_cycle?: number;
  collection_stop_reason?: string;
  history_exhausted?: boolean;
  provider_exhausted?: boolean;
  soft_closed?: boolean;
  soft_closed_at?: string;
  soft_close_reason?: string;
  latest_activity?: string;
  last_success_at?: string;
  last_heartbeat_at?: string;
  current_window?: {
    source_id?: string;
    source_label?: string;
    window_start?: string;
    window_end?: string;
    provider?: string;
    filter_mode?: string;
    status?: 'running' | 'completed' | 'empty' | 'timeout' | 'failed' | 'skipped';
    attempt?: number;
    started_at?: string;
    finished_at?: string;
    updated_at?: string;
    duration_ms?: number;
    result_count?: number;
    new_count?: number;
    matched_count?: number;
    rejected_count?: number;
    quarantined_count?: number;
    error?: string;
  };
  active_windows?: Array<{
    source_id?: string;
    source_label?: string;
    window_start?: string;
    window_end?: string;
    provider?: string;
    filter_mode?: string;
    status?: 'running' | 'completed' | 'empty' | 'timeout' | 'failed' | 'skipped';
    attempt?: number;
    started_at?: string;
    finished_at?: string;
    updated_at?: string;
    duration_ms?: number;
    result_count?: number;
    new_count?: number;
    matched_count?: number;
    rejected_count?: number;
    quarantined_count?: number;
    error?: string;
  }>;
  source_items?: Array<{
    source_id: string;
    label: string;
    type: string;
    enabled: boolean;
    raw_count: number;
    clean_count: number;
    coverage_start?: string;
    coverage_end?: string;
    last_synced_at?: string;
    last_result?: string;
    status?: string;
    last_heartbeat_at?: string;
    cache_reused?: boolean;
    cache_document_count?: number;
    cache_summary?: string;
    validation_summary?: {
      accepted_count: number;
      rejected_count: number;
      quarantined_count: number;
      latest_summary?: string;
    };
    active_window?: {
      window_start?: string;
      window_end?: string;
      provider?: string;
      filter_mode?: string;
      status?: 'running' | 'completed' | 'empty' | 'timeout' | 'failed' | 'skipped';
      attempt?: number;
      started_at?: string;
      finished_at?: string;
      updated_at?: string;
      duration_ms?: number;
      result_count?: number;
      new_count?: number;
      matched_count?: number;
      rejected_count?: number;
      quarantined_count?: number;
      error?: string;
    };
  }>;
  rounds?: Array<{
    round: number;
    status: string;
    objective: string;
    document_count: number;
    finished_at?: string;
  }>;
  source_summary?: CultivationSummary['source_summary'];
  validation_summary?: {
    accepted_count: number;
    rejected_count: number;
    quarantined_count: number;
    latest_summary?: string;
  };
  cache_reuse?: {
    active: boolean;
    source_id?: string;
    source_label?: string;
    reused_document_count: number;
    summary: string;
  };
  network_summary?: PersonaNetworkSummary;
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

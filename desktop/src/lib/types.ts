export type NavView = 'Chat' | 'Create' | 'Train' | 'Experiment' | 'Export' | 'Settings';
export type InfoTab = 'Soul' | 'Memory' | 'Citations' | 'Writeback' | 'Training';

export interface PersonaSummary {
  slug: string;
  name: string;
  status: string;
  doc_count: number;
  memory_node_count: number;
  training_rounds: number;
  updated_at: string;
}

export interface PersonaWorkbenchProfile {
  persona: {
    slug: string;
    name: string;
    status: string;
    updated_at: string;
    source_targets?: string[];
  };
  soul: {
    coverage_score?: number;
    values?: { core_beliefs?: Array<{ belief: string }> };
    knowledge_domains?: { expert?: string[] };
    language_style?: { frequent_phrases?: string[] };
  };
  summary: {
    language_style: string[];
    core_beliefs: string[];
    expert_domains: string[];
    coverage_score?: number;
  };
}

export interface CitationItem {
  id: string;
  summary: string;
  category?: string;
  soul_dimension?: string;
  confidence?: number;
}

export interface WorkbenchMemoryNode {
  id: string;
  persona_id: string;
  original_text: string;
  summary: string;
  category: 'belief' | 'value' | 'fact' | 'opinion' | 'behavior' | 'knowledge' | 'preference' | 'experience';
  soul_dimension: 'language_style' | 'values' | 'thinking_patterns' | 'behavioral_traits' | 'knowledge_domains' | 'general';
  source_chunk_id: string;
  source_type: 'twitter' | 'wechat' | 'feishu' | 'article' | 'video' | 'custom';
  source_url?: string;
  time_reference?: string;
  confidence: number;
  reinforcement_count: number;
  semantic_tags: string[];
  status: 'active' | 'archived';
  superseded_by?: string;
  relations: Array<{
    target_id: string;
    relation_type: 'SUPPORTS' | 'CONTRADICTS' | 'TEMPORAL_FOLLOWS' | 'ELABORATES' | 'OPPOSES';
    weight: number;
  }>;
  created_at: string;
  updated_at: string;
}

export interface WorkbenchMemorySourceAsset {
  kind: 'web_url' | 'local_file' | 'evidence_import' | 'training_prep' | 'promotion_handoff' | 'synthetic';
  title: string;
  summary: string;
  id?: string;
  path?: string;
  url?: string;
  preview?: string;
  badges?: string[];
  metadata?: Record<string, string>;
}

export interface Conversation {
  id: string;
  persona_slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: 'active' | 'idle' | 'archived';
  message_count: number;
  last_message_preview?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  retrieved_memory_ids: string[];
  persona_dimensions: string[];
  citation_items: CitationItem[];
  writeback_candidate_ids: string[];
}

export interface SessionSummary {
  conversation_id: string;
  summary: string;
  updated_at: string;
  message_count: number;
  candidate_count: number;
}

export interface ConversationBundle {
  conversation: Conversation;
  messages: ConversationMessage[];
  session_summary: SessionSummary | null;
}

export interface MemoryCandidate {
  id: string;
  conversation_id: string;
  source_message_ids: string[];
  candidate_type: 'belief' | 'value' | 'behavior' | 'knowledge' | 'preference' | 'general';
  content: string;
  confidence: number;
  status: 'pending' | 'accepted' | 'rejected';
  promotion_state: 'idle' | 'ready';
  created_at: string;
}

export interface PromotionHandoffItem {
  candidate_id: string;
  candidate_type: MemoryCandidate['candidate_type'];
  content: string;
  confidence: number;
  source_message_ids: string[];
  created_at: string;
}

export interface PromotionHandoff {
  id: string;
  persona_slug: string;
  conversation_id: string;
  candidate_ids: string[];
  status: 'drafted' | 'queued' | 'archived';
  summary: string;
  session_summary?: string;
  items: PromotionHandoffItem[];
  created_at: string;
  updated_at: string;
}

export interface PromotionHandoffExport {
  handoff: PromotionHandoff;
  format: 'markdown' | 'json';
  filename: string;
  content: string;
}

export interface EvidenceImportArtifacts {
  evidence_index_path: string;
  evidence_stats_path: string;
  speaker_summary_path: string;
  scene_summary_path: string;
  target_manifest_path?: string;
  documents_path: string;
}

export interface WorkbenchEvidenceImport {
  id: string;
  persona_slug: string;
  conversation_id?: string;
  source_kind: 'chat' | 'video';
  source_platform?: string;
  source_path: string;
  target_manifest_path: string;
  status: 'completed' | 'failed';
  item_count: number;
  summary: string;
  stats: {
    raw_messages: number;
    sessions: number;
    windows: number;
    target_windows: number;
    context_only_windows: number;
    downgraded_scene_items: number;
    blocked_scene_items: number;
    cross_session_stable_items: number;
    speaker_role_counts: Record<string, number>;
    scene_counts: Record<string, number>;
    modality_counts: Record<string, number>;
    source_type_counts: Record<string, number>;
  };
  artifacts: EvidenceImportArtifacts;
  created_at: string;
  updated_at: string;
}

export interface EvidenceContextMessage {
  speaker_name: string;
  speaker_role: 'target' | 'self' | 'other' | 'unknown';
  content: string;
  timestamp?: string;
}

export interface EvidenceItem {
  id: string;
  raw_document_id: string;
  source_type: string;
  modality: 'text' | 'chat' | 'transcript';
  content: string;
  speaker_role: 'target' | 'self' | 'other' | 'unknown';
  speaker_name: string;
  target_confidence: number;
  scene: 'public' | 'work' | 'private' | 'intimate' | 'conflict' | 'casual' | 'unknown';
  conversation_id?: string;
  session_id?: string;
  window_role: 'target_centered' | 'context_only' | 'standalone';
  timestamp_start?: string;
  timestamp_end?: string;
  context_before: EvidenceContextMessage[];
  context_after: EvidenceContextMessage[];
  evidence_kind: 'statement' | 'reply' | 'explanation' | 'preference' | 'decision' | 'behavior_signal';
  stability_hints: {
    repeated_count: number;
    repeated_in_sessions: number;
    cross_session_stable: boolean;
  };
  metadata: Record<string, unknown>;
}

export interface TargetManifest {
  target_name: string;
  target_aliases: string[];
  self_aliases: string[];
  known_other_aliases: string[];
  default_scene?: 'public' | 'work' | 'private';
}

export interface WorkbenchEvidenceImportDetail {
  import: WorkbenchEvidenceImport;
  manifest: TargetManifest | null;
  sample_items: EvidenceItem[];
}

export interface TrainingPrepArtifact {
  id: string;
  persona_slug: string;
  conversation_id?: string;
  handoff_id: string;
  status: 'drafted' | 'exported';
  item_count: number;
  summary: string;
  evidence_index_path: string;
  documents_path: string;
  created_at: string;
  updated_at: string;
}

export interface TrainingPrepExport {
  prep: TrainingPrepArtifact;
  format: 'markdown' | 'json';
  filename: string;
  content: string;
}

export interface WorkbenchRun {
  id: string;
  type: 'create' | 'train' | 'experiment' | 'export';
  persona_slug?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  recovery_state?: 'idle' | 'recovering' | 'exhausted';
  attempt_count?: number;
  started_at: string;
  finished_at?: string;
  report_path?: string;
  summary?: string;
  log_path?: string;
  pid?: number;
  command: string[];
}

export interface WorkbenchRunReport {
  run: WorkbenchRun;
  report?: unknown;
  context?: unknown;
  context_path?: string;
}

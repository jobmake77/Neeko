/* ── TypeScript 类型定义 ─────────────────────────────────── */

export type ShellView = 'chat' | 'personas' | 'settings';

// Matches server PersonaSummary exactly — slug is the unique key (no id field)
export interface PersonaSummary {
  slug: string;
  name: string;
  status: string;           // 'pending' | 'building' | 'ready' | 'error' | 'creating' | 'updating'
  doc_count: number;
  memory_node_count: number;
  training_rounds: number;
  updated_at: string;
  source_type?: string;     // from config, may be absent
  is_ready?: boolean;
  progress_percent?: number;
  current_stage?: string;
  current_round?: number;
  total_rounds?: number;
  source_count?: number;
  source_type_count?: number;
}

export interface PersonaDetail {
  persona: PersonaSummary;
  config: PersonaConfig;
  cultivation_summary?: CultivationSummary;
  sources_summary?: {
    total_sources: number;
    enabled_sources: number;
    source_types: string[];
  };
}

export interface PersonaMutationResult {
  persona: PersonaSummary;
  run: WorkbenchRun | null;
}

export interface PersonaSkillSummary {
  origin_skills: Array<{ id: string; name: string; confidence: number }>;
  distilled_skills: Array<{ id: string; name: string; quality_score: number }>;
}

export interface CultivationDetail {
  persona: PersonaSummary;
  phase?: 'queued' | 'deep_fetching' | 'incremental_syncing' | 'normalizing' | 'building_evidence' | 'training' | 'continuing_collection' | 'ready' | 'error';
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
    evidence_imports: Array<{ id: string; persona_slug: string; source_path: string; status: string; created_at: string }>;
    training_preps: Array<{ id: string; persona_slug: string; handoff_id?: string; created_at: string }>;
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
}

export interface PersonaSource {
  id: string;
  type: 'social' | 'chat_file' | 'video_file' | 'audio_file' | 'article';
  mode: 'handle' | 'remote_url' | 'channel_url' | 'single_url' | 'local_file';
  platform?: string;
  handle_or_url?: string;
  links?: string[];
  local_path?: string;
  manifest_path?: string;
  target_label?: string;
  target_aliases?: string[];
  sync_strategy?: 'deep_window' | 'incremental';
  horizon_mode?: 'recent_3y' | 'deep_archive';
  horizon_years?: number;
  batch_limit?: number;
  enabled: boolean;
  last_synced_at?: string;
  last_cursor?: string;
  last_seen_published_at?: string;
  status: 'idle' | 'syncing' | 'ready' | 'error';
  summary?: string;
}

export interface DiscoveredSourceCandidate {
  id: string;
  persona_slug: string;
  type: 'official_site' | 'blog/article' | 'youtube_channel' | 'youtube_video' | 'podcast_episode_page' | 'interview/article_page';
  platform?: string;
  url_or_handle: string;
  title: string;
  summary: string;
  confidence: number;
  discovered_at: string;
  discovered_from?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface PersonaConfig {
  persona_slug?: string;
  name?: string;
  sources: PersonaSource[];
  update_policy: {
    auto_check_remote: boolean;
    check_interval_minutes: number;
    training_threshold?: number;
    strategy: 'incremental';
    current_operation?: 'idle' | 'deep_fetch' | 'incremental_sync' | 'discovery';
    current_source_label?: string;
    last_checked_at?: string;
    latest_result?: string;
    evaluation_passed?: boolean;
    collection_cycle?: number;
    collection_stop_reason?: string;
    history_exhausted?: boolean;
    provider_exhausted?: boolean;
    last_training_prep_count?: number;
    last_training_baseline_clean_count?: number;
    last_training_prep_id?: string;
  };
}

export interface Conversation {
  id: string;
  persona_slug: string;
  title?: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
  message_count?: number;
  status?: string;
}

export type MessageRole = 'user' | 'assistant';

export interface AttachmentRef {
  id: string;
  type: 'image' | 'video' | 'audio' | 'text' | 'file';
  name: string;
  path: string;
  mime?: string;
  size?: number;
  processing_status?: 'pending' | 'ready' | 'unsupported' | 'error';
  processing_summary?: string;
  processing_provider?: string;
  processing_error?: string;
  processing_capability?: 'text_extract' | 'image_understanding' | 'transcription';
  validation_status?: 'validated' | 'rejected';
  validation_summary?: string;
}

export interface SourceValidationResult {
  status: 'accepted' | 'rejected' | 'quarantined';
  reason_code: string;
  summary: string;
  confidence: number;
  identity_match: number;
  source_integrity: number;
  evidence: string[];
}

export interface ConversationOrchestration {
  mode: 'answer' | 'clarify' | 'refuse_internal';
  intent: 'greeting' | 'factual' | 'opinion' | 'creative' | 'relationship' | 'meta' | 'unknown';
  reason?: string;
  persona_stability: 'strict' | 'balanced';
  answer_style: 'concise' | 'normal';
  followup_question?: string;
  disclosure_protected: boolean;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  attachments?: AttachmentRef[];
  orchestration?: ConversationOrchestration;
}

export interface ConversationBundle {
  conversation: Conversation;
  messages: ConversationMessage[];
  session_summary?: unknown;
}

export interface WorkbenchRun {
  id: string;
  type?: 'create' | 'train' | 'experiment' | 'export' | 'source_sync';
  persona_slug?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'done' | 'error';
  started_at?: string;
  finished_at?: string;
  summary?: string;
}

export interface HealthStatus {
  ok: boolean;
  version?: string;
  uptime?: number;
  port?: number;
  build_id?: string;
  server_version?: string;
  started_at?: string;
  git_sha?: string;
}

export interface CultivationSummary {
  status: string;
  progress_percent: number;
  current_round: number;
  total_rounds: number;
  skill_summary: {
    origin_count: number;
    distilled_count: number;
  };
  source_summary: {
    total_sources: number;
    enabled_sources: number;
    source_breakdown?: Record<string, number>;
    document_count?: number;
    recent_delta_count?: number;
    current_operation?: 'idle' | 'deep_fetch' | 'incremental_sync' | 'discovery';
    current_source_label?: string;
    last_update_check_at?: string;
    latest_update_result?: string;
    phase?: 'queued' | 'deep_fetching' | 'incremental_syncing' | 'normalizing' | 'building_evidence' | 'training' | 'continuing_collection' | 'ready' | 'error';
    last_heartbeat_at?: string;
    completed_windows?: number;
    estimated_total_windows?: number;
    active_window?: {
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
    latest_window?: {
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
    training_threshold?: number;
    training_threshold_met?: boolean;
    training_block_reason?: string;
    clean_document_count?: number;
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
    cache_reuse?: {
      active: boolean;
      source_id?: string;
      source_label?: string;
      reused_document_count: number;
      summary: string;
    };
  };
  last_update_check_at?: string;
}

export interface RuntimeModelConfig {
  provider: 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek';
  model: string;
  mode?: 'shared' | 'split';
  shared_default?: {
    provider: 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek';
    model: string;
  };
  chat_default?: {
    provider: 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek';
    model: string;
  };
  training_default?: {
    provider: 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek';
    model: string;
  };
  api_keys: Partial<Record<'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek', string>>;
}

export interface ChatModelOverride {
  provider: RuntimeModelConfig['provider'];
  model: string;
}

export interface RuntimeSettingsPayload {
  default_training_profile?: string;
  default_input_routing_strategy?: string;
  qdrant_url?: string;
  data_dir?: string;
}

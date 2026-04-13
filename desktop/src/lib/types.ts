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
  source_summary?: CultivationSummary['source_summary'];
}

export interface PersonaSource {
  id: string;
  type: 'social' | 'chat_file' | 'video_file';
  mode: 'handle' | 'remote_url' | 'channel_url' | 'single_url' | 'local_file';
  platform?: string;
  handle_or_url?: string;
  local_path?: string;
  manifest_path?: string;
  enabled: boolean;
  last_synced_at?: string;
  last_cursor?: string;
  status: 'idle' | 'syncing' | 'ready' | 'error';
  summary?: string;
}

export interface PersonaConfig {
  persona_slug?: string;
  name?: string;
  sources: PersonaSource[];
  update_policy: {
    auto_check_remote: boolean;
    check_interval_minutes: number;
    strategy: 'incremental';
    last_checked_at?: string;
    latest_result?: string;
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
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  attachments?: AttachmentRef[];
}

export interface ConversationBundle {
  conversation: Conversation;
  messages: ConversationMessage[];
  session_summary?: unknown;
}

export interface WorkbenchRun {
  id: string;
  type?: string;
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
    last_update_check_at?: string;
    latest_update_result?: string;
  };
  last_update_check_at?: string;
}

export interface RuntimeModelConfig {
  provider: 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek';
  model: string;
  api_keys: Partial<Record<'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek', string>>;
}

export interface RuntimeSettingsPayload {
  default_training_profile?: string;
  default_input_routing_strategy?: string;
  qdrant_url?: string;
  data_dir?: string;
}

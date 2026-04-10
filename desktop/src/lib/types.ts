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
}

export interface PersonaConfig {
  persona_slug?: string;
  source_type: 'social' | 'chat_file' | 'video_file';
  source_target?: string;   // handle for social, url for video
  source_path?: string;     // local file path
  platform?: string;
  target_manifest_path?: string;
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

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
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

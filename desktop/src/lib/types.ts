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
}

export interface PersonaDetail {
  persona: PersonaSummary;
  config: PersonaConfig;
}

export interface PersonaMutationResult {
  persona: PersonaSummary;
  run: WorkbenchRun | null;
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

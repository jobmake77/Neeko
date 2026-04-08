export type ShellView = 'chat' | 'personas' | 'settings';

export interface PersonaSummary {
  slug: string;
  name: string;
  status: string;
  doc_count: number;
  memory_node_count: number;
  training_rounds: number;
  updated_at: string;
}

export interface PersonaConfig {
  persona_slug: string;
  name: string;
  source_type: 'social' | 'chat_file' | 'video_file';
  source_target?: string;
  source_path?: string;
  target_manifest_path?: string;
  platform?: string;
  updated_at: string;
}

export interface PersonaDetail {
  persona: PersonaSummary;
  config: PersonaConfig;
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
  citation_items: Array<{
    id: string;
    summary: string;
    category?: string;
    soul_dimension?: string;
    confidence?: number;
  }>;
  writeback_candidate_ids: string[];
}

export interface ConversationBundle {
  conversation: Conversation;
  messages: ConversationMessage[];
  session_summary: {
    conversation_id: string;
    summary: string;
    updated_at: string;
    message_count: number;
    candidate_count: number;
  } | null;
}

export interface WorkbenchRun {
  id: string;
  type: 'create' | 'train' | 'experiment' | 'export';
  persona_slug?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  recovery_state: 'idle' | 'recovering' | 'exhausted';
  attempt_count: number;
  started_at: string;
  finished_at?: string;
  report_path?: string;
  summary?: string;
  log_path?: string;
  pid?: number;
  command: string[];
}

export interface PersonaMutationResult {
  persona: PersonaSummary;
  run: WorkbenchRun | null;
}

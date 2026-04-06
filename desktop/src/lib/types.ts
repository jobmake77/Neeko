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

export interface WorkbenchRun {
  id: string;
  type: 'create' | 'train' | 'experiment' | 'export';
  persona_slug?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
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
  log_tail?: string;
}

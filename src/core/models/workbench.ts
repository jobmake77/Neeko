import { z } from 'zod';

export const CitationItemSchema = z.object({
  id: z.string(),
  summary: z.string(),
  category: z.string().optional(),
  soul_dimension: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type CitationItem = z.infer<typeof CitationItemSchema>;

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
  log_tail: z.string().optional(),
});
export type WorkbenchRunReport = z.infer<typeof WorkbenchRunReportSchema>;

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

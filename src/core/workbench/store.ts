import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { settings } from '../../config/settings.js';
import {
  Conversation,
  ConversationBundle,
  ConversationMessage,
  ConversationMessageSchema,
  ConversationSchema,
  MemoryCandidate,
  MemoryCandidateSchema,
  SessionSummary,
  SessionSummarySchema,
  WorkbenchRun,
  WorkbenchRunSchema,
} from '../models/workbench.js';

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

export class WorkbenchStore {
  readonly baseDir: string;

  constructor(baseDir = join(settings.getDataDir(), 'workbench')) {
    this.baseDir = baseDir;
    ensureDir(this.baseDir);
    ensureDir(this.getConversationsDir());
    ensureDir(this.getRunsDir());
  }

  getConversationsDir(): string {
    return join(this.baseDir, 'conversations');
  }

  getRunsDir(): string {
    return join(this.baseDir, 'runs');
  }

  private getConversationDir(id: string): string {
    return join(this.getConversationsDir(), id);
  }

  private getConversationPath(id: string): string {
    return join(this.getConversationDir(id), 'conversation.json');
  }

  private getMessagesPath(id: string): string {
    return join(this.getConversationDir(id), 'messages.json');
  }

  private getCandidatesPath(id: string): string {
    return join(this.getConversationDir(id), 'memory-candidates.json');
  }

  private getSummaryPath(id: string): string {
    return join(this.getConversationDir(id), 'session-summary.json');
  }

  private getRunPath(id: string): string {
    return join(this.getRunsDir(), `${id}.json`);
  }

  listRuns(personaSlug?: string): WorkbenchRun[] {
    if (!existsSync(this.getRunsDir())) return [];
    return readdirSync(this.getRunsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => this.getRun(entry.name.replace(/\.json$/, '')))
      .filter((item): item is WorkbenchRun => Boolean(item))
      .filter((item) => !personaSlug || item.persona_slug === personaSlug)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }

  saveConversation(conversation: Conversation): Conversation {
    const parsed = ConversationSchema.parse(conversation);
    ensureDir(this.getConversationDir(parsed.id));
    writeJsonFile(this.getConversationPath(parsed.id), parsed);
    return parsed;
  }

  getConversation(id: string): Conversation | null {
    const raw = readJsonFile<Conversation | null>(this.getConversationPath(id), null);
    if (!raw) return null;
    return ConversationSchema.parse(raw);
  }

  listConversations(personaSlug?: string): Conversation[] {
    if (!existsSync(this.getConversationsDir())) return [];
    return readdirSync(this.getConversationsDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getConversation(entry.name))
      .filter((item): item is Conversation => Boolean(item))
      .filter((item) => !personaSlug || item.persona_slug === personaSlug)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  updateConversation(id: string, patch: Partial<Conversation>): Conversation | null {
    const current = this.getConversation(id);
    if (!current) return null;
    return this.saveConversation({ ...current, ...patch });
  }

  deleteConversation(id: string): boolean {
    const dir = this.getConversationDir(id);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  saveMessages(conversationId: string, messages: ConversationMessage[]): ConversationMessage[] {
    const parsed = messages.map((item) => ConversationMessageSchema.parse(item));
    ensureDir(this.getConversationDir(conversationId));
    writeJsonFile(this.getMessagesPath(conversationId), parsed);
    return parsed;
  }

  listMessages(conversationId: string): ConversationMessage[] {
    const raw = readJsonFile<ConversationMessage[]>(this.getMessagesPath(conversationId), []);
    return raw.map((item) => ConversationMessageSchema.parse(item));
  }

  appendMessage(message: ConversationMessage): ConversationMessage[] {
    const parsed = ConversationMessageSchema.parse(message);
    const next = [...this.listMessages(parsed.conversation_id), parsed];
    this.saveMessages(parsed.conversation_id, next);
    return next;
  }

  saveMemoryCandidates(conversationId: string, candidates: MemoryCandidate[]): MemoryCandidate[] {
    const parsed = candidates.map((item) => MemoryCandidateSchema.parse(item));
    ensureDir(this.getConversationDir(conversationId));
    writeJsonFile(this.getCandidatesPath(conversationId), parsed);
    return parsed;
  }

  appendMemoryCandidates(conversationId: string, candidates: MemoryCandidate[]): MemoryCandidate[] {
    const next = [...this.listMemoryCandidates(conversationId), ...candidates.map((item) => MemoryCandidateSchema.parse(item))];
    return this.saveMemoryCandidates(conversationId, next);
  }

  listMemoryCandidates(conversationId: string): MemoryCandidate[] {
    const raw = readJsonFile<MemoryCandidate[]>(this.getCandidatesPath(conversationId), []);
    return raw
      .map((item) => MemoryCandidateSchema.parse(item))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  updateMemoryCandidate(
    conversationId: string,
    candidateId: string,
    patch: Partial<MemoryCandidate>
  ): MemoryCandidate | null {
    const candidates = this.listMemoryCandidates(conversationId);
    const index = candidates.findIndex((item) => item.id === candidateId);
    if (index < 0) return null;
    const updated = MemoryCandidateSchema.parse({ ...candidates[index], ...patch });
    candidates[index] = updated;
    this.saveMemoryCandidates(conversationId, candidates);
    return updated;
  }

  saveSessionSummary(summary: SessionSummary): SessionSummary {
    const parsed = SessionSummarySchema.parse(summary);
    ensureDir(this.getConversationDir(parsed.conversation_id));
    writeJsonFile(this.getSummaryPath(parsed.conversation_id), parsed);
    return parsed;
  }

  getSessionSummary(conversationId: string): SessionSummary | null {
    const raw = readJsonFile<SessionSummary | null>(this.getSummaryPath(conversationId), null);
    if (!raw) return null;
    return SessionSummarySchema.parse(raw);
  }

  getConversationBundle(conversationId: string): ConversationBundle | null {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;
    return {
      conversation,
      messages: this.listMessages(conversationId),
      session_summary: this.getSessionSummary(conversationId),
    };
  }

  saveRun(run: WorkbenchRun): WorkbenchRun {
    const parsed = WorkbenchRunSchema.parse(run);
    writeJsonFile(this.getRunPath(parsed.id), parsed);
    return parsed;
  }

  getRun(id: string): WorkbenchRun | null {
    const raw = readJsonFile<WorkbenchRun | null>(this.getRunPath(id), null);
    if (!raw) return null;
    return WorkbenchRunSchema.parse(raw);
  }

  updateRun(id: string, patch: Partial<WorkbenchRun>): WorkbenchRun | null {
    const current = this.getRun(id);
    if (!current) return null;
    return this.saveRun({ ...current, ...patch });
  }
}

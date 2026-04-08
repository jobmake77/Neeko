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
  PromotionHandoff,
  PromotionHandoffSchema,
  PersonaConfig,
  PersonaConfigSchema,
  SessionSummary,
  SessionSummarySchema,
  TrainingPrepArtifact,
  TrainingPrepArtifactSchema,
  WorkbenchEvidenceImport,
  WorkbenchEvidenceImportSchema,
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
    ensureDir(this.getEvidenceImportsDir());
    ensureDir(this.getHandoffsDir());
    ensureDir(this.getTrainingPrepDir());
    ensureDir(this.getRunsDir());
  }

  getConversationsDir(): string {
    return join(this.baseDir, 'conversations');
  }

  getRunsDir(): string {
    return join(this.baseDir, 'runs');
  }

  getHandoffsDir(): string {
    return join(this.baseDir, 'handoffs');
  }

  getEvidenceImportsDir(): string {
    return join(this.baseDir, 'evidence-imports');
  }

  getTrainingPrepDir(): string {
    return join(this.baseDir, 'training-preps');
  }

  getPersonaDir(slug: string): string {
    return settings.getPersonaDir(slug);
  }

  getPersonaConfigPath(slug: string): string {
    return join(this.getPersonaDir(slug), 'persona-config.json');
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

  private getHandoffPath(id: string): string {
    return join(this.getHandoffsDir(), `${id}.json`);
  }

  private getEvidenceImportPath(id: string): string {
    return join(this.getEvidenceImportsDir(), `${id}.json`);
  }

  private getEvidenceImportDir(id: string): string {
    return join(this.getEvidenceImportsDir(), id);
  }

  private getTrainingPrepPath(id: string): string {
    return join(this.getTrainingPrepDir(), `${id}.json`);
  }

  private getTrainingPrepDirPath(id: string): string {
    return join(this.getTrainingPrepDir(), id);
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

  savePromotionHandoff(handoff: PromotionHandoff): PromotionHandoff {
    const parsed = PromotionHandoffSchema.parse(handoff);
    writeJsonFile(this.getHandoffPath(parsed.id), parsed);
    return parsed;
  }

  getPromotionHandoff(id: string): PromotionHandoff | null {
    const raw = readJsonFile<PromotionHandoff | null>(this.getHandoffPath(id), null);
    if (!raw) return null;
    return PromotionHandoffSchema.parse(raw);
  }

  listPromotionHandoffs(personaSlug?: string, conversationId?: string): PromotionHandoff[] {
    if (!existsSync(this.getHandoffsDir())) return [];
    return readdirSync(this.getHandoffsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => this.getPromotionHandoff(entry.name.replace(/\.json$/, '')))
      .filter((item): item is PromotionHandoff => Boolean(item))
      .filter((item) => !personaSlug || item.persona_slug === personaSlug)
      .filter((item) => !conversationId || item.conversation_id === conversationId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  updatePromotionHandoff(id: string, patch: Partial<PromotionHandoff>): PromotionHandoff | null {
    const current = this.getPromotionHandoff(id);
    if (!current) return null;
    return this.savePromotionHandoff({ ...current, ...patch });
  }

  deletePromotionHandoff(id: string): boolean {
    const path = this.getHandoffPath(id);
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  }

  saveEvidenceImport(entry: WorkbenchEvidenceImport): WorkbenchEvidenceImport {
    const parsed = WorkbenchEvidenceImportSchema.parse(entry);
    writeJsonFile(this.getEvidenceImportPath(parsed.id), parsed);
    return parsed;
  }

  getEvidenceImport(id: string): WorkbenchEvidenceImport | null {
    const raw = readJsonFile<WorkbenchEvidenceImport | null>(this.getEvidenceImportPath(id), null);
    if (!raw) return null;
    return WorkbenchEvidenceImportSchema.parse(raw);
  }

  listEvidenceImports(personaSlug?: string, conversationId?: string): WorkbenchEvidenceImport[] {
    if (!existsSync(this.getEvidenceImportsDir())) return [];
    return readdirSync(this.getEvidenceImportsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => this.getEvidenceImport(entry.name.replace(/\.json$/, '')))
      .filter((item): item is WorkbenchEvidenceImport => Boolean(item))
      .filter((item) => !personaSlug || item.persona_slug === personaSlug)
      .filter((item) => !conversationId || item.conversation_id === conversationId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  saveTrainingPrepArtifact(entry: TrainingPrepArtifact): TrainingPrepArtifact {
    const parsed = TrainingPrepArtifactSchema.parse(entry);
    writeJsonFile(this.getTrainingPrepPath(parsed.id), parsed);
    return parsed;
  }

  deleteEvidenceImport(id: string): boolean {
    const filePath = this.getEvidenceImportPath(id);
    const dirPath = this.getEvidenceImportDir(id);
    const exists = existsSync(filePath) || existsSync(dirPath);
    if (existsSync(filePath)) rmSync(filePath, { force: true });
    if (existsSync(dirPath)) rmSync(dirPath, { recursive: true, force: true });
    return exists;
  }

  getTrainingPrepArtifact(id: string): TrainingPrepArtifact | null {
    const raw = readJsonFile<TrainingPrepArtifact | null>(this.getTrainingPrepPath(id), null);
    if (!raw) return null;
    return TrainingPrepArtifactSchema.parse(raw);
  }

  listTrainingPrepArtifacts(personaSlug?: string, conversationId?: string): TrainingPrepArtifact[] {
    if (!existsSync(this.getTrainingPrepDir())) return [];
    return readdirSync(this.getTrainingPrepDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => this.getTrainingPrepArtifact(entry.name.replace(/\.json$/, '')))
      .filter((item): item is TrainingPrepArtifact => Boolean(item))
      .filter((item) => !personaSlug || item.persona_slug === personaSlug)
      .filter((item) => !conversationId || item.conversation_id === conversationId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  deleteTrainingPrepArtifact(id: string): boolean {
    const filePath = this.getTrainingPrepPath(id);
    const dirPath = this.getTrainingPrepDirPath(id);
    const exists = existsSync(filePath) || existsSync(dirPath);
    if (existsSync(filePath)) rmSync(filePath, { force: true });
    if (existsSync(dirPath)) rmSync(dirPath, { recursive: true, force: true });
    return exists;
  }

  savePersonaConfig(config: PersonaConfig): PersonaConfig {
    const parsed = PersonaConfigSchema.parse(config);
    writeJsonFile(this.getPersonaConfigPath(parsed.persona_slug), parsed);
    return parsed;
  }

  getPersonaConfig(slug: string): PersonaConfig | null {
    const raw = readJsonFile<PersonaConfig | null>(this.getPersonaConfigPath(slug), null);
    if (!raw) return null;
    return PersonaConfigSchema.parse(raw);
  }

  deletePersonaConfig(slug: string): boolean {
    const path = this.getPersonaConfigPath(slug);
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  }

  deleteRunsByPersona(personaSlug: string): number {
    const runs = this.listRuns(personaSlug);
    for (const run of runs) {
      const runPath = this.getRunPath(run.id);
      if (existsSync(runPath)) rmSync(runPath, { force: true });
      if (run.log_path && existsSync(run.log_path)) rmSync(run.log_path, { force: true });
    }
    return runs.length;
  }

  deleteConversationsByPersona(personaSlug: string): number {
    const conversations = this.listConversations(personaSlug);
    conversations.forEach((conversation) => this.deleteConversation(conversation.id));
    return conversations.length;
  }

  deletePromotionHandoffsByPersona(personaSlug: string): number {
    const handoffs = this.listPromotionHandoffs(personaSlug);
    handoffs.forEach((handoff) => this.deletePromotionHandoff(handoff.id));
    return handoffs.length;
  }

  deleteEvidenceImportsByPersona(personaSlug: string): number {
    const imports = this.listEvidenceImports(personaSlug);
    imports.forEach((item) => this.deleteEvidenceImport(item.id));
    return imports.length;
  }

  deleteTrainingPrepsByPersona(personaSlug: string): number {
    const artifacts = this.listTrainingPrepArtifacts(personaSlug);
    artifacts.forEach((item) => this.deleteTrainingPrepArtifact(item.id));
    return artifacts.length;
  }
}

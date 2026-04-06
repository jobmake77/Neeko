import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { PersonaAgent } from '../agents/index.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { MemoryStore } from '../memory/store.js';
import { MemoryNode } from '../models/memory.js';
import { Persona, PersonaSchema } from '../models/persona.js';
import { Soul, SoulSchema } from '../models/soul.js';
import { loadSkillLibrary } from '../skills/library.js';
import {
  CitationItem,
  Conversation,
  ConversationBundle,
  ConversationMessage,
  MemoryCandidate,
  PersonaSummary,
  PersonaWorkbenchProfile,
  SessionSummary,
  WorkbenchRun,
  WorkbenchRunReport,
} from '../models/workbench.js';
import { WorkbenchStore } from './store.js';

export interface WorkbenchCreateInput {
  target?: string;
  skill?: string;
  targetManifest?: string;
  chatPlatform?: string;
  rounds?: number;
  trainingProfile?: string;
  inputRouting?: string;
  trainingSeedMode?: string;
  kimiStabilityMode?: string;
}

export interface WorkbenchTrainingInput {
  slug: string;
  mode?: string;
  rounds?: number;
  track?: string;
  trainingProfile?: string;
  inputRouting?: string;
  trainingSeedMode?: string;
  retries?: number;
  fromCheckpoint?: string;
  kimiStabilityMode?: string;
}

export interface WorkbenchExperimentInput {
  slug: string;
  profiles?: string;
  rounds?: number;
  questionsPerRound?: number;
  outputDir?: string;
  gate?: boolean;
  maxQualityDrop?: number;
  maxContradictionRise?: number;
  maxDuplicationRise?: number;
  inputRouting?: string;
  trainingSeedMode?: string;
  skipProfileSweep?: boolean;
  compareInputRouting?: boolean;
  compareTrainingSeed?: boolean;
  compareVariants?: string;
  kimiStabilityMode?: string;
}

export interface WorkbenchExportInput {
  slug: string;
  format?: string;
  outputDir?: string;
}

export interface PersonaResponseMeta {
  text: string;
  triggeredSkills: Array<{ id?: string; name: string; confidence?: number }>;
  normalizedQuery: string;
  retrievedMemories: MemoryNode[];
  personaDimensions: string[];
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function inferConversationTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length <= 28 ? normalized || 'New Thread' : `${normalized.slice(0, 28)}...`;
}

function guessCandidateType(text: string, dimensions: string[]): MemoryCandidate['candidate_type'] {
  const lower = text.toLowerCase();
  if (dimensions.includes('values') || /believe|应该|价值|原则|must|should/.test(lower)) return 'value';
  if (dimensions.includes('knowledge_domains') || /know|经验|domain|system|model|research/.test(lower)) return 'knowledge';
  if (dimensions.includes('behavioral_traits') || /habit|always|usually|倾向|习惯/.test(lower)) return 'behavior';
  if (dimensions.includes('thinking_patterns') || /think|reason|判断|推理|framework/.test(lower)) return 'belief';
  if (dimensions.includes('language_style')) return 'preference';
  return 'general';
}

function buildSessionSummary(messages: ConversationMessage[], candidates: MemoryCandidate[]): string {
  const recent = messages.slice(-6).map((item) => `${item.role}: ${item.content.replace(/\s+/g, ' ').slice(0, 120)}`);
  const candidateSnippet = candidates.slice(0, 2).map((item) => item.content).join(' | ');
  return [
    recent.length > 0 ? `Recent exchange: ${recent.join(' / ')}` : 'Recent exchange: none.',
    candidateSnippet ? `Memory candidates: ${candidateSnippet}` : 'Memory candidates: none in this session yet.',
  ].join(' ');
}

function toPreview(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

export class WorkbenchService {
  constructor(
    private readonly store = new WorkbenchStore(),
    private readonly cliEntryPath = process.argv[1],
    private readonly repoRoot = process.cwd()
  ) {}

  listPersonas(): PersonaSummary[] {
    const personasDir = join(settings.getDataDir(), 'personas');
    if (!existsSync(personasDir)) return [];
    return readdirSync(personasDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readPersonaSummary(entry.name))
      .filter((item): item is PersonaSummary => Boolean(item))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  getPersona(slug: string): PersonaWorkbenchProfile {
    const { persona, soul } = this.loadPersonaAssets(slug);
    return {
      persona,
      soul,
      summary: {
        language_style: soul.language_style.frequent_phrases.slice(0, 5),
        core_beliefs: soul.values.core_beliefs.slice(0, 5).map((item) => item.belief),
        expert_domains: soul.knowledge_domains.expert.slice(0, 6),
        coverage_score: soul.coverage_score,
      },
    };
  }

  listConversations(personaSlug: string): Conversation[] {
    return this.store.listConversations(personaSlug);
  }

  listRuns(personaSlug?: string): WorkbenchRun[] {
    return this.store.listRuns(personaSlug);
  }

  getConversation(conversationId: string): ConversationBundle | null {
    return this.store.getConversationBundle(conversationId);
  }

  renameConversation(conversationId: string, title: string): Conversation | null {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error('title is required');
    return this.store.updateConversation(conversationId, {
      title: nextTitle,
      updated_at: new Date().toISOString(),
    });
  }

  deleteConversation(conversationId: string): boolean {
    return this.store.deleteConversation(conversationId);
  }

  refreshConversationSummary(conversationId: string): ConversationBundle | null {
    const bundle = this.store.getConversationBundle(conversationId);
    if (!bundle) return null;
    const candidateList = this.store.listMemoryCandidates(conversationId);
    const updatedAt = new Date().toISOString();
    this.store.saveSessionSummary({
      conversation_id: conversationId,
      summary: buildSessionSummary(bundle.messages, candidateList),
      updated_at: updatedAt,
      message_count: bundle.messages.length,
      candidate_count: candidateList.length,
    });
    const latestMessage = bundle.messages[bundle.messages.length - 1];
    this.store.updateConversation(conversationId, {
      updated_at: latestMessage?.created_at ?? updatedAt,
      last_message_preview: latestMessage ? toPreview(latestMessage.content) : '',
    });
    return this.store.getConversationBundle(conversationId);
  }

  createConversation(personaSlug: string, title = 'New Thread'): Conversation {
    this.loadPersonaAssets(personaSlug);
    const now = new Date().toISOString();
    return this.store.saveConversation({
      id: crypto.randomUUID(),
      persona_slug: personaSlug,
      title,
      created_at: now,
      updated_at: now,
      status: 'active',
      message_count: 0,
      last_message_preview: '',
    });
  }

  async sendMessage(conversationId: string, message: string): Promise<ConversationBundle> {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation "${conversationId}" not found.`);

    const { persona, soul } = this.loadPersonaAssets(conversation.persona_slug);
    const history = this.store.listMessages(conversationId);
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
      retrieved_memory_ids: [],
      persona_dimensions: [],
      citation_items: [],
      writeback_candidate_ids: [],
    };
    const nextHistory = [...history, userMessage];
    this.store.appendMessage(userMessage);

    if (conversation.message_count === 0 && conversation.title === 'New Thread') {
      conversation.title = inferConversationTitle(message);
    }

    const response = await this.generateReply(persona, soul, nextHistory);
    const citations = response.retrievedMemories.map((item) => this.toCitation(item));
    const assistantMessageId = crypto.randomUUID();
    const candidates = this.buildMemoryCandidates(
      conversationId,
      [userMessage.id, assistantMessageId],
      response.text,
      response.personaDimensions,
      citations
    );
    const assistantMessage: ConversationMessage = {
      id: assistantMessageId,
      conversation_id: conversationId,
      role: 'assistant',
      content: response.text,
      created_at: new Date().toISOString(),
      retrieved_memory_ids: citations.map((item) => item.id),
      persona_dimensions: response.personaDimensions,
      citation_items: citations,
      writeback_candidate_ids: candidates.map((item) => item.id),
    };

    this.store.appendMessage(assistantMessage);
    if (candidates.length > 0) {
      this.store.appendMemoryCandidates(conversationId, candidates);
    }
    const bundle = this.store.getConversationBundle(conversationId);
    if (!bundle) throw new Error('Conversation bundle missing after message append.');

    const updatedConversation: Conversation = {
      ...conversation,
      updated_at: assistantMessage.created_at,
      message_count: bundle.messages.length,
      status: 'active',
      last_message_preview: toPreview(assistantMessage.content),
    };
    this.store.saveConversation(updatedConversation);

    const candidateList = this.store.listMemoryCandidates(conversationId);
    const summary: SessionSummary = {
      conversation_id: conversationId,
      summary: buildSessionSummary(bundle.messages, candidateList),
      updated_at: assistantMessage.created_at,
      message_count: bundle.messages.length,
      candidate_count: candidateList.length,
    };
    this.store.saveSessionSummary(summary);

    return this.store.getConversationBundle(conversationId) as ConversationBundle;
  }

  listMemoryCandidates(conversationId: string): MemoryCandidate[] {
    return this.store.listMemoryCandidates(conversationId);
  }

  createPersona(input: WorkbenchCreateInput): WorkbenchRun {
    const args = ['create'];
    if (input.target) args.push(input.target);
    if (input.skill) args.push('--skill', input.skill);
    if (input.targetManifest) args.push('--target-manifest', input.targetManifest);
    if (input.chatPlatform) args.push('--chat-platform', input.chatPlatform);
    args.push('--yes');
    if (typeof input.rounds === 'number') args.push('--rounds', String(input.rounds));
    if (input.trainingProfile) args.push('--training-profile', input.trainingProfile);
    if (input.inputRouting) args.push('--input-routing', input.inputRouting);
    if (input.trainingSeedMode) args.push('--training-seed-mode', input.trainingSeedMode);
    if (input.kimiStabilityMode) args.push('--kimi-stability-mode', input.kimiStabilityMode);
    return this.startCliRun('create', undefined, args);
  }

  startTraining(input: WorkbenchTrainingInput): WorkbenchRun {
    const args = ['train', input.slug];
    if (input.mode) args.push('--mode', input.mode);
    if (typeof input.rounds === 'number') args.push('--rounds', String(input.rounds));
    if (input.track) args.push('--track', input.track);
    if (input.trainingProfile) args.push('--training-profile', input.trainingProfile);
    if (input.inputRouting) args.push('--input-routing', input.inputRouting);
    if (input.trainingSeedMode) args.push('--training-seed-mode', input.trainingSeedMode);
    if (typeof input.retries === 'number') args.push('--retries', String(input.retries));
    if (input.fromCheckpoint) args.push('--from-checkpoint', input.fromCheckpoint);
    if (input.kimiStabilityMode) args.push('--kimi-stability-mode', input.kimiStabilityMode);
    return this.startCliRun('train', input.slug, args, join(settings.getPersonaDir(input.slug), 'training-report.json'));
  }

  startExperiment(input: WorkbenchExperimentInput): WorkbenchRun {
    const outputDir = input.outputDir ?? join(this.store.baseDir, 'experiment-runs', `${input.slug}-${Date.now()}`);
    const args = ['experiment', input.slug, '--output-dir', outputDir];
    if (input.profiles) args.push('--profiles', input.profiles);
    if (typeof input.rounds === 'number') args.push('--rounds', String(input.rounds));
    if (typeof input.questionsPerRound === 'number') args.push('--questions-per-round', String(input.questionsPerRound));
    if (input.gate) args.push('--gate');
    if (typeof input.maxQualityDrop === 'number') args.push('--max-quality-drop', String(input.maxQualityDrop));
    if (typeof input.maxContradictionRise === 'number') args.push('--max-contradiction-rise', String(input.maxContradictionRise));
    if (typeof input.maxDuplicationRise === 'number') args.push('--max-duplication-rise', String(input.maxDuplicationRise));
    if (input.inputRouting) args.push('--input-routing', input.inputRouting);
    if (input.trainingSeedMode) args.push('--training-seed-mode', input.trainingSeedMode);
    if (input.skipProfileSweep) args.push('--skip-profile-sweep');
    if (input.compareInputRouting) args.push('--compare-input-routing');
    if (input.compareTrainingSeed) args.push('--compare-training-seed');
    if (input.compareVariants) args.push('--compare-variants', input.compareVariants);
    if (input.kimiStabilityMode) args.push('--kimi-stability-mode', input.kimiStabilityMode);
    return this.startCliRun('experiment', input.slug, args, join(outputDir, 'experiment-report.json'));
  }

  exportPersona(input: WorkbenchExportInput): WorkbenchRun {
    const outputDir = input.outputDir ?? join(this.store.baseDir, 'exports', `${input.slug}-${Date.now()}`);
    const args = ['export', input.slug, '--to', input.format ?? 'openclaw', '--output-dir', outputDir];
    return this.startCliRun('export', input.slug, args, outputDir);
  }

  getRunStatus(runId: string): WorkbenchRun | null {
    const run = this.store.getRun(runId);
    if (!run) return null;
    if (run.status === 'running' && run.pid && !this.isPidAlive(run.pid)) {
      const inferredStatus = run.report_path && existsSync(run.report_path) ? 'completed' : 'failed';
      return this.store.updateRun(run.id, {
        status: inferredStatus,
        finished_at: new Date().toISOString(),
        summary: inferredStatus === 'completed' ? run.summary ?? 'Run finished.' : run.summary ?? 'Process exited unexpectedly.',
      });
    }
    return run;
  }

  getRunReport(runId: string): WorkbenchRunReport | null {
    const run = this.getRunStatus(runId);
    if (!run) return null;
    let report: unknown;
    const logTail = this.readLogTail(run.log_path);
    if (run.report_path && existsSync(run.report_path)) {
      if (run.report_path.endsWith('.json')) {
        report = readJsonFile(run.report_path, null);
      } else if (existsSync(run.report_path) && !run.report_path.endsWith('.json')) {
        report = { path: run.report_path };
      }
    }
    return { run, report, log_tail: logTail };
  }

  private readPersonaSummary(slug: string): PersonaSummary | null {
    try {
      const personaPath = join(settings.getPersonaDir(slug), 'persona.json');
      if (!existsSync(personaPath)) return null;
      const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8')));
      return {
        slug: persona.slug,
        name: persona.name,
        status: persona.status,
        doc_count: persona.doc_count,
        memory_node_count: persona.memory_node_count,
        training_rounds: persona.training_rounds,
        updated_at: persona.updated_at,
      };
    } catch {
      return null;
    }
  }

  private loadPersonaAssets(slug: string): { persona: Persona; soul: Soul } {
    const dir = settings.getPersonaDir(slug);
    const personaPath = join(dir, 'persona.json');
    const soulPath = join(dir, 'soul.yaml');
    if (!existsSync(personaPath) || !existsSync(soulPath)) {
      throw new Error(`Persona "${slug}" not found.`);
    }
    const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8')));
    const soul = SoulSchema.parse(yaml.load(readFileSync(soulPath, 'utf-8')));
    return { persona, soul };
  }

  private async generateReply(
    persona: Persona,
    soul: Soul,
    messages: ConversationMessage[]
  ): Promise<PersonaResponseMeta> {
    const store = new MemoryStore({
      qdrantUrl: settings.get('qdrantUrl'),
      qdrantApiKey: settings.get('qdrantApiKey'),
      openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
    });
    try {
      await store.ensureCollection(persona.memory_collection);
    } catch {
      // Keep chat available even if vector store is not ready.
    }
    const retriever = new MemoryRetriever(store);
    const skillLibrary = loadSkillLibrary(settings.getPersonaDir(persona.slug), persona.slug);
    const agent = new PersonaAgent(soul, retriever, persona.memory_collection, skillLibrary);
    const userMessage = messages[messages.length - 1]?.content ?? '';
    const history = messages.slice(0, -1).map((item) => ({ role: item.role === 'assistant' ? 'assistant' as const : 'user' as const, content: item.content }));
    const result = await agent.respondWithMeta(userMessage, history);
    return {
      text: result.text,
      triggeredSkills: result.triggeredSkills,
      normalizedQuery: result.normalizedQuery,
      retrievedMemories: result.retrievedMemories,
      personaDimensions: result.personaDimensions,
    };
  }

  private toCitation(memory: MemoryNode): CitationItem {
    return {
      id: memory.id,
      summary: memory.summary,
      category: memory.category,
      soul_dimension: memory.soul_dimension,
      confidence: memory.confidence,
    };
  }

  private buildMemoryCandidates(
    conversationId: string,
    sourceMessageIds: string[],
    reply: string,
    personaDimensions: string[],
    citations: CitationItem[]
  ): MemoryCandidate[] {
    const sentences = reply
      .split(/(?<=[.!?。！？])\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 32)
      .slice(0, 2);
    return sentences.map((sentence, index) => ({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      source_message_ids: sourceMessageIds,
      candidate_type: guessCandidateType(sentence, personaDimensions),
      content: sentence,
      confidence: Math.max(0.45, Math.min(0.85, 0.48 + (citations.length * 0.06) + (index === 0 ? 0.06 : 0))),
      status: 'pending',
      created_at: new Date().toISOString(),
    }));
  }

  private startCliRun(
    type: WorkbenchRun['type'],
    personaSlug: string | undefined,
    args: string[],
    reportPath?: string
  ): WorkbenchRun {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const logDir = join(this.store.baseDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${runId}.log`);
    const child = spawn(process.execPath, [this.cliEntryPath, ...args], {
      cwd: this.repoRoot,
      env: { ...process.env, NEEKO_CLI_FORCE_EXIT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    child.stdout.on('data', (chunk) => {
      writeFileSync(logPath, String(chunk), { flag: 'a' });
    });
    child.stderr.on('data', (chunk) => {
      writeFileSync(logPath, String(chunk), { flag: 'a' });
    });

    const run = this.store.saveRun({
      id: runId,
      type,
      persona_slug: personaSlug,
      status: 'running',
      started_at: startedAt,
      report_path: reportPath,
      summary: `${type} started`,
      log_path: logPath,
      pid: child.pid,
      command: [process.execPath, this.cliEntryPath, ...args],
    });

    child.on('exit', (code) => {
      const status = code === 0 ? 'completed' : 'failed';
      const summary = code === 0 ? `${type} completed` : `${type} failed with exit code ${code}`;
      this.store.updateRun(runId, {
        status,
        finished_at: new Date().toISOString(),
        summary,
      });
    });

    child.on('error', (error) => {
      writeFileSync(logPath, `${String(error)}\n`, { flag: 'a' });
      this.store.updateRun(runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        summary: `${type} failed to start: ${String(error)}`,
      });
    });

    return run;
  }

  private readLogTail(logPath: string | undefined, maxLines = 80): string | undefined {
    if (!logPath || !existsSync(logPath)) return undefined;
    try {
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.split(/\r?\n/).filter(Boolean);
      return lines.slice(-maxLines).join('\n');
    } catch {
      return undefined;
    }
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

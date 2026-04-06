import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import { spawn } from 'child_process';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { PersonaAgent } from '../agents/index.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { MemoryStore } from '../memory/store.js';
import { MemoryNode } from '../models/memory.js';
import { Persona, PersonaSchema } from '../models/persona.js';
import { Soul, SoulSchema } from '../models/soul.js';
import { EvidenceItem } from '../models/evidence.js';
import { loadSkillLibrary } from '../skills/library.js';
import { RawDocument } from '../models/memory.js';
import {
  buildChatEvidenceBatchFromFile,
  buildStandaloneEvidenceBatch,
  buildVideoTranscriptEvidenceBatch,
  convertEvidenceItemsToDocuments,
  loadTargetManifest,
  writeEvidenceArtifacts,
} from '../pipeline/evidence-layer.js';
import { VideoAdapter } from '../pipeline/ingestion/video.js';
import {
  CitationItem,
  Conversation,
  ConversationBundle,
  ConversationMessage,
  MemoryCandidate,
  PersonaSummary,
  PersonaWorkbenchProfile,
  PromotionHandoff,
  TrainingPrepArtifact,
  SessionSummary,
  WorkbenchEvidenceImport,
  WorkbenchRun,
  WorkbenchRunReport,
} from '../models/workbench.js';
import { classifyFailure } from '../training/failure-loop.js';
import { CheckpointStore } from '../training/checkpoint.js';
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
  prepDocumentsPath?: string;
  prepEvidencePath?: string;
  prepArtifactId?: string;
  evidenceImportId?: string;
  smoke?: boolean;
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

export interface WorkbenchEvidenceImportInput {
  personaSlug: string;
  conversationId?: string;
  sourceKind: 'chat' | 'video';
  sourcePath: string;
  targetManifestPath: string;
  chatPlatform?: 'wechat' | 'feishu';
}

export interface PersonaResponseMeta {
  text: string;
  triggeredSkills: Array<{ id?: string; name: string; confidence?: number }>;
  normalizedQuery: string;
  retrievedMemories: MemoryNode[];
  personaDimensions: string[];
}

export interface PromotionHandoffExport {
  handoff: PromotionHandoff;
  format: 'markdown' | 'json';
  filename: string;
  content: string;
}

export interface TrainingPrepExport {
  prep: TrainingPrepArtifact;
  format: 'markdown' | 'json';
  filename: string;
  content: string;
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

function buildPromotionHandoffSummary(candidates: MemoryCandidate[]): string {
  const grouped = new Map<MemoryCandidate['candidate_type'], number>();
  for (const candidate of candidates) {
    grouped.set(candidate.candidate_type, (grouped.get(candidate.candidate_type) ?? 0) + 1);
  }
  const typeSummary = Array.from(grouped.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${type} x${count}`)
    .join(', ');
  const confidence =
    candidates.length > 0
      ? `${Math.round((candidates.reduce((sum, item) => sum + item.confidence, 0) / candidates.length) * 100)}% avg confidence`
      : 'no confidence';
  return `${candidates.length} promotion-ready candidates${typeSummary ? ` · ${typeSummary}` : ''} · ${confidence}`;
}

function slugifySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'handoff';
}

function renderPromotionHandoffMarkdown(handoff: PromotionHandoff): string {
  const lines = [
    `# Promotion Handoff`,
    '',
    `- Persona: ${handoff.persona_slug}`,
    `- Conversation: ${handoff.conversation_id}`,
    `- Status: ${handoff.status}`,
    `- Created: ${handoff.created_at}`,
    `- Updated: ${handoff.updated_at}`,
    `- Candidate count: ${handoff.items.length}`,
    '',
    `## Summary`,
    '',
    handoff.summary,
  ];
  if (handoff.session_summary) {
    lines.push('', '## Session Summary', '', handoff.session_summary);
  }
  lines.push('', '## Candidates', '');
  handoff.items.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.candidate_type}] (${Math.round(item.confidence * 100)}%) ${item.content}`);
    if (item.source_message_ids.length > 0) {
      lines.push(`   - source_message_ids: ${item.source_message_ids.join(', ')}`);
    }
    lines.push(`   - candidate_id: ${item.candidate_id}`);
    lines.push(`   - created_at: ${item.created_at}`);
  });
  return lines.join('\n');
}

function buildEvidenceImportSummary(sourceKind: WorkbenchEvidenceImport['source_kind'], stats: WorkbenchEvidenceImport['stats']): string {
  return [
    `${sourceKind} import`,
    `${stats.windows} evidence windows`,
    `${stats.cross_session_stable_items} stable`,
    `${stats.blocked_scene_items} blocked-scene`,
  ].join(' · ');
}

function buildTrainingPrepSummary(handoff: PromotionHandoff, docs: RawDocument[]): string {
  return [
    `training prep from handoff`,
    `${handoff.items.length} handoff items`,
    `${docs.length} training documents`,
    handoff.summary,
  ].join(' · ');
}

function renderTrainingPrepMarkdown(prep: TrainingPrepArtifact): string {
  return [
    '# Training Prep Artifact',
    '',
    `- Persona: ${prep.persona_slug}`,
    `- Conversation: ${prep.conversation_id ?? 'n/a'}`,
    `- Handoff: ${prep.handoff_id}`,
    `- Status: ${prep.status}`,
    `- Items: ${prep.item_count}`,
    `- Created: ${prep.created_at}`,
    `- Updated: ${prep.updated_at}`,
    '',
    '## Summary',
    '',
    prep.summary,
    '',
    '## Paths',
    '',
    `- documents_path: ${prep.documents_path}`,
    `- evidence_index_path: ${prep.evidence_index_path}`,
  ].join('\n');
}

function createTranscriptDoc(
  sourcePath: string,
  content: string,
  metadata: Record<string, unknown> = {},
  publishedAt?: string
): RawDocument {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    source_type: 'video',
    source_url: sourcePath,
    source_platform: 'video_transcript',
    content,
    author: String(metadata.speaker_name ?? metadata.speaker ?? 'unknown'),
    published_at: publishedAt,
    fetched_at: now,
    metadata: {
      filename: basename(sourcePath),
      speaker_segments: [],
      nonverbal_signals: [],
      ...metadata,
    },
  };
}

function safeIso(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseTranscriptSourceFile(sourcePath: string): RawDocument[] | null {
  const ext = extname(sourcePath).toLowerCase();
  if (!['.txt', '.md', '.json', '.jsonl', '.ndjson'].includes(ext)) return null;
  const raw = readFileSync(sourcePath, 'utf-8').trim();
  if (!raw) return [];

  if (ext === '.txt' || ext === '.md') {
    return [createTranscriptDoc(sourcePath, raw)];
  }

  if (ext === '.jsonl' || ext === '.ndjson') {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .map((segment) =>
        createTranscriptDoc(
          sourcePath,
          String(segment.text ?? segment.content ?? '').trim(),
          {
            speaker_name: segment.speaker_name ?? segment.speaker,
            speaker_role: segment.speaker_role,
            segment_start_ms: segment.segment_start_ms ?? segment.start_ms,
            segment_end_ms: segment.segment_end_ms ?? segment.end_ms,
            segment_start_iso: segment.segment_start_iso ?? segment.start_iso,
            segment_end_iso: segment.segment_end_iso ?? segment.end_iso,
            speaker_segments: Array.isArray(segment.speaker_segments) ? segment.speaker_segments : [],
            nonverbal_signals: Array.isArray(segment.nonverbal_signals) ? segment.nonverbal_signals : [],
          },
          safeIso(segment.segment_start_iso ?? segment.start_iso ?? segment.timestamp)
        )
      )
      .filter((doc) => doc.content.length > 0);
  }

  const parsed = JSON.parse(raw) as unknown;
  const segments =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).segments)
        ? (parsed as Record<string, unknown>).segments as Record<string, unknown>[]
        : null;
  if (!segments) {
    const singleton = parsed as Record<string, unknown>;
    const content = String(singleton.text ?? singleton.content ?? '').trim();
    return content ? [createTranscriptDoc(sourcePath, content, singleton)] : [];
  }

  return segments
    .map((segment) =>
      createTranscriptDoc(
        sourcePath,
        String(segment.text ?? segment.content ?? '').trim(),
        {
          speaker_name: segment.speaker_name ?? segment.speaker,
          speaker_role: segment.speaker_role,
          segment_start_ms: segment.segment_start_ms ?? segment.start_ms ?? segment.start,
          segment_end_ms: segment.segment_end_ms ?? segment.end_ms ?? segment.end,
          segment_start_iso: segment.segment_start_iso ?? segment.start_iso,
          segment_end_iso: segment.segment_end_iso ?? segment.end_iso,
          speaker_segments: Array.isArray(segment.speaker_segments) ? segment.speaker_segments : [],
          nonverbal_signals: Array.isArray(segment.nonverbal_signals) ? segment.nonverbal_signals : [],
        },
        safeIso(segment.segment_start_iso ?? segment.start_iso ?? segment.timestamp)
      )
    )
    .filter((doc) => doc.content.length > 0);
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

  listPromotionHandoffs(personaSlug: string, conversationId?: string): PromotionHandoff[] {
    return this.store.listPromotionHandoffs(personaSlug, conversationId);
  }

  listEvidenceImports(personaSlug: string, conversationId?: string): WorkbenchEvidenceImport[] {
    return this.store.listEvidenceImports(personaSlug, conversationId);
  }

  listTrainingPrepArtifacts(personaSlug: string, conversationId?: string): TrainingPrepArtifact[] {
    return this.store.listTrainingPrepArtifacts(personaSlug, conversationId);
  }

  getTrainingPrepArtifact(prepId: string): TrainingPrepArtifact | null {
    return this.store.getTrainingPrepArtifact(prepId);
  }

  getPromotionHandoff(handoffId: string): PromotionHandoff | null {
    return this.store.getPromotionHandoff(handoffId);
  }

  reviewMemoryCandidate(
    conversationId: string,
    candidateId: string,
    status: MemoryCandidate['status']
  ): { candidate: MemoryCandidate; candidates: MemoryCandidate[] } | null {
    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      throw new Error(`Unsupported candidate status: ${status}`);
    }
    const updated = this.store.updateMemoryCandidate(
      conversationId,
      candidateId,
      status === 'accepted'
        ? { status }
        : { status, promotion_state: 'idle' }
    );
    if (!updated) return null;
    return {
      candidate: updated,
      candidates: this.store.listMemoryCandidates(conversationId),
    };
  }

  setCandidatePromotionState(
    conversationId: string,
    candidateId: string,
    promotionState: MemoryCandidate['promotion_state']
  ): { candidate: MemoryCandidate; candidates: MemoryCandidate[] } | null {
    if (!['idle', 'ready'].includes(promotionState)) {
      throw new Error(`Unsupported promotion state: ${promotionState}`);
    }
    const current = this.store.listMemoryCandidates(conversationId).find((item) => item.id === candidateId);
    if (!current) return null;
    if (promotionState === 'ready' && current.status !== 'accepted') {
      throw new Error('Only accepted candidates can enter the promotion-ready queue.');
    }
    const updated = this.store.updateMemoryCandidate(conversationId, candidateId, { promotion_state: promotionState });
    if (!updated) return null;
    return {
      candidate: updated,
      candidates: this.store.listMemoryCandidates(conversationId),
    };
  }

  createPromotionHandoff(conversationId: string): PromotionHandoff {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation "${conversationId}" not found.`);
    }
    const readyCandidates = this.store
      .listMemoryCandidates(conversationId)
      .filter((item) => item.status === 'accepted' && item.promotion_state === 'ready');
    if (readyCandidates.length === 0) {
      throw new Error('No promotion-ready candidates available for handoff.');
    }
    const sessionSummary = this.store.getSessionSummary(conversationId);
    const now = new Date().toISOString();
    return this.store.savePromotionHandoff({
      id: crypto.randomUUID(),
      persona_slug: conversation.persona_slug,
      conversation_id: conversationId,
      candidate_ids: readyCandidates.map((item) => item.id),
      status: 'drafted',
      summary: buildPromotionHandoffSummary(readyCandidates),
      session_summary: sessionSummary?.summary,
      items: readyCandidates.map((item) => ({
        candidate_id: item.id,
        candidate_type: item.candidate_type,
        content: item.content,
        confidence: item.confidence,
        source_message_ids: item.source_message_ids,
        created_at: item.created_at,
      })),
      created_at: now,
      updated_at: now,
    });
  }

  updatePromotionHandoffStatus(
    handoffId: string,
    status: PromotionHandoff['status']
  ): PromotionHandoff | null {
    if (!['drafted', 'queued', 'archived'].includes(status)) {
      throw new Error(`Unsupported handoff status: ${status}`);
    }
    return this.store.updatePromotionHandoff(handoffId, {
      status,
      updated_at: new Date().toISOString(),
    });
  }

  exportPromotionHandoff(handoffId: string, format: 'markdown' | 'json' = 'markdown'): PromotionHandoffExport {
    const handoff = this.store.getPromotionHandoff(handoffId);
    if (!handoff) {
      throw new Error(`Promotion handoff "${handoffId}" not found.`);
    }
    const filenameBase = `${slugifySegment(handoff.persona_slug)}-${handoff.id}`;
    if (format === 'json') {
      return {
        handoff,
        format,
        filename: `${filenameBase}.json`,
        content: JSON.stringify(handoff, null, 2),
      };
    }
    return {
      handoff,
      format: 'markdown',
      filename: `${filenameBase}.md`,
      content: renderPromotionHandoffMarkdown(handoff),
    };
  }

  async importEvidence(input: WorkbenchEvidenceImportInput): Promise<WorkbenchEvidenceImport> {
    this.loadPersonaAssets(input.personaSlug);
    const manifest = loadTargetManifest(input.targetManifestPath);
    const importId = crypto.randomUUID();
    const importDir = join(this.store.getEvidenceImportsDir(), importId);
    mkdirSync(importDir, { recursive: true });

    let batch;
    let sourceDocs: RawDocument[] = [];
    if (input.sourceKind === 'chat') {
      batch = await buildChatEvidenceBatchFromFile(input.sourcePath, {
        manifest,
        sourceType: input.chatPlatform ?? 'wechat',
        sourceUrl: input.sourcePath,
      });
    } else {
      sourceDocs = parseTranscriptSourceFile(input.sourcePath) ?? [];
      if (sourceDocs.length === 0) {
        const adapter = new VideoAdapter(settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY);
        sourceDocs = await adapter.fetch(input.sourcePath);
      }
      batch = buildVideoTranscriptEvidenceBatch(sourceDocs, manifest);
    }

    const docs = convertEvidenceItemsToDocuments(batch.items, sourceDocs);
    const artifacts = writeEvidenceArtifacts(importDir, batch, manifest);
    const documentsPath = join(importDir, 'documents.json');
    writeFileSync(documentsPath, JSON.stringify(docs, null, 2), 'utf-8');

    return this.store.saveEvidenceImport({
      id: importId,
      persona_slug: input.personaSlug,
      conversation_id: input.conversationId,
      source_kind: input.sourceKind,
      source_platform: input.sourceKind === 'chat' ? input.chatPlatform : 'video_transcript',
      source_path: input.sourcePath,
      target_manifest_path: input.targetManifestPath,
      status: 'completed',
      item_count: batch.items.length,
      summary: buildEvidenceImportSummary(input.sourceKind, batch.stats),
      stats: batch.stats,
      artifacts: {
        ...artifacts,
        documents_path: documentsPath,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  createTrainingPrepFromHandoff(handoffId: string): TrainingPrepArtifact {
    const handoff = this.store.getPromotionHandoff(handoffId);
    if (!handoff) {
      throw new Error(`Promotion handoff "${handoffId}" not found.`);
    }

    const prepId = crypto.randomUUID();
    const prepDir = join(this.store.getTrainingPrepDir(), prepId);
    mkdirSync(prepDir, { recursive: true });

    const now = new Date().toISOString();
    const docs: RawDocument[] = handoff.items.map((item, index) => ({
      id: crypto.randomUUID(),
      source_type: 'custom',
      source_url: `workbench:handoff:${handoff.id}`,
      source_platform: 'workbench_training_prep',
      content: item.content,
      author: handoff.persona_slug,
      published_at: item.created_at,
      fetched_at: now,
      metadata: {
        handoff_id: handoff.id,
        candidate_id: item.candidate_id,
        candidate_type: item.candidate_type,
        source_message_ids: item.source_message_ids,
        session_summary: handoff.session_summary,
        handoff_index: index,
      },
    }));

    const prepBatch = buildStandaloneEvidenceBatch(docs, { sourceLabel: 'workbench_training_prep' });
    const evidenceItems: EvidenceItem[] = prepBatch.items;
    const batchArtifacts = writeEvidenceArtifacts(prepDir, prepBatch);
    const documentsPath = join(prepDir, 'documents.json');
    writeFileSync(documentsPath, JSON.stringify(docs, null, 2), 'utf-8');

    return this.store.saveTrainingPrepArtifact({
      id: prepId,
      persona_slug: handoff.persona_slug,
      conversation_id: handoff.conversation_id,
      handoff_id: handoff.id,
      status: 'drafted',
      item_count: docs.length,
      summary: buildTrainingPrepSummary(handoff, docs),
      evidence_index_path: batchArtifacts.evidence_index_path,
      documents_path: documentsPath,
      created_at: now,
      updated_at: now,
    });
  }

  exportTrainingPrep(prepId: string, format: 'markdown' | 'json' = 'markdown'): TrainingPrepExport {
    const prep = this.store.getTrainingPrepArtifact(prepId);
    if (!prep) {
      throw new Error(`Training prep "${prepId}" not found.`);
    }
    const filenameBase = `${slugifySegment(prep.persona_slug)}-${prep.id}`;
    if (format === 'json') {
      return {
        prep,
        format,
        filename: `${filenameBase}.json`,
        content: JSON.stringify(prep, null, 2),
      };
    }
    return {
      prep,
      format: 'markdown',
      filename: `${filenameBase}.md`,
      content: renderTrainingPrepMarkdown(prep),
    };
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
    const isSmoke = input.smoke === true;
    const args = ['train', input.slug];
    args.push('--mode', isSmoke ? 'quick' : (input.mode ?? 'quick'));
    args.push('--rounds', String(isSmoke ? 1 : (typeof input.rounds === 'number' ? input.rounds : 1)));
    args.push('--track', isSmoke ? 'persona_extract' : (input.track ?? 'full_serial'));
    if (input.trainingProfile) args.push('--training-profile', input.trainingProfile);
    if (input.inputRouting) args.push('--input-routing', input.inputRouting);
    if (input.trainingSeedMode) args.push('--training-seed-mode', input.trainingSeedMode);
    args.push('--retries', String(typeof input.retries === 'number' ? input.retries : 2));
    if (!isSmoke && input.fromCheckpoint) args.push('--from-checkpoint', input.fromCheckpoint);
    if (input.kimiStabilityMode) args.push('--kimi-stability-mode', input.kimiStabilityMode);
    if (input.prepDocumentsPath) args.push('--prep-documents-path', input.prepDocumentsPath);
    if (input.prepEvidencePath) args.push('--prep-evidence-path', input.prepEvidencePath);
    if (input.prepArtifactId) args.push('--prep-artifact-id', input.prepArtifactId);
    if (input.evidenceImportId) args.push('--evidence-import-id', input.evidenceImportId);
    return this.startCliRun(
      'train',
      input.slug,
      args,
      join(settings.getPersonaDir(input.slug), 'training-report.json'),
      {
        env: isSmoke
          ? {
            NEEKO_PREFLIGHT_TRAIN_TIMEOUT_MS: process.env.NEEKO_PREFLIGHT_TRAIN_TIMEOUT_MS ?? '60000',
            NEEKO_RETRY_PROVIDER_TIMEOUT_MAX: process.env.NEEKO_RETRY_PROVIDER_TIMEOUT_MAX ?? '2',
          }
          : undefined,
        summaryLabel: isSmoke ? 'train smoke' : 'train',
        autoRecover: true,
        maxRecoveryAttempts: isSmoke ? 2 : 2,
      }
    );
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
        summary: inferExitedRunSummary(run.summary, inferredStatus),
      });
    }
    if ((run.status === 'completed' || run.status === 'failed') && typeof run.summary === 'string' && run.summary.endsWith(' started')) {
      return this.store.updateRun(run.id, {
        summary: inferExitedRunSummary(run.summary, run.status),
      });
    }
    if (run.status === 'failed' && run.recovery_state === 'recovering') {
      return this.store.updateRun(run.id, {
        recovery_state: 'exhausted',
        summary: 'This run paused before finishing, and progress was kept safe.',
      });
    }
    if (run.status === 'completed' && run.recovery_state === 'recovering') {
      return this.store.updateRun(run.id, {
        recovery_state: 'idle',
      });
    }
    return run;
  }

  getRunReport(runId: string): WorkbenchRunReport | null {
    const run = this.getRunStatus(runId);
    if (!run) return null;
    let report: unknown;
    let context: unknown;
    let contextPath: string | undefined;
    if (run.report_path && existsSync(run.report_path)) {
      if (run.report_path.endsWith('.json')) {
        report = readJsonFile(run.report_path, null);
      } else if (existsSync(run.report_path) && !run.report_path.endsWith('.json')) {
        report = { path: run.report_path };
      }
    }
    if (run.type === 'train') {
      contextPath = join(settings.getPersonaDir(run.persona_slug ?? ''), 'training-context.json');
      if (run.persona_slug && existsSync(contextPath)) {
        context = readJsonFile(contextPath, null);
      } else {
        contextPath = undefined;
      }
    }
    return { run, report, context, context_path: contextPath };
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
      promotion_state: 'idle',
      created_at: new Date().toISOString(),
    }));
  }

  private startCliRun(
    type: WorkbenchRun['type'],
    personaSlug: string | undefined,
    args: string[],
    reportPath?: string,
    options?: {
      env?: Record<string, string>;
      summaryLabel?: string;
      autoRecover?: boolean;
      maxRecoveryAttempts?: number;
    }
  ): WorkbenchRun {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const logDir = join(this.store.baseDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${runId}.log`);
    const summaryLabel = options?.summaryLabel ?? type;
    const maxRecoveryAttempts = options?.autoRecover ? Math.max(0, options?.maxRecoveryAttempts ?? 0) : 0;

    const run = this.store.saveRun({
      id: runId,
      type,
      persona_slug: personaSlug,
      status: 'running',
      recovery_state: 'idle',
      attempt_count: 1,
      started_at: startedAt,
      report_path: reportPath,
      summary: summaryLabel === 'train smoke' ? 'Smoke check started.' : `${summaryLabel} started`,
      log_path: logPath,
      command: [process.execPath, this.cliEntryPath, ...args],
    });

    const launchAttempt = (attemptNumber: number, extraEnv?: Record<string, string>, extraArgs?: string[]) => {
      const child = spawn(process.execPath, [this.cliEntryPath, ...args, ...(extraArgs ?? [])], {
        cwd: this.repoRoot,
        env: { ...process.env, NEEKO_CLI_FORCE_EXIT: '1', ...(options?.env ?? {}), ...(extraEnv ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.store.updateRun(runId, {
        pid: child.pid,
        attempt_count: attemptNumber,
      });

      child.stdout.on('data', (chunk) => {
        writeFileSync(logPath, String(chunk), { flag: 'a' });
      });
      child.stderr.on('data', (chunk) => {
        writeFileSync(logPath, String(chunk), { flag: 'a' });
      });

      child.on('exit', (code) => {
        if (code === 0) {
          this.store.updateRun(runId, {
            status: 'completed',
            recovery_state: 'idle',
            finished_at: new Date().toISOString(),
            summary: attemptNumber > 1
              ? 'Training completed after automatic recovery.'
              : (summaryLabel === 'train smoke' ? 'Smoke check completed.' : `${summaryLabel} completed`),
          });
          return;
        }

        const recoveryPlan = this.planAutomaticRecovery({
          runId,
          type,
          personaSlug,
          summaryLabel,
          attemptNumber,
          maxRecoveryAttempts,
          logPath,
          args,
        });

        if (recoveryPlan) {
          this.store.updateRun(runId, {
            status: 'running',
            recovery_state: 'recovering',
            summary: recoveryPlan.userSummary,
            finished_at: undefined,
          });
          setTimeout(() => launchAttempt(attemptNumber + 1, recoveryPlan.env, recoveryPlan.extraArgs), recoveryPlan.delayMs);
          return;
        }

        this.store.updateRun(runId, {
          status: 'failed',
          recovery_state: maxRecoveryAttempts > 0 ? 'exhausted' : 'idle',
          finished_at: new Date().toISOString(),
          summary: type === 'train'
            ? 'Training paused. Progress has been saved and automatic recovery could not complete.'
            : `${summaryLabel} did not finish. Please try again later.`,
        });
      });

      child.on('error', (error) => {
        writeFileSync(logPath, `${String(error)}\n`, { flag: 'a' });
        const recoveryPlan = this.planAutomaticRecovery({
          runId,
          type,
          personaSlug,
          summaryLabel,
          attemptNumber,
          maxRecoveryAttempts,
          logPath,
          args,
        });
        if (recoveryPlan) {
          this.store.updateRun(runId, {
            status: 'running',
            recovery_state: 'recovering',
            summary: recoveryPlan.userSummary,
          });
          setTimeout(() => launchAttempt(attemptNumber + 1, recoveryPlan.env, recoveryPlan.extraArgs), recoveryPlan.delayMs);
          return;
        }
        this.store.updateRun(runId, {
          status: 'failed',
          recovery_state: maxRecoveryAttempts > 0 ? 'exhausted' : 'idle',
          finished_at: new Date().toISOString(),
          summary: type === 'train'
            ? 'Training could not start. Progress has been kept safe.'
            : `${type} could not start.`,
        });
      });
    };

    launchAttempt(1);

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

  private planAutomaticRecovery(input: {
    runId: string;
    type: WorkbenchRun['type'];
    personaSlug?: string;
    summaryLabel: string;
    attemptNumber: number;
    maxRecoveryAttempts: number;
    logPath: string;
    args: string[];
  }): { env?: Record<string, string>; extraArgs?: string[]; delayMs: number; userSummary: string } | null {
    if (input.type !== 'train') return null;
    if (input.attemptNumber > input.maxRecoveryAttempts) return null;

    const logTail = this.readLogTail(input.logPath, 120) ?? '';
    const resolution = classifyFailure(logTail);
    if (!resolution.retryable) return null;

    const personaDir = input.personaSlug ? settings.getPersonaDir(input.personaSlug) : undefined;
    const checkpointPath = personaDir ? join(personaDir, 'checkpoint_index.json') : undefined;
    const checkpointStore = checkpointPath ? new CheckpointStore(checkpointPath) : null;
    const latestCheckpoint = checkpointStore?.latest() ?? null;
    const hasCheckpointArg = input.args.includes('--from-checkpoint');
    const extraArgs = latestCheckpoint && !hasCheckpointArg ? ['--from-checkpoint', 'latest'] : undefined;
    const env: Record<string, string> = {
      NEEKO_PREFLIGHT_TRAIN_TIMEOUT_MS: process.env.NEEKO_PREFLIGHT_TRAIN_TIMEOUT_MS ?? '60000',
    };

    if (resolution.tag === 'structured_output_failure') {
      env.NEEKO_RELAXED_SCHEMA_MODE = '1';
    }
    if (resolution.tag === 'generation_timeout') {
      env.NEEKO_TRAIN_STAGE_TIMEOUT_MS = process.env.NEEKO_TRAIN_STAGE_TIMEOUT_MS ?? '240000';
    }

    return {
      env,
      extraArgs,
      delayMs: 1200 * input.attemptNumber,
      userSummary: latestCheckpoint
        ? 'System is retrying from saved progress.'
        : 'System is retrying automatically.',
    };
  }
}

function inferExitedRunSummary(summary: string | undefined, status: 'completed' | 'failed'): string {
  if (!summary) {
    return status === 'completed' ? 'Run finished.' : 'This run paused before finishing, and progress was kept safe.';
  }
  if (/started\.?$/.test(summary)) {
    return summary.replace(/started\.?$/, status === 'completed' ? 'completed.' : 'paused.');
  }
  return status === 'completed' ? summary : 'This run paused before finishing, and progress was kept safe.';
}

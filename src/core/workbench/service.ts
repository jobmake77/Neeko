import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, extname, isAbsolute, join } from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
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
import { SoulRenderer } from '../soul/renderer.js';
import {
  buildChatEvidenceBatchFromFile,
  buildStandaloneEvidenceBatch,
  buildVideoTranscriptEvidenceBatch,
  convertEvidenceItemsToDocuments,
  loadEvidenceItemsFromFile,
  loadTargetManifest,
  writeEvidenceArtifacts,
} from '../pipeline/evidence-layer.js';
import { VideoAdapter } from '../pipeline/ingestion/video.js';
import { AgentReachAdapter } from '../pipeline/ingestion/agentreach.js';
import { enrichAttachment } from '../media/attachment-processing.js';
import {
  AttachmentRef,
  CitationItem,
  Conversation,
  ConversationBundle,
  ConversationMessage,
  CultivationSummary,
  CultivationDetail,
  MemoryCandidate,
  PersonaConfig,
  PersonaDetail,
  PersonaMutationResult,
  PersonaSource,
  PersonaSkillSummary,
  PersonaSummary,
  PersonaWorkbenchProfile,
  PromotionHandoff,
  TrainingPrepArtifact,
  SessionSummary,
  WorkbenchEvidenceImport,
  WorkbenchEvidenceImportDetail,
  WorkbenchMemorySourceAsset,
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
  slug?: string;
}

export interface PersonaConfigInput {
  persona_slug?: string;
  name: string;
  sources?: Array<{
    id?: string;
    type: PersonaSource['type'];
    mode?: PersonaSource['mode'];
    platform?: string;
    handle_or_url?: string;
    local_path?: string;
    manifest_path?: string;
    enabled?: boolean;
    last_synced_at?: string;
    last_cursor?: string;
    status?: PersonaSource['status'];
    summary?: string;
  }>;
  update_policy?: PersonaConfig['update_policy'];
  source_type?: PersonaSource['type'];
  source_target?: string;
  source_path?: string;
  target_manifest_path?: string;
  platform?: string;
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

function validateWorkbenchFilePath(path: string, label: string, options?: { requireJson?: boolean }): void {
  const normalized = path.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (!isAbsolute(normalized)) {
    throw new Error(`${label} must use an absolute local path`);
  }
  if (!existsSync(normalized)) {
    throw new Error(`${label} is not available right now`);
  }
  const stats = statSync(normalized);
  if (!stats.isFile()) {
    throw new Error(`${label} must point to a file`);
  }
  if (options?.requireJson && extname(normalized).toLowerCase() !== '.json') {
    throw new Error(`${label} must be a json file`);
  }
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function slugifyPersonaName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'persona';
}

function detectConfigSourceType(source: string | undefined): PersonaConfig['source_type'] {
  if (!source) return 'social';
  if (!isAbsolute(source)) return 'social';
  const extension = extname(source).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm'].includes(extension)) return 'video_file';
  return 'chat_file';
}

function createSourceId(): string {
  return crypto.randomUUID();
}

function normalizePersonaSource(input: PersonaConfigInput['sources'] extends Array<infer T> ? T : never): PersonaSource {
  return {
    id: input.id?.trim() || createSourceId(),
    type: input.type,
    mode: input.mode ?? (
      input.type === 'social'
        ? 'handle'
        : (input.local_path?.trim() ? 'local_file' : 'remote_url')
    ),
    platform: input.platform?.trim() || undefined,
    handle_or_url: input.handle_or_url?.trim() || undefined,
    local_path: input.local_path?.trim() || undefined,
    manifest_path: input.manifest_path?.trim() || undefined,
    enabled: input.enabled !== false,
    last_synced_at: input.last_synced_at,
    last_cursor: input.last_cursor?.trim() || undefined,
    status: input.status ?? 'idle',
    summary: input.summary?.trim() || undefined,
  };
}

function buildLegacySourceFromConfig(config: {
  source_type?: PersonaSource['type'];
  source_target?: string;
  source_path?: string;
  target_manifest_path?: string;
  platform?: string;
}): PersonaSource | null {
  if (!config.source_type) return null;
  return {
    id: createSourceId(),
    type: config.source_type,
    mode: config.source_type === 'social'
      ? 'handle'
      : (config.source_path?.trim() ? 'local_file' : 'remote_url'),
    platform: config.platform?.trim() || undefined,
    handle_or_url: config.source_target?.trim() || undefined,
    local_path: config.source_path?.trim() || undefined,
    manifest_path: config.target_manifest_path?.trim() || undefined,
    enabled: true,
    status: 'idle',
  };
}

function normalizePersonaConfigInput(input: PersonaConfigInput, now: string): { name: string; sources: PersonaSource[]; update_policy: PersonaConfig['update_policy'] } {
  const normalizedSources = (input.sources ?? [])
    .map((item) => normalizePersonaSource(item))
    .filter((item) => Boolean(item.handle_or_url || item.local_path));
  if (normalizedSources.length > 0) {
    return {
      name: input.name.trim(),
      sources: normalizedSources,
      update_policy: {
        auto_check_remote: input.update_policy?.auto_check_remote ?? true,
        check_interval_minutes: input.update_policy?.check_interval_minutes ?? 60,
        strategy: 'incremental',
        last_checked_at: input.update_policy?.last_checked_at,
        latest_result: input.update_policy?.latest_result,
      },
    };
  }

  const legacy = buildLegacySourceFromConfig({
    source_type: input.source_type,
    source_target: input.source_target,
    source_path: input.source_path,
    target_manifest_path: input.target_manifest_path,
    platform: input.platform,
  });
  return {
    name: input.name.trim(),
    sources: legacy ? [legacy] : [],
    update_policy: {
      auto_check_remote: input.update_policy?.auto_check_remote ?? true,
      check_interval_minutes: input.update_policy?.check_interval_minutes ?? 60,
      strategy: 'incremental',
      last_checked_at: input.update_policy?.last_checked_at,
      latest_result: input.update_policy?.latest_result,
    },
  };
}

function summarizeSources(sources: PersonaSource[]): { total_sources: number; enabled_sources: number; source_types: string[] } {
  return {
    total_sources: sources.length,
    enabled_sources: sources.filter((item) => item.enabled).length,
    source_types: Array.from(new Set(sources.map((item) => item.type))),
  };
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

function chooseEvidencePreviewItems(items: EvidenceItem[], limit = 6): EvidenceItem[] {
  return [...items]
    .sort((a, b) => scoreEvidencePreviewItem(b) - scoreEvidencePreviewItem(a))
    .slice(0, limit);
}

function scoreEvidencePreviewItem(item: EvidenceItem): number {
  let score = 0;
  if (item.window_role === 'target_centered') score += 5;
  if (item.speaker_role === 'target') score += 4;
  if (item.stability_hints.cross_session_stable) score += 4;
  if (item.scene === 'work' || item.scene === 'public') score += 2;
  if (item.scene === 'intimate' || item.scene === 'conflict') score -= 3;
  score += Math.min(3, item.stability_hints.repeated_in_sessions ?? 0);
  return score;
}

function readPreviewFromPath(path?: string, maxChars = 900): string | undefined {
  if (!path || !existsSync(path) || !statSync(path).isFile()) return undefined;
  try {
    const content = readFileSync(path, 'utf-8').replace(/\s+/g, ' ').trim();
    if (!content) return undefined;
    return content.length <= maxChars ? content : `${content.slice(0, maxChars).trimEnd()}...`;
  } catch {
    return undefined;
  }
}

async function buildAttachmentPriorityContext(attachments: AttachmentRef[]): Promise<string> {
  if (!attachments.length) return '';

  const readyItems = attachments
    .filter((item) => item.processing_status === 'ready' && item.processing_summary)
    .map((item) => {
      const provider = item.processing_provider ? ` via ${item.processing_provider}` : '';
      return `- [${item.type}] ${item.name}${provider}\n${item.processing_summary}`;
    });

  const blockedItems = attachments
    .filter((item) => item.processing_status === 'error' || item.processing_status === 'unsupported')
    .map((item) => `- [${item.type}] ${item.name}: ${item.processing_error ?? '附件当前不可用。'}`);

  const sections: string[] = [
    'Current-turn attachment context has higher priority than retrieved memories.',
    'If the user asks about attached files, answer from the attachment facts first, then keep the persona tone and style.',
  ];

  if (readyItems.length > 0) {
    sections.push('Attachment facts:\n' + readyItems.join('\n\n'));
  }
  if (blockedItems.length > 0) {
    sections.push('Attachment processing issues:\n' + blockedItems.join('\n'));
  }

  return sections.join('\n\n');
}

function buildAttachmentUserMessage(message: string, attachments: AttachmentRef[]): string {
  const readyItems = attachments
    .filter((item) => item.processing_status === 'ready' && item.processing_summary)
    .map((item) => `- [${item.type}] ${item.name}\n${item.processing_summary}`);

  if (readyItems.length === 0) return message;

  return [
    'You must answer the user from the attached-file facts first.',
    'Only after grounding the reply in the attachments should you preserve persona tone and wording style.',
    '',
    'Attached-file facts:',
    readyItems.join('\n\n'),
    '',
    `User request: ${message}`,
  ].join('\n');
}

function hasReadyAttachmentFacts(attachments: AttachmentRef[]): boolean {
  return attachments.some((item) => item.processing_status === 'ready' && item.processing_summary);
}

function getConfiguredSecret(settingKey: 'geminiApiKey'): string {
  const configured = String(settings.get(settingKey) ?? '').trim();
  if (configured) return configured;
  return String(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '').trim();
}

async function generateGeminiAttachmentReply(
  soul: Soul,
  message: string,
  attachments: AttachmentRef[],
  history: ConversationMessage[],
): Promise<string | null> {
  const geminiKey = getConfiguredSecret('geminiApiKey');
  if (!geminiKey) return null;

  const renderer = new SoulRenderer();
  const attachmentPriorityContext = await buildAttachmentPriorityContext(attachments);
  const recentHistory = history
    .slice(-4)
    .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content}`)
    .join('\n');

  const prompt = [
    renderer.renderCompact(soul),
    attachmentPriorityContext,
    'Respond in the persona voice, but ground the answer in the attachment facts first.',
    recentHistory ? `Recent conversation:\n${recentHistory}` : '',
    `User request: ${message}`,
  ].filter(Boolean).join('\n\n');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return null;
  }
  const text = (payload?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || null;
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
    return this.listAllPersonaSummaries();
  }

  listCultivatingPersonas(): PersonaSummary[] {
    return this.listAllPersonaSummaries().filter((p) => !this.isPersonaReady(p));
  }

  private listAllPersonaSummaries(): PersonaSummary[] {
    const personasDir = join(settings.getDataDir(), 'personas');
    if (!existsSync(personasDir)) return [];
    return readdirSync(personasDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.buildPersonaSummary(entry.name))
      .filter((item): item is PersonaSummary => Boolean(item))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  private isPersonaReady(summary: PersonaSummary): boolean {
    return summary.status === 'converged' || summary.status === 'exported';
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

  getPersonaDetail(slug: string): PersonaDetail {
    const persona = this.readPersonaSummary(slug) ?? this.readPersonaConfigSummary(slug);
    if (!persona) {
      throw new Error(`Persona "${slug}" not found.`);
    }
    const config = this.getPersonaConfig(slug);
    return {
      persona,
      config,
      cultivation_summary: this.buildCultivationSummary(slug, persona),
      sources_summary: summarizeSources(config.sources),
    };
  }

  getPersonaConfig(slug: string): PersonaConfig {
    const stored = this.store.getPersonaConfig(slug);
    if (stored) {
      if (stored.sources.length === 0) {
        const legacySource = buildLegacySourceFromConfig(stored);
        const migrated: PersonaConfig = {
          ...stored,
          sources: legacySource ? [legacySource] : [],
          update_policy: stored.update_policy ?? {
            auto_check_remote: true,
            check_interval_minutes: 60,
            strategy: 'incremental',
          },
        };
        this.store.savePersonaConfig(migrated);
        return migrated;
      }
      return stored;
    }

    const personaPath = join(settings.getPersonaDir(slug), 'persona.json');
    if (!existsSync(personaPath)) {
      throw new Error(`Persona "${slug}" not found.`);
    }
    const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8')));
    const primarySource = persona.source_targets[0];
    const sourceType = detectConfigSourceType(primarySource);
    const inferred: PersonaConfig = {
      persona_slug: persona.slug,
      name: persona.name,
      sources: [{
        id: createSourceId(),
        type: sourceType,
        mode: sourceType === 'social' ? 'handle' : 'local_file',
        handle_or_url: sourceType === 'social' ? primarySource : undefined,
        local_path: sourceType === 'social' ? undefined : primarySource,
        manifest_path: undefined,
        platform: sourceType === 'social' ? 'x' : undefined,
        enabled: true,
        status: 'idle',
      }],
      update_policy: {
        auto_check_remote: true,
        check_interval_minutes: 60,
        strategy: 'incremental',
      },
      updated_at: persona.updated_at,
    };
    this.store.savePersonaConfig(inferred);
    return inferred;
  }

  createPersonaFromConfig(input: PersonaConfigInput): PersonaMutationResult {
    const now = new Date().toISOString();
    const slug = input.persona_slug?.trim() || this.buildAvailablePersonaSlug(input.name);
    const normalized = normalizePersonaConfigInput(input, now);
    const config: PersonaConfig = {
      persona_slug: slug,
      name: normalized.name,
      sources: normalized.sources,
      update_policy: normalized.update_policy,
      updated_at: now,
    };
    this.validatePersonaConfig(config);
    this.store.savePersonaConfig(config);

    const run = this.startCreateRunFromConfig(config);
    this.schedulePostCreateSourceSync(config, run.id);
    return {
      persona: this.readPersonaConfigSummary(slug) ?? this.readPersonaSummary(slug) ?? {
        slug,
        name: config.name,
        status: 'creating',
        doc_count: 0,
        memory_node_count: 0,
        training_rounds: 0,
        updated_at: config.updated_at,
      },
      run,
    };
  }

  async updatePersona(slug: string, input: PersonaConfigInput): Promise<PersonaMutationResult> {
    const current = this.getPersonaConfig(slug);
    const normalized = normalizePersonaConfigInput({
      ...current,
      ...input,
      name: input.name?.trim() || current.name,
      sources: input.sources ?? current.sources,
      update_policy: input.update_policy ?? current.update_policy,
    }, new Date().toISOString());
    const nextConfig: PersonaConfig = {
      ...current,
      persona_slug: slug,
      name: normalized.name,
      sources: normalized.sources,
      update_policy: normalized.update_policy,
      updated_at: new Date().toISOString(),
    };
    this.validatePersonaConfig(nextConfig);
    this.store.savePersonaConfig(nextConfig);
    await this.preparePersonaRebuild(slug);
    this.markPersonaUpdating(slug);
    const run = this.startCreateRunFromConfig(nextConfig);
    this.schedulePostCreateSourceSync(nextConfig, run.id);
    return {
      persona: this.readPersonaSummary(slug) ?? this.readPersonaConfigSummary(slug) ?? {
        slug,
        name: nextConfig.name,
        status: 'updating',
        doc_count: 0,
        memory_node_count: 0,
        training_rounds: 0,
        updated_at: nextConfig.updated_at,
      },
      run,
    };
  }

  async deletePersona(slug: string): Promise<boolean> {
    const personaSummary = this.readPersonaSummary(slug) ?? this.readPersonaConfigSummary(slug);
    if (!personaSummary) {
      return false;
    }

    this.store.deleteConversationsByPersona(slug);
    this.store.deletePromotionHandoffsByPersona(slug);
    this.store.deleteEvidenceImportsByPersona(slug);
    this.store.deleteTrainingPrepsByPersona(slug);
    this.store.deleteRunsByPersona(slug);

    const config = this.store.getPersonaConfig(slug);
    this.store.deletePersonaConfig(slug);

    const personaPath = join(settings.getPersonaDir(slug), 'persona.json');
    if (existsSync(personaPath)) {
      const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8')));
      await this.deleteMemoryCollection(persona.memory_collection);
    } else if (config) {
      await this.deleteMemoryCollection(`nico_${slug}`);
    }

    const personaDir = settings.getPersonaDir(slug);
    if (existsSync(personaDir)) {
      rmSync(personaDir, { recursive: true, force: true });
    }
    return true;
  }

  getPersonaSources(slug: string): PersonaSource[] {
    return this.getPersonaConfig(slug).sources;
  }

  async updatePersonaSources(
    slug: string,
    input: { sources: PersonaConfigInput['sources']; name?: string; update_policy?: PersonaConfig['update_policy'] }
  ): Promise<PersonaMutationResult> {
    return this.updatePersona(slug, {
      name: input.name ?? this.getPersonaConfig(slug).name,
      sources: input.sources,
      update_policy: input.update_policy,
    });
  }

  listConversations(personaSlug: string): Conversation[] {
    return this.store.listConversations(personaSlug);
  }

  async getMemoryNode(personaSlug: string, nodeId: string): Promise<MemoryNode | null> {
    const { persona } = this.loadPersonaAssets(personaSlug);
    const store = this.createMemoryStore();
    try {
      await store.ensureCollection(persona.memory_collection);
    } catch {
      return null;
    }
    return store.getById(persona.memory_collection, nodeId);
  }

  async getMemoryNodeSourceAssets(personaSlug: string, nodeId: string): Promise<WorkbenchMemorySourceAsset[]> {
    const node = await this.getMemoryNode(personaSlug, nodeId);
    if (!node) return [];

    const assets: WorkbenchMemorySourceAsset[] = [];
    const seen = new Set<string>();
    const add = (asset: WorkbenchMemorySourceAsset) => {
      const key = JSON.stringify([asset.kind, asset.id ?? '', asset.path ?? '', asset.url ?? '', asset.title]);
      if (seen.has(key)) return;
      seen.add(key);
      assets.push(asset);
    };

    const sourceUrl = node.source_url?.trim();
    const evidenceImports = this.store.listEvidenceImports(personaSlug);
    const trainingPreps = this.store.listTrainingPrepArtifacts(personaSlug);
    const handoffs = this.store.listPromotionHandoffs(personaSlug);

    if (sourceUrl) {
      if (/^https?:\/\//i.test(sourceUrl)) {
        add({
          kind: 'web_url',
          title: 'Source URL',
          summary: sourceUrl,
          url: sourceUrl,
          badges: [node.source_type],
        });
      } else if (isAbsolute(sourceUrl)) {
        add({
          kind: 'local_file',
          title: 'Local Source File',
          summary: sourceUrl,
          path: sourceUrl,
          preview: readPreviewFromPath(sourceUrl),
          badges: [node.source_type, existsSync(sourceUrl) ? 'available' : 'missing'],
        });
      } else if (sourceUrl.startsWith('workbench:handoff:')) {
        const handoffId = sourceUrl.slice('workbench:handoff:'.length);
        const handoff = handoffs.find((item) => item.id === handoffId);
        if (handoff) {
          add({
            kind: 'promotion_handoff',
            title: 'Promotion Handoff',
            summary: handoff.summary,
            id: handoff.id,
            preview: renderPromotionHandoffMarkdown(handoff),
            badges: [handoff.status, `${handoff.items.length} items`],
            metadata: {
              conversation_id: handoff.conversation_id,
              updated_at: handoff.updated_at,
            },
          });
          trainingPreps
            .filter((item) => item.handoff_id === handoff.id)
            .forEach((prep) => {
              add({
                kind: 'training_prep',
                title: 'Training Prep',
                summary: prep.summary,
                id: prep.id,
                path: prep.documents_path,
                preview: readPreviewFromPath(prep.documents_path) ?? readPreviewFromPath(prep.evidence_index_path),
                badges: [prep.status, `${prep.item_count} docs`],
                metadata: {
                  evidence_index_path: prep.evidence_index_path,
                  updated_at: prep.updated_at,
                },
              });
            });
        }
      }
    }

    evidenceImports
      .filter((item) =>
        item.source_path === sourceUrl ||
        item.artifacts.documents_path === sourceUrl ||
        item.artifacts.evidence_index_path === sourceUrl
      )
      .forEach((item) => {
        add({
          kind: 'evidence_import',
          title: 'Evidence Import',
          summary: item.summary,
          id: item.id,
          path: item.artifacts.documents_path,
          preview:
            readPreviewFromPath(item.artifacts.documents_path) ??
            readPreviewFromPath(item.artifacts.evidence_index_path) ??
            readPreviewFromPath(item.source_path),
          badges: [item.source_kind, `${item.stats.windows} windows`, `${item.stats.cross_session_stable_items} stable`],
          metadata: {
            evidence_index_path: item.artifacts.evidence_index_path,
            source_path: item.source_path,
            updated_at: item.updated_at,
          },
        });
      });

    trainingPreps
      .filter((item) => item.documents_path === sourceUrl || item.evidence_index_path === sourceUrl)
      .forEach((item) => {
        add({
          kind: 'training_prep',
          title: 'Training Prep',
          summary: item.summary,
          id: item.id,
          path: item.documents_path,
          preview: readPreviewFromPath(item.documents_path) ?? readPreviewFromPath(item.evidence_index_path),
          badges: [item.status, `${item.item_count} docs`],
          metadata: {
            evidence_index_path: item.evidence_index_path,
            updated_at: item.updated_at,
          },
        });
      });

    if (assets.length === 0) {
      add({
        kind: 'synthetic',
        title: 'No linked source asset yet',
        summary:
          node.source_type === 'custom'
            ? 'This memory was synthesized during training or workbench adaptation, so it may not map to a single source asset.'
            : 'This memory node currently exposes source metadata, but not a deeper linked asset yet.',
        badges: [node.source_type],
        metadata: sourceUrl ? { source_url: sourceUrl } : undefined,
      });
    }

    return assets;
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

  async sendMessage(conversationId: string, message: string, attachments: AttachmentRef[] = []): Promise<ConversationBundle> {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation "${conversationId}" not found.`);

    const { persona, soul } = this.loadPersonaAssets(conversation.persona_slug);
    const history = this.store.listMessages(conversationId);
    const processedAttachments = await Promise.all(attachments.map((item) => enrichAttachment(item)));
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
      attachments: processedAttachments,
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

  getEvidenceImportDetail(importId: string): WorkbenchEvidenceImportDetail | null {
    const entry = this.store.getEvidenceImport(importId);
    if (!entry) return null;

    const manifestPath = entry.artifacts.target_manifest_path ?? entry.target_manifest_path;
    const manifest = manifestPath && existsSync(manifestPath)
      ? loadTargetManifest(manifestPath)
      : null;
    const items = loadEvidenceItemsFromFile(entry.artifacts.evidence_index_path);

    return {
      import: entry,
      manifest,
      sample_items: chooseEvidencePreviewItems(items),
    };
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
    validateWorkbenchFilePath(input.sourcePath, 'sourcePath');
    validateWorkbenchFilePath(input.targetManifestPath, 'targetManifestPath', { requireJson: true });
    if (input.sourcePath.trim() === input.targetManifestPath.trim()) {
      throw new Error('sourcePath and targetManifestPath must be different files');
    }
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

  async checkPersonaUpdates(slug: string): Promise<{ imports: WorkbenchEvidenceImport[]; run: WorkbenchRun | null; summary: string }> {
    const activeRun = this.getActivePersonaRun(slug);
    if (activeRun) {
      return { imports: [], run: activeRun, summary: 'A cultivation job is already running for this persona.' };
    }
    const config = this.getPersonaConfig(slug);
    const imports = await this.syncPersonaSources(slug, config, { includeLocal: false, forceRemote: false });
    return this.finalizeSourceSync(slug, config, imports, 'Checked remote sources.');
  }

  async continueCultivationFromSources(slug: string): Promise<{ imports: WorkbenchEvidenceImport[]; run: WorkbenchRun | null; summary: string }> {
    const activeRun = this.getActivePersonaRun(slug);
    if (activeRun) {
      return { imports: [], run: activeRun, summary: 'A cultivation job is already running for this persona.' };
    }
    const config = this.getPersonaConfig(slug);
    const imports = await this.syncPersonaSources(slug, config, { includeLocal: true, forceRemote: true });
    return this.finalizeSourceSync(slug, config, imports, 'Continued cultivation from configured sources.');
  }

  getRuntimeModelConfig(): RuntimeModelConfig {
    const activeProvider = (settings.get('activeProvider') ?? 'claude') as RuntimeModelConfig['provider'];
    return {
      provider: activeProvider,
      model: String(settings.get('defaultModel') ?? 'claude-sonnet-4-6'),
      api_keys: {
        claude: settings.get('anthropicApiKey') ?? '',
        openai: settings.get('openaiApiKey') ?? '',
        kimi: settings.get('kimiApiKey') ?? '',
        gemini: settings.get('geminiApiKey') ?? '',
        deepseek: settings.get('deepseekApiKey') ?? '',
      },
    };
  }

  updateRuntimeModelConfig(input: RuntimeModelConfig): RuntimeModelConfig {
    settings.set('activeProvider', input.provider);
    settings.set('defaultModel', input.model);
    settings.set('anthropicApiKey', input.api_keys.claude ?? '');
    settings.set('openaiApiKey', input.api_keys.openai ?? '');
    settings.set('kimiApiKey', input.api_keys.kimi ?? '');
    settings.set('geminiApiKey', input.api_keys.gemini ?? '');
    settings.set('deepseekApiKey', input.api_keys.deepseek ?? '');
    return this.getRuntimeModelConfig();
  }

  getRuntimeSettings(): RuntimeSettingsPayload {
    return {
      default_training_profile: settings.get('defaultTrainingProfile'),
      default_input_routing_strategy: settings.get('defaultInputRoutingStrategy'),
      qdrant_url: settings.get('qdrantUrl'),
      data_dir: settings.get('neekoDataDir'),
    };
  }

  updateRuntimeSettings(input: RuntimeSettingsPayload): RuntimeSettingsPayload {
    if (input.default_training_profile !== undefined) settings.set('defaultTrainingProfile', input.default_training_profile);
    if (input.default_input_routing_strategy !== undefined) settings.set('defaultInputRoutingStrategy', input.default_input_routing_strategy);
    if (input.qdrant_url !== undefined) settings.set('qdrantUrl', input.qdrant_url);
    if (input.data_dir !== undefined) settings.set('neekoDataDir', input.data_dir);
    return this.getRuntimeSettings();
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

  private async syncPersonaSources(
    slug: string,
    config: PersonaConfig,
    options: { includeLocal: boolean; forceRemote: boolean }
  ): Promise<WorkbenchEvidenceImport[]> {
    const imports: WorkbenchEvidenceImport[] = [];
    for (const source of config.sources.filter((item) => item.enabled)) {
      if (source.type === 'chat_file' || (source.type === 'video_file' && source.mode === 'local_file')) {
        if (!options.includeLocal) continue;
      }
      const imported = await this.syncSinglePersonaSource(slug, config, source, options);
      if (imported) imports.push(imported);
    }
    return imports;
  }

  private async syncSinglePersonaSource(
    slug: string,
    config: PersonaConfig,
    source: PersonaSource,
    options: { includeLocal: boolean; forceRemote: boolean }
  ): Promise<WorkbenchEvidenceImport | null> {
    if (source.type === 'chat_file') {
      if (!source.local_path || !source.manifest_path) return null;
      return this.importEvidence({
        personaSlug: slug,
        sourceKind: 'chat',
        sourcePath: source.local_path,
        targetManifestPath: source.manifest_path,
        chatPlatform: (source.platform as 'wechat' | 'feishu' | undefined) ?? 'wechat',
      });
    }

    if (source.type === 'video_file' && source.mode === 'local_file') {
      if (!source.local_path || !source.manifest_path) return null;
      return this.importEvidence({
        personaSlug: slug,
        sourceKind: 'video',
        sourcePath: source.local_path,
        targetManifestPath: source.manifest_path,
      });
    }

    const maybeImport = await this.importRemoteSource(slug, config, source, options.forceRemote);
    return maybeImport;
  }

  private async importRemoteSource(
    slug: string,
    config: PersonaConfig,
    source: PersonaSource,
    forceRemote: boolean
  ): Promise<WorkbenchEvidenceImport | null> {
    const now = new Date();
    const checkInterval = (config.update_policy.check_interval_minutes ?? 60) * 60 * 1000;
    if (!forceRemote && source.last_synced_at) {
      const last = new Date(source.last_synced_at).getTime();
      if (Number.isFinite(last) && now.getTime() - last < checkInterval) {
        return null;
      }
    }

    let docs: RawDocument[] = [];
    let sourcePlatform = source.platform ?? source.type;
    if (source.type === 'social' && source.handle_or_url) {
      const adapter = new AgentReachAdapter('twitter');
      const since = source.last_synced_at ? new Date(source.last_synced_at) : undefined;
      docs = await adapter.fetch(source.handle_or_url, { limit: 100, since });
      sourcePlatform = source.platform ?? 'twitter';
    } else if (source.type === 'video_file' && source.handle_or_url) {
      const adapter = new VideoAdapter(settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY);
      const since = source.last_synced_at ? new Date(source.last_synced_at) : undefined;
      docs = await adapter.fetch(source.handle_or_url, { limit: 12, since });
      sourcePlatform = source.platform ?? docs[0]?.source_platform ?? 'video_remote';
    } else if (source.handle_or_url) {
      const adapter = new AgentReachAdapter('article');
      docs = await adapter.fetch(source.handle_or_url, { limit: 1 });
      sourcePlatform = source.platform ?? 'web';
    }

    if (docs.length === 0) {
      this.touchSourceSyncState(slug, config, source.id, {
        last_synced_at: now.toISOString(),
        status: 'ready',
        summary: 'No new source content.',
      });
      return null;
    }

    const cursor = createHash('sha1')
      .update(JSON.stringify(docs.map((item) => [item.source_url, item.published_at, item.content.slice(0, 120)])))
      .digest('hex');
    if (!forceRemote && source.last_cursor && source.last_cursor === cursor) {
      this.touchSourceSyncState(slug, config, source.id, {
        last_synced_at: now.toISOString(),
        status: 'ready',
        summary: 'No source delta detected.',
      });
      return null;
    }

    const manifest = {
      target_name: config.name,
      target_aliases: source.type === 'social' && source.handle_or_url ? [source.handle_or_url.replace(/^@/, ''), source.handle_or_url] : [config.name],
      self_aliases: [],
      known_other_aliases: [],
    };
    const batch = buildStandaloneEvidenceBatch(docs, { manifest, sourceLabel: sourcePlatform });
    const importId = crypto.randomUUID();
    const importDir = join(this.store.getEvidenceImportsDir(), importId);
    mkdirSync(importDir, { recursive: true });
    const artifacts = writeEvidenceArtifacts(importDir, batch, manifest);
    const documentsPath = join(importDir, 'documents.json');
    writeFileSync(documentsPath, JSON.stringify(docs, null, 2), 'utf-8');

    const imported = this.store.saveEvidenceImport({
      id: importId,
      persona_slug: slug,
      source_kind: source.type === 'social' ? 'chat' : 'video',
      source_platform: sourcePlatform,
      source_path: source.handle_or_url ?? source.local_path ?? '',
      target_manifest_path: source.manifest_path ?? '',
      status: 'completed',
      item_count: batch.items.length,
      summary: `Imported ${docs.length} new items from ${sourcePlatform}.`,
      stats: batch.stats,
      artifacts: {
        ...artifacts,
        documents_path: documentsPath,
      },
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    this.touchSourceSyncState(slug, config, source.id, {
      last_synced_at: now.toISOString(),
      last_cursor: cursor,
      status: 'ready',
      summary: imported.summary,
    });
    return imported;
  }

  private touchSourceSyncState(
    slug: string,
    config: PersonaConfig,
    sourceId: string,
    patch: Partial<PersonaSource>
  ): void {
    const nextConfig: PersonaConfig = {
      ...config,
      sources: config.sources.map((item) => item.id === sourceId ? { ...item, ...patch } : item),
      update_policy: {
        ...config.update_policy,
        last_checked_at: new Date().toISOString(),
        latest_result: patch.summary ?? config.update_policy.latest_result,
      },
      updated_at: new Date().toISOString(),
    };
    this.store.savePersonaConfig(nextConfig);
  }

  private finalizeSourceSync(
    slug: string,
    config: PersonaConfig,
    imports: WorkbenchEvidenceImport[],
    fallbackSummary: string
  ): { imports: WorkbenchEvidenceImport[]; run: WorkbenchRun | null; summary: string } {
    if (imports.length === 0) {
      const nextConfig: PersonaConfig = {
        ...config,
        update_policy: {
          ...config.update_policy,
          last_checked_at: new Date().toISOString(),
          latest_result: 'No new source content.',
        },
      };
      this.store.savePersonaConfig(nextConfig);
      return { imports, run: null, summary: fallbackSummary };
    }

    const prep = this.createTrainingPrepFromEvidenceImports(slug, imports);
    const run = this.startTraining({
      slug,
      mode: 'quick',
      rounds: 1,
      track: 'full_serial',
      prepDocumentsPath: prep.documents_path,
      prepEvidencePath: prep.evidence_index_path,
      prepArtifactId: prep.id,
    });
    return {
      imports,
      run,
      summary: `Imported ${imports.length} updated source batches and started continued cultivation.`,
    };
  }

  private getActivePersonaRun(slug: string): WorkbenchRun | null {
    return this.listRuns(slug).find((run) =>
      (run.type === 'create' || run.type === 'train') &&
      (run.status === 'running' || run.status === 'queued')
    ) ?? null;
  }

  private schedulePostCreateSourceSync(config: PersonaConfig, createRunId: string): void {
    const enabledSources = config.sources.filter((item) => item.enabled);
    if (enabledSources.length <= 1) return;

    const primarySource = config.sources.find((item) => item.enabled) ?? config.sources[0];
    const followupSourceIds = enabledSources
      .filter((item) => item.id !== primarySource?.id)
      .map((item) => item.id);
    if (followupSourceIds.length === 0) return;

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const run = this.getRunStatus(createRunId);
      if (!run || run.status === 'failed') {
        clearInterval(timer);
        return;
      }
      if (run.status !== 'completed') {
        if (Date.now() - startedAt > 30 * 60 * 1000) {
          clearInterval(timer);
        }
        return;
      }
      clearInterval(timer);
      void this.continueCultivationFromSelectedSources(config.persona_slug, followupSourceIds).catch(() => undefined);
    }, 4000);
  }

  private async continueCultivationFromSelectedSources(
    slug: string,
    sourceIds: string[]
  ): Promise<{ imports: WorkbenchEvidenceImport[]; run: WorkbenchRun | null; summary: string }> {
    const activeRun = this.getActivePersonaRun(slug);
    if (activeRun) {
      return { imports: [], run: activeRun, summary: 'A cultivation job is already running for this persona.' };
    }

    const config = this.getPersonaConfig(slug);
    const selectedSources = config.sources.filter((item) => item.enabled && sourceIds.includes(item.id));
    if (selectedSources.length === 0) {
      return { imports: [], run: null, summary: 'No additional sources were selected for cultivation.' };
    }

    const imports: WorkbenchEvidenceImport[] = [];
    for (const source of selectedSources) {
      const imported = await this.syncSinglePersonaSource(slug, config, source, {
        includeLocal: true,
        forceRemote: true,
      });
      if (imported) imports.push(imported);
    }

    return this.finalizeSourceSync(
      slug,
      config,
      imports,
      'No new source content was available for additional cultivation.'
    );
  }

  private createTrainingPrepFromEvidenceImports(personaSlug: string, imports: WorkbenchEvidenceImport[]): TrainingPrepArtifact {
    const prepId = crypto.randomUUID();
    const prepDir = join(this.store.getTrainingPrepDir(), prepId);
    mkdirSync(prepDir, { recursive: true });
    const docs = imports.flatMap((item) => readJsonFile<RawDocument[]>(item.artifacts.documents_path, []));
    const now = new Date().toISOString();
    const prepBatch = buildStandaloneEvidenceBatch(docs, { sourceLabel: 'workbench_source_pool' });
    const batchArtifacts = writeEvidenceArtifacts(prepDir, prepBatch);
    const documentsPath = join(prepDir, 'documents.json');
    writeFileSync(documentsPath, JSON.stringify(docs, null, 2), 'utf-8');
    return this.store.saveTrainingPrepArtifact({
      id: prepId,
      persona_slug: personaSlug,
      status: 'drafted',
      item_count: docs.length,
      summary: `Training prep synthesized from ${imports.length} source batches.`,
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
    if (input.slug) args.push('--slug', input.slug);
    if (typeof input.rounds === 'number') args.push('--rounds', String(input.rounds));
    if (input.trainingProfile) args.push('--training-profile', input.trainingProfile);
    if (input.inputRouting) args.push('--input-routing', input.inputRouting);
    if (input.trainingSeedMode) args.push('--training-seed-mode', input.trainingSeedMode);
    if (input.kimiStabilityMode) args.push('--kimi-stability-mode', input.kimiStabilityMode);
    return this.startCliRun('create', input.slug, args);
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

  private validatePersonaConfig(config: PersonaConfig): void {
    if (!config.name.trim()) throw new Error('name is required');
    if (config.sources.length === 0) throw new Error('at least one source is required');
    const enabledSources = config.sources.filter((item) => item.enabled);
    if (enabledSources.length === 0) throw new Error('at least one enabled source is required');
    for (const source of enabledSources) {
      if (source.type === 'social' && !source.handle_or_url?.trim()) {
        throw new Error('social source requires handle_or_url');
      }
      if ((source.type === 'chat_file' || source.type === 'video_file') && source.mode === 'local_file' && !source.local_path?.trim()) {
        throw new Error(`${source.type} local source requires local_path`);
      }
      if ((source.type === 'chat_file' || source.type === 'video_file') && source.mode !== 'local_file' && !source.handle_or_url?.trim()) {
        throw new Error(`${source.type} remote source requires handle_or_url`);
      }
      if (source.type === 'chat_file' && !source.manifest_path?.trim()) {
        throw new Error('chat_file source requires manifest_path');
      }
      if (source.type === 'video_file' && source.mode === 'local_file' && !source.manifest_path?.trim()) {
        throw new Error('video_file local source requires manifest_path');
      }
    }
  }

  private buildAvailablePersonaSlug(name: string): string {
    const base = slugifyPersonaName(name);
    const personasDir = join(settings.getDataDir(), 'personas');
    const existing = existsSync(personasDir)
      ? new Set(
        readdirSync(personasDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      )
      : new Set<string>();
    let slug = base;
    let counter = 1;
    while (existing.has(slug)) {
      slug = `${base}-${counter++}`;
    }
    return slug;
  }

  private startCreateRunFromConfig(config: PersonaConfig): WorkbenchRun {
    const input = this.mapPersonaConfigToCreateInput(config);
    return this.createPersona({
      ...input,
      slug: config.persona_slug,
      rounds: 1,
    });
  }

  private mapPersonaConfigToCreateInput(config: PersonaConfig): WorkbenchCreateInput {
    const primarySource = config.sources.find((item) => item.enabled) ?? config.sources[0];
    if (!primarySource) {
      throw new Error('No available source configured for this persona.');
    }
    if (primarySource.type === 'social') {
      return {
        target: primarySource.handle_or_url,
      };
    }
    return {
      target: primarySource.mode === 'local_file' ? primarySource.local_path : primarySource.handle_or_url,
      targetManifest: primarySource.manifest_path,
      chatPlatform: primarySource.type === 'chat_file'
        ? (primarySource.platform as 'wechat' | 'feishu' | undefined) ?? 'wechat'
        : undefined,
    };
  }

  private readPersonaConfigSummary(slug: string): PersonaSummary | null {
    const config = this.store.getPersonaConfig(slug);
    if (!config) return null;
    return {
      slug: config.persona_slug,
      name: config.name,
      status: existsSync(join(settings.getPersonaDir(slug), 'persona.json')) ? 'available' : 'creating',
      doc_count: 0,
      memory_node_count: 0,
      training_rounds: 0,
      updated_at: config.updated_at,
    };
  }

  private buildCultivationSummary(slug: string, persona: PersonaSummary): CultivationSummary {
    const config = this.getPersonaConfig(slug);
    const skills = this.readSkillSummary(slug);
    return {
      status: persona.status,
      progress_percent: persona.progress_percent ?? 0,
      current_round: persona.current_round ?? 0,
      total_rounds: persona.total_rounds ?? 0,
      skill_summary: {
        origin_count: skills.origin_skills.length,
        distilled_count: skills.distilled_skills.length,
      },
      source_summary: {
        total_sources: config.sources.length,
        enabled_sources: config.sources.filter((item) => item.enabled).length,
        last_update_check_at: config.update_policy.last_checked_at,
        latest_update_result: config.update_policy.latest_result,
      },
      last_update_check_at: config.update_policy.last_checked_at,
    };
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

  private markPersonaUpdating(slug: string): void {
    const personaPath = join(settings.getPersonaDir(slug), 'persona.json');
    if (!existsSync(personaPath)) return;
    try {
      const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8')));
      const next: Persona = {
        ...persona,
        status: 'training',
        updated_at: new Date().toISOString(),
      };
      writeFileSync(personaPath, JSON.stringify(next, null, 2), 'utf-8');
    } catch {
      // Keep rebuild resilient even if the existing persona asset is partially broken.
    }
  }

  private async preparePersonaRebuild(slug: string): Promise<void> {
    const personaPath = join(settings.getPersonaDir(slug), 'persona.json');
    if (!existsSync(personaPath)) return;
    try {
      const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8')));
      await this.deleteMemoryCollection(persona.memory_collection);
    } catch {
      // Rebuild should continue even if cleanup cannot complete.
    }
  }

  private async deleteMemoryCollection(collectionName: string): Promise<void> {
    const store = this.createMemoryStore();
    try {
      await store.deleteCollection(collectionName);
    } catch {
      // Hard delete should stay best-effort for local vector state.
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
    const lastMessage = messages[messages.length - 1];
    const readyAttachments = lastMessage?.attachments ?? [];
    const activeProvider = String(settings.get('activeProvider') ?? '').trim().toLowerCase();
    if (activeProvider === 'gemini' && hasReadyAttachmentFacts(readyAttachments)) {
      const directReply = await generateGeminiAttachmentReply(soul, lastMessage?.content ?? '', readyAttachments, messages.slice(0, -1));
      if (directReply) {
        return {
          text: directReply,
          triggeredSkills: [],
          normalizedQuery: lastMessage?.content ?? '',
          retrievedMemories: [],
          personaDimensions: [],
        };
      }
    }

    const store = this.createMemoryStore();
    try {
      await store.ensureCollection(persona.memory_collection);
    } catch {
      // Keep chat available even if vector store is not ready.
    }
    const retriever = new MemoryRetriever(store);
    const skillLibrary = loadSkillLibrary(settings.getPersonaDir(persona.slug), persona.slug);
    const agent = new PersonaAgent(soul, retriever, persona.memory_collection, skillLibrary);
    const attachmentPriorityContext = await buildAttachmentPriorityContext(lastMessage?.attachments ?? []);
    const userMessage = buildAttachmentUserMessage(lastMessage?.content ?? '', lastMessage?.attachments ?? []);
    const history = messages.slice(0, -1).map((item) => ({ role: item.role === 'assistant' ? 'assistant' as const : 'user' as const, content: item.content }));
    const result = await agent.respondWithMeta(userMessage, history, {
      priorityContext: attachmentPriorityContext || undefined,
      memoryLimit: hasReadyAttachmentFacts(lastMessage?.attachments ?? []) ? 0 : undefined,
    });
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

  private createMemoryStore(): MemoryStore {
    return new MemoryStore({
      qdrantUrl: settings.get('qdrantUrl'),
      qdrantApiKey: settings.get('qdrantApiKey'),
      openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
    });
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

  buildPersonaSummary(slug: string): PersonaSummary | null {
    const personaSummary = this.readPersonaSummary(slug);
    const configSummary = this.readPersonaConfigSummary(slug);
    const base = personaSummary ?? configSummary;
    if (!base) return null;

    const trainingContext = this.readTrainingContext(slug);
    const trainingReport = this.readTrainingReport(slug);
    const stage = this.resolveStage(base.status, trainingContext, trainingReport);
    const currentRound = trainingContext?.completed_rounds ?? base.training_rounds ?? 0;
    const totalRounds = trainingContext?.requested_rounds ?? trainingReport?.total_rounds ?? 0;

    return {
      ...base,
      is_ready: this.isPersonaReady(base),
      current_stage: stage,
      current_round: currentRound,
      total_rounds: totalRounds,
      progress_percent: this.computeProgressPercent(base.status, currentRound, totalRounds),
    };
  }

  private readTrainingContext(slug: string): { state: string; requested_rounds: number; completed_rounds: number } | null {
    const path = join(settings.getPersonaDir(slug), 'training-context.json');
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
      return {
        state: String(raw.state ?? ''),
        requested_rounds: Number(raw.requested_rounds ?? 0),
        completed_rounds: Number(raw.completed_rounds ?? 0),
      };
    } catch {
      return null;
    }
  }

  private readTrainingReport(slug: string): { total_rounds: number } | null {
    const path = join(settings.getPersonaDir(slug), 'training-report.json');
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
      return { total_rounds: Number(raw.total_rounds ?? 0) };
    } catch {
      return null;
    }
  }

  private resolveStage(
    status: string,
    context: ReturnType<typeof this.readTrainingContext>,
    report: ReturnType<typeof this.readTrainingReport>
  ): string {
    if (status === 'converged' || status === 'exported') return 'converged';
    if (status === 'training') {
      if (context?.state === 'interrupted') return 'error';
      return 'training';
    }
    if (status === 'refining') return 'refining';
    if (status === 'ingesting') return 'ingesting';
    if (report && report.total_rounds > 0 && (!context || context.state === 'completed')) return 'converged';
    if (status === 'created') return 'created';
    return 'creating';
  }

  private computeProgressPercent(status: string, currentRound: number, totalRounds: number): number {
    if (status === 'converged' || status === 'exported') return 100;
    const stageMax: Record<string, number> = { created: 5, ingesting: 25, refining: 45, training: 99, error: 45, converged: 100 };
    const base = stageMax[status] ?? 0;
    if (status === 'training' && totalRounds > 0) {
      const roundContribution = (currentRound / totalRounds) * ((stageMax.training ?? 99) - (stageMax.refining ?? 45));
      return Math.min(99, Math.round((stageMax.refining ?? 45) + roundContribution));
    }
    return base;
  }

  getCultivationDetail(slug: string): CultivationDetail {
    const persona = this.buildPersonaSummary(slug);
    if (!persona) {
      throw new Error(`Persona "${slug}" not found.`);
    }
    const skills = this.readSkillSummary(slug);
    const config = this.getPersonaConfig(slug);
    return {
      persona,
      skills,
      progress: {
        percent: persona.progress_percent ?? 0,
        current_stage: persona.current_stage ?? 'created',
        current_round: persona.current_round ?? 0,
        total_rounds: persona.total_rounds ?? 0,
        stages: this.buildStages(persona.current_stage ?? 'created'),
      },
      assets: {
        evidence_imports: this.store.listEvidenceImports(slug).map((item) => ({
          ...item,
          artifacts: {
            ...item.artifacts,
            evidence_index_path: '',
            evidence_stats_path: '',
            speaker_summary_path: '',
            scene_summary_path: '',
            documents_path: '',
          },
          source_path: basename(item.source_path || ''),
          target_manifest_path: basename(item.target_manifest_path || ''),
        })),
        training_preps: this.store.listTrainingPrepArtifacts(slug).map((item) => ({
          ...item,
          evidence_index_path: '',
          documents_path: '',
        })),
      },
      source_summary: {
        total_sources: config.sources.length,
        enabled_sources: config.sources.filter((item) => item.enabled).length,
        last_update_check_at: config.update_policy.last_checked_at,
        latest_update_result: config.update_policy.latest_result,
      } as any,
    };
  }

  readSkillSummary(slug: string): PersonaSkillSummary {
    const library = loadSkillLibrary(settings.getPersonaDir(slug), slug);
    return {
      origin_skills: library.origin_skills.map((s) => ({ id: s.id, name: s.name, confidence: s.confidence })),
      distilled_skills: library.distilled_skills.map((s) => ({ id: s.id, name: s.name, quality_score: s.quality_score })),
    };
  }

  private buildStages(currentStage: string): CultivationDetail['progress']['stages'] {
    const order = [
      { key: 'created', label: 'stage_created' },
      { key: 'ingesting', label: 'stage_ingesting' },
      { key: 'refining', label: 'stage_refining' },
      { key: 'training', label: 'stage_training' },
      { key: 'error', label: 'stage_error' },
      { key: 'converged', label: 'stage_converged' },
    ];
    const idx = order.findIndex((s) => s.key === currentStage);
    return order.map((s, i) => ({
      key: s.key,
      label: s.label,
      active: i === idx,
      completed: i < idx,
    }));
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

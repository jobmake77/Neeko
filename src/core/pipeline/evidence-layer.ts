import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  ChatMessageEvent,
  EvidenceBatch,
  EvidenceContextMessage,
  EvidenceItem,
  EvidenceRoutingMetadata,
  EvidenceScene,
  EvidenceSpeakerRole,
  EvidenceStats,
  TargetManifest,
  TargetManifestSchema,
} from '../models/evidence.js';
import { RawDocument } from '../models/memory.js';
import { streamChatMessageEvents } from './ingestion/chat-stream.js';

interface StandaloneEvidenceOptions {
  manifest?: TargetManifest;
  sourceLabel?: string;
}

interface ChatEvidenceOptions {
  manifest: TargetManifest;
  sourceType: 'wechat' | 'feishu';
  sourceUrl: string;
}

interface EvidenceBatchArtifacts {
  evidence_index_path: string;
  evidence_stats_path: string;
  speaker_summary_path: string;
  scene_summary_path: string;
  target_manifest_path?: string;
}

interface ChatSessionMessage extends ChatMessageEvent {
  speaker_role: EvidenceSpeakerRole;
  scene: EvidenceScene;
  target_confidence: number;
  source_type: RawDocument['source_type'];
  source_url: string;
}

const DEFAULT_EVIDENCE_STATS: EvidenceStats = {
  raw_messages: 0,
  sessions: 0,
  windows: 0,
  target_windows: 0,
  context_only_windows: 0,
  downgraded_scene_items: 0,
  blocked_scene_items: 0,
  cross_session_stable_items: 0,
  speaker_role_counts: {},
  scene_counts: {},
  modality_counts: {},
  source_type_counts: {},
};

export class SpeakerResolver {
  private readonly targetSet: Set<string>;
  private readonly selfSet: Set<string>;
  private readonly otherSet: Set<string>;

  constructor(private readonly manifest: TargetManifest) {
    this.targetSet = new Set([manifest.target_name, ...manifest.target_aliases].map(normalizeAlias).filter(Boolean));
    this.selfSet = new Set(manifest.self_aliases.map(normalizeAlias).filter(Boolean));
    this.otherSet = new Set(manifest.known_other_aliases.map(normalizeAlias).filter(Boolean));
  }

  resolveSpeaker(name: string): { role: EvidenceSpeakerRole; confidence: number } {
    const normalized = normalizeAlias(name);
    if (!normalized) return { role: 'unknown', confidence: 0.2 };
    if (this.targetSet.has(normalized)) return { role: 'target', confidence: 0.98 };
    if (this.selfSet.has(normalized)) return { role: 'self', confidence: 0.96 };
    if (this.otherSet.has(normalized)) return { role: 'other', confidence: 0.82 };
    return { role: 'unknown', confidence: 0.35 };
  }
}

export class SceneClassifier {
  constructor(private readonly manifest?: TargetManifest) {}

  classify(message: Pick<ChatMessageEvent, 'content'>, sourceType: RawDocument['source_type']): EvidenceScene {
    const content = message.content;
    if (/(love you|miss you|baby|dear|亲爱的|想你|抱抱)/i.test(content)) return 'intimate';
    if (/(fuck|idiot|shut up|傻|滚|生气|吵架|讨厌)/i.test(content)) return 'conflict';
    if (/(deadline|roadmap|deploy|上线|需求|复盘|会议|客户|版本)/i.test(content)) return 'work';
    if (/(weekend|dinner|movie|lol|哈哈|在吗)/i.test(content)) return 'casual';
    if (sourceType === 'feishu') return 'work';
    if (this.manifest?.default_scene) return this.manifest.default_scene;
    if (sourceType === 'wechat') return 'private';
    if (sourceType === 'twitter' || sourceType === 'article' || sourceType === 'video') return 'public';
    return 'unknown';
  }
}

export async function buildChatEvidenceBatchFromFile(
  filePath: string,
  options: ChatEvidenceOptions
): Promise<EvidenceBatch> {
  const resolver = new SpeakerResolver(options.manifest);
  const sceneClassifier = new SceneClassifier(options.manifest);
  const sessions: ChatSessionMessage[][] = [];
  let currentSession: ChatSessionMessage[] = [];
  let previousTimestamp: number | null = null;
  let sessionCounter = 0;
  let rawMessages = 0;

  for await (const event of streamChatMessageEvents(filePath)) {
    rawMessages++;
    const speaker = resolver.resolveSpeaker(event.sender);
    const scene = sceneClassifier.classify(event, options.sourceType);
    const nextMessage: ChatSessionMessage = {
      ...event,
      speaker_role: speaker.role,
      target_confidence: speaker.confidence,
      scene,
      source_type: options.sourceType,
      source_url: options.sourceUrl,
    };

    const ts = event.timestamp ? new Date(event.timestamp).getTime() : null;
    const shouldSplit =
      event.system_boundary === true ||
      (previousTimestamp !== null && ts !== null && ts - previousTimestamp > 20 * 60 * 1000);

    if (shouldSplit && currentSession.length > 0) {
      sessions.push(currentSession);
      currentSession = [];
      sessionCounter++;
    }

    currentSession.push(nextMessage);
    if (ts !== null) previousTimestamp = ts;
  }

  if (currentSession.length > 0) {
    sessions.push(currentSession);
    sessionCounter++;
  }

  const items = buildTargetCenteredWindows(sessions);
  annotateCrossSessionStability(items);
  const stats = buildEvidenceStats(items, {
    raw_messages: rawMessages,
    sessions: sessionCounter,
  });
  return {
    items,
    stats,
    speaker_summary: summarizeSpeakers(items),
    scene_summary: summarizeScenes(items),
  };
}

export function buildStandaloneEvidenceBatch(
  docs: RawDocument[],
  options: StandaloneEvidenceOptions = {}
): EvidenceBatch {
  const resolver = options.manifest ? new SpeakerResolver(options.manifest) : null;
  const sceneClassifier = new SceneClassifier(options.manifest);
  const items: EvidenceItem[] = docs.map((doc) => {
    const videoSpeaker = doc.source_type === 'video'
      ? resolveVideoEvidenceSpeaker(doc, resolver, options.manifest)
      : null;
    const resolvedSpeaker = resolver?.resolveSpeaker(doc.author);
    const speaker =
      videoSpeaker ??
      ((resolvedSpeaker && resolvedSpeaker.role !== 'unknown')
        ? resolvedSpeaker
        : options.manifest
          ? { role: 'target' as EvidenceSpeakerRole, confidence: doc.source_type === 'article' ? 0.72 : 0.88 }
          : { role: 'target' as EvidenceSpeakerRole, confidence: 0.9 });
    const scene = sceneClassifier.classify({ content: doc.content }, doc.source_type);
    const transcriptBounds = resolveTranscriptBounds(doc);
    const transcriptSessionId = resolveTranscriptSessionId(doc);
    const transcriptConversationId = optionalString(doc.metadata?.conversation_id) ?? transcriptSessionId;
    const speakerName = videoSpeaker?.speaker_name ?? doc.author;
    return {
      id: crypto.randomUUID(),
      raw_document_id: doc.id,
      source_type: doc.source_type,
      modality: doc.source_type === 'video' ? 'transcript' : 'text',
      content: doc.content,
      speaker_role: speaker.role,
      speaker_name: speakerName,
      target_confidence: speaker.confidence,
      scene,
      conversation_id: transcriptConversationId,
      session_id: optionalString(doc.metadata?.session_id) ?? transcriptSessionId,
      window_role: 'standalone',
      timestamp_start: transcriptBounds.timestamp_start ?? doc.published_at,
      timestamp_end: transcriptBounds.timestamp_end ?? doc.published_at,
      context_before: [],
      context_after: [],
      evidence_kind: inferEvidenceKind(doc.content, doc.metadata),
      stability_hints: {
        repeated_count: 0,
        repeated_in_sessions: 0,
        cross_session_stable: false,
      },
      metadata: {
        ...(doc.metadata ?? {}),
        source_label: options.sourceLabel,
      },
    };
  });

  annotateCrossSessionStability(items);
  return {
    items,
    stats: buildEvidenceStats(items, {
      raw_messages: docs.length,
      sessions: docs.length,
    }),
    speaker_summary: summarizeSpeakers(items),
    scene_summary: summarizeScenes(items),
  };
}

export function buildVideoTranscriptEvidenceBatch(
  docs: RawDocument[],
  manifest: TargetManifest
): EvidenceBatch {
  return buildStandaloneEvidenceBatch(docs, { manifest, sourceLabel: 'video_transcript' });
}

export function convertEvidenceItemsToDocuments(
  items: EvidenceItem[],
  sourceDocs: RawDocument[] = []
): RawDocument[] {
  const sourceDocById = new Map(sourceDocs.map((doc) => [doc.id, doc]));
  return items.map((item) => {
    const sourceDoc = sourceDocById.get(item.raw_document_id);
    const metadata: EvidenceRoutingMetadata = {
      speaker_role: item.speaker_role,
      speaker_name: item.speaker_name,
      target_confidence: item.target_confidence,
      scene: item.scene,
      modality: item.modality,
      window_role: item.window_role,
      evidence_kind: item.evidence_kind,
      conversation_id: item.conversation_id,
      session_id: item.session_id,
      timestamp_start: item.timestamp_start,
      timestamp_end: item.timestamp_end,
      context_before: item.context_before,
      context_after: item.context_after,
      stability_hints: item.stability_hints,
    };

    return {
      id: item.raw_document_id,
      source_type: item.source_type,
      source_url: sourceDoc?.source_url ?? optionalString(item.metadata.source_url),
      source_platform: sourceDoc?.source_platform ?? optionalString(item.metadata.source_platform),
      content: renderEvidenceContent(item),
      author: item.speaker_name,
      author_handle: sourceDoc?.author_handle,
      published_at: item.timestamp_start ?? sourceDoc?.published_at,
      fetched_at: sourceDoc?.fetched_at ?? new Date().toISOString(),
      language: sourceDoc?.language,
      metadata: {
        ...(sourceDoc?.metadata ?? {}),
        evidence: metadata,
      },
    };
  });
}

export function writeEvidenceArtifacts(
  personaDir: string,
  batch: EvidenceBatch,
  manifest?: TargetManifest
): EvidenceBatchArtifacts {
  mkdirSync(personaDir, { recursive: true });
  const evidenceIndexPath = join(personaDir, 'evidence-index.jsonl');
  const evidenceStatsPath = join(personaDir, 'evidence-stats.json');
  const speakerSummaryPath = join(personaDir, 'speaker-summary.json');
  const sceneSummaryPath = join(personaDir, 'scene-summary.json');
  const manifestPath = manifest ? join(personaDir, 'target-manifest.json') : undefined;

  writeFileSync(
    evidenceIndexPath,
    batch.items.map((item) => JSON.stringify(item)).join('\n') + (batch.items.length > 0 ? '\n' : ''),
    'utf-8'
  );
  writeFileSync(evidenceStatsPath, JSON.stringify(batch.stats, null, 2), 'utf-8');
  writeFileSync(speakerSummaryPath, JSON.stringify(batch.speaker_summary, null, 2), 'utf-8');
  writeFileSync(sceneSummaryPath, JSON.stringify(batch.scene_summary, null, 2), 'utf-8');
  if (manifestPath && manifest) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  return {
    evidence_index_path: evidenceIndexPath,
    evidence_stats_path: evidenceStatsPath,
    speaker_summary_path: speakerSummaryPath,
    scene_summary_path: sceneSummaryPath,
    target_manifest_path: manifestPath,
  };
}

export function loadEvidenceItemsFromFile(filePath: string): EvidenceItem[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvidenceItem);
  } catch {
    return [];
  }
}

export function loadTargetManifest(filePath: string): TargetManifest {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  return TargetManifestSchema.parse(parsed);
}

function buildTargetCenteredWindows(sessions: ChatSessionMessage[][]): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
    const session = sessions[sessionIndex];
    for (let i = 0; i < session.length; i++) {
      const message = session[i];
      if (message.speaker_role !== 'target') continue;

      const mergedMessages = [message];
      let cursor = i + 1;
      while (cursor < session.length && session[cursor].speaker_role === 'target') {
        mergedMessages.push(session[cursor]);
        cursor++;
      }

      const before = session.slice(Math.max(0, i - 2), i);
      const after = session.slice(cursor, Math.min(session.length, cursor + 1));
      const primary = mergedMessages[0];
      const combinedContent = mergedMessages.map((item) => item.content).join('\n');
      const scene = mergeScenes(mergedMessages.map((item) => item.scene));
      items.push({
        id: crypto.randomUUID(),
        raw_document_id: primary.id,
        source_type: primary.source_type,
        modality: 'chat',
        content: combinedContent,
        speaker_role: 'target',
        speaker_name: primary.sender,
        target_confidence: Math.max(...mergedMessages.map((item) => item.target_confidence)),
        scene,
        conversation_id: primary.conversation_id,
        session_id: `${primary.conversation_id ?? 'session'}:${sessionIndex}`,
        window_role: 'target_centered',
        timestamp_start: primary.timestamp,
        timestamp_end: mergedMessages[mergedMessages.length - 1].timestamp,
        context_before: before.map(toContextMessage),
        context_after: after.map(toContextMessage),
        evidence_kind: inferEvidenceKind(combinedContent),
        stability_hints: {
          repeated_count: 0,
          repeated_in_sessions: 0,
          cross_session_stable: false,
        },
        metadata: {
          merged_messages: mergedMessages.length,
          source_url: primary.source_url,
        },
      });
      i = cursor - 1;
    }
  }

  return items;
}

function annotateCrossSessionStability(items: EvidenceItem[]): void {
  const seen = new Map<string, { count: number; sessions: Set<string> }>();
  for (const item of items) {
    const key = fingerprintEvidence(item.content);
    const state = seen.get(key) ?? { count: 0, sessions: new Set<string>() };
    state.count++;
    if (item.session_id) state.sessions.add(item.session_id);
    seen.set(key, state);
  }

  for (const item of items) {
    const state = seen.get(fingerprintEvidence(item.content));
    if (!state) continue;
    item.stability_hints = {
      repeated_count: state.count,
      repeated_in_sessions: state.sessions.size,
      cross_session_stable: state.sessions.size >= 2,
    };
  }
}

function buildEvidenceStats(
  items: EvidenceItem[],
  base: Pick<EvidenceStats, 'raw_messages' | 'sessions'>
): EvidenceStats {
  const speakerRoleCounts = countBy(items, (item) => item.speaker_role);
  const sceneCounts = countBy(items, (item) => item.scene);
  const modalityCounts = countBy(items, (item) => item.modality);
  const sourceTypeCounts = countBy(items, (item) => item.source_type);
  return {
    ...DEFAULT_EVIDENCE_STATS,
    raw_messages: base.raw_messages,
    sessions: base.sessions,
    windows: items.length,
    target_windows: items.filter((item) => item.window_role === 'target_centered').length,
    context_only_windows: items.filter((item) => item.window_role === 'context_only').length,
    downgraded_scene_items: items.filter((item) => item.scene === 'private').length,
    blocked_scene_items: items.filter((item) => item.scene === 'intimate' || item.scene === 'conflict').length,
    cross_session_stable_items: items.filter((item) => item.stability_hints.cross_session_stable).length,
    speaker_role_counts: speakerRoleCounts,
    scene_counts: sceneCounts,
    modality_counts: modalityCounts,
    source_type_counts: sourceTypeCounts,
  };
}

function summarizeSpeakers(items: EvidenceItem[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const item of items) {
    const key = `${item.speaker_role}:${item.speaker_name}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

function summarizeScenes(items: EvidenceItem[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const item of items) {
    summary[item.scene] = (summary[item.scene] ?? 0) + 1;
  }
  return summary;
}

function countBy<T>(items: T[], pick: (item: T) => string): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

function renderEvidenceContent(item: EvidenceItem): string {
  const before = item.context_before.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join('\n');
  const after = item.context_after.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join('\n');
  const sections = [
    before ? `Context before:\n${before}` : '',
    `Target evidence:\n${item.speaker_name}: ${item.content}`,
    after ? `Context after:\n${after}` : '',
  ].filter(Boolean);
  return sections.join('\n\n');
}

function toContextMessage(message: ChatSessionMessage): EvidenceContextMessage {
  return {
    speaker_name: message.sender,
    speaker_role: message.speaker_role,
    content: message.content,
    timestamp: message.timestamp,
  };
}

function mergeScenes(scenes: EvidenceScene[]): EvidenceScene {
  if (scenes.includes('conflict')) return 'conflict';
  if (scenes.includes('intimate')) return 'intimate';
  if (scenes.includes('work')) return 'work';
  if (scenes.includes('private')) return 'private';
  if (scenes.includes('casual')) return 'casual';
  if (scenes.includes('public')) return 'public';
  return 'unknown';
}

function inferEvidenceKind(content: string, metadata?: Record<string, unknown>): EvidenceItem['evidence_kind'] {
  const nonverbalSignals = Array.isArray(metadata?.nonverbal_signals)
    ? metadata.nonverbal_signals.filter(Boolean)
    : [];
  if (nonverbalSignals.length > 0) return 'behavior_signal';
  if (/\b(i prefer|我更喜欢|prefer|喜欢)\b/i.test(content)) return 'preference';
  if (/\b(i decided|决定|will do|选择)\b/i.test(content)) return 'decision';
  if (/\b(because|所以|原因|therefore)\b/i.test(content)) return 'explanation';
  if (/\b(always|never|should|must|原则)\b/i.test(content)) return 'behavior_signal';
  if (/\?/.test(content)) return 'reply';
  return 'statement';
}

function resolveVideoEvidenceSpeaker(
  doc: RawDocument,
  resolver: SpeakerResolver | null,
  manifest?: TargetManifest
): { role: EvidenceSpeakerRole; confidence: number; speaker_name: string } | null {
  const metadata = doc.metadata ?? {};
  const speakerSegments = Array.isArray(metadata.speaker_segments) ? metadata.speaker_segments : [];
  const firstNamedSegment = speakerSegments.find((segment) => typeof segment === 'object' && segment !== null && resolveSpeakerName(segment));
  const explicitSpeakerName =
    resolveSpeakerName(firstNamedSegment) ??
    optionalString(metadata.speaker_name) ??
    optionalString(metadata.speaker) ??
    (doc.author && doc.author !== 'unknown' ? doc.author : undefined);

  if (!explicitSpeakerName) return null;
  const explicitRole = optionalString(metadata.speaker_role) ?? optionalString((firstNamedSegment as Record<string, unknown> | undefined)?.role);
  if (explicitRole === 'target' || explicitRole === 'self' || explicitRole === 'other' || explicitRole === 'unknown') {
    return {
      role: explicitRole,
      confidence: explicitRole === 'target' ? 0.98 : explicitRole === 'unknown' ? 0.35 : 0.84,
      speaker_name: explicitSpeakerName,
    };
  }

  const resolved = resolver?.resolveSpeaker(explicitSpeakerName);
  if (resolved) {
    return {
      ...resolved,
      speaker_name: explicitSpeakerName,
    };
  }

  if (manifest) {
    return {
      role: 'target',
      confidence: 0.76,
      speaker_name: explicitSpeakerName,
    };
  }

  return {
    role: 'unknown',
    confidence: 0.35,
    speaker_name: explicitSpeakerName,
  };
}

function resolveSpeakerName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return optionalString(record.speaker_name) ?? optionalString(record.speaker) ?? optionalString(record.name);
}

function resolveTranscriptSessionId(doc: RawDocument): string | undefined {
  const filename = optionalString(doc.metadata?.filename);
  if (!filename) return undefined;
  return `transcript:${filename}`;
}

function resolveTranscriptBounds(doc: RawDocument): { timestamp_start?: string; timestamp_end?: string } {
  const startIso =
    optionalIso(doc.metadata?.segment_start_iso) ??
    optionalIso(doc.metadata?.timestamp_start) ??
    undefined;
  const endIso =
    optionalIso(doc.metadata?.segment_end_iso) ??
    optionalIso(doc.metadata?.timestamp_end) ??
    undefined;
  return { timestamp_start: startIso, timestamp_end: endIso };
}

function normalizeAlias(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function optionalIso(value: unknown): string | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function fingerprintEvidence(content: string): string {
  return String(content)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 18)
    .join(' ');
}

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EvidenceItem } from '../models/evidence.js';
import {
  DynamicScalingMetrics,
  EvidencePack,
  EvidencePackBuildResult,
  EvidencePackModality,
  EvidencePackSceneProfile,
  EvidencePackSpeakerRole,
  PackBuildStats,
} from '../models/evidence-pack.js';

interface PackBuilderOptions {
  personaSlug?: string;
  bucketDays?: number;
  targetTokensPerPack?: number;
  maxTokensPerPack?: number;
}

interface EvidencePackArtifacts {
  evidence_packs_path: string;
  pack_stats_path: string;
  dynamic_metrics_path: string;
}

export function buildEvidencePacks(
  items: EvidenceItem[],
  options: PackBuilderOptions = {}
): EvidencePackBuildResult {
  const bucketDays = Math.max(1, options.bucketDays ?? deriveBucketDays(items));
  const targetTokensPerPack = Math.max(300, options.targetTokensPerPack ?? deriveTargetTokensPerPack(items));
  const maxTokensPerPack = Math.max(targetTokensPerPack, options.maxTokensPerPack ?? Math.round(targetTokensPerPack * 1.5));
  const dynamicSkipTokens = buildDynamicSkipTokens(items);
  const ordered = [...items].sort(compareEvidenceItems);
  const groups = new Map<string, EvidenceItem[]>();

  for (const item of ordered) {
    const key = [
      item.source_type,
      collapseScene(item.scene),
      collapseSpeaker(item.speaker_role),
      formatTimeBucket(item.timestamp_start ?? item.timestamp_end, bucketDays),
    ].join('::');
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  const packs: EvidencePack[] = [];
  const seenTopicSignatures: string[][] = [];

  for (const bucket of groups.values()) {
    let current: EvidenceItem[] = [];
    let currentTokens = 0;
    for (const item of bucket) {
      const itemTokens = estimateTokens(item.content);
      const nextTokens = currentTokens + itemTokens;
      const itemTopicSignature = deriveTopicSignature(item, dynamicSkipTokens);
      const currentTopicSignature = collectTopTerms(
        current.flatMap((entry) => deriveTopicSignature(entry, dynamicSkipTokens)),
        6
      );
      const topicOverlap = current.length === 0 ? 1 : jaccard(itemTopicSignature, currentTopicSignature);
      const shouldFlush =
        current.length > 0 &&
        (
          nextTokens > maxTokensPerPack ||
          (currentTokens >= targetTokensPerPack && nextTokens > targetTokensPerPack + 200) ||
          (currentTokens >= Math.round(targetTokensPerPack * 0.55) && topicOverlap < 0.18)
        );
      if (shouldFlush) {
        packs.push(buildPack(current, seenTopicSignatures, options.personaSlug, dynamicSkipTokens));
        seenTopicSignatures.push(packs[packs.length - 1].topic_signature);
        current = [];
        currentTokens = 0;
      }
      current.push(item);
      currentTokens += itemTokens;
    }
    if (current.length > 0) {
      packs.push(buildPack(current, seenTopicSignatures, options.personaSlug, dynamicSkipTokens));
      seenTopicSignatures.push(packs[packs.length - 1].topic_signature);
    }
  }

  annotatePackTopicFamilies(packs);

  const stats = buildPackStats(items.length, packs);
  const metrics = buildDynamicScalingMetrics(packs);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    persona_slug: options.personaSlug,
    packs,
    stats,
    metrics,
    config: {
      bucket_days: bucketDays,
      target_tokens_per_pack: targetTokensPerPack,
      max_tokens_per_pack: maxTokensPerPack,
    },
  };
}

export function writeEvidencePackAssets(
  personaDir: string,
  result: EvidencePackBuildResult
): EvidencePackArtifacts {
  mkdirSync(personaDir, { recursive: true });
  const packsPath = join(personaDir, 'evidence-packs.json');
  const statsPath = join(personaDir, 'pack-stats.json');
  const metricsPath = join(personaDir, 'dynamic-scaling-metrics.json');
  writeFileSync(packsPath, JSON.stringify(result, null, 2), 'utf-8');
  writeFileSync(statsPath, JSON.stringify(result.stats, null, 2), 'utf-8');
  writeFileSync(metricsPath, JSON.stringify(result.metrics, null, 2), 'utf-8');
  return {
    evidence_packs_path: packsPath,
    pack_stats_path: statsPath,
    dynamic_metrics_path: metricsPath,
  };
}

export function loadEvidencePackBuildResult(personaDir: string): EvidencePackBuildResult | null {
  const filePath = join(personaDir, 'evidence-packs.json');
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as EvidencePackBuildResult;
    return parsed && Array.isArray(parsed.packs) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildDynamicScalingMetrics(packs: EvidencePack[]): DynamicScalingMetrics {
  const stableTopicGrowth = clamp(uniqueTopicCount(packs) / Math.max(1, packs.length * 2));
  const marginalCoverageGain = clamp(
    average(packs.map((pack) => pack.scores.novelty)) * 0.6 +
    average(packs.map((pack) => pack.scores.target_relevance)) * 0.4
  );
  const duplicationPressure = clamp(average(packs.map((pack) => pack.scores.duplication_pressure)));
  const conflictPressure = clamp(
    average(
      packs.map((pack) =>
        pack.scene_profile === 'conflict' || pack.scene_profile === 'intimate'
          ? 0.9
          : pack.scene_profile === 'private'
            ? 0.45
            : 0.1
      )
    )
  );
  const runtimePressure = clamp(
    average(
      packs.map((pack) =>
        Math.min(1, pack.stats.estimated_tokens / 2200) * 0.6 +
        Math.min(1, pack.topic_signature.length / 8) * 0.2 +
        pack.scores.duplication_pressure * 0.2
      )
    )
  );
  const seedMaturity = clamp(
    average(packs.map((pack) => pack.scores.stability)) * 0.45 +
    (1 - duplicationPressure) * 0.2 +
    average(packs.map((pack) => pack.scores.target_relevance)) * 0.2 +
    stableTopicGrowth * 0.15
  );
  return {
    stable_topic_growth: stableTopicGrowth,
    marginal_coverage_gain: marginalCoverageGain,
    duplication_pressure: duplicationPressure,
    conflict_pressure: conflictPressure,
    runtime_pressure: runtimePressure,
    seed_maturity: seedMaturity,
  };
}

function annotatePackTopicFamilies(packs: EvidencePack[]): void {
  const packRoots = packs.map((pack) => readPackStrings(pack.metadata.topic_roots).slice(0, 8));
  const rootCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();

  for (const roots of packRoots) {
    const uniqueRoots = [...new Set(roots)];
    for (const root of uniqueRoots) {
      rootCounts.set(root, (rootCounts.get(root) ?? 0) + 1);
    }
    for (let i = 0; i < uniqueRoots.length; i++) {
      for (let j = i + 1; j < uniqueRoots.length; j++) {
        const key = pairKey(uniqueRoots[i], uniqueRoots[j]);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const rootFamilies = new Map<string, string>();
  for (const root of rootCounts.keys()) {
    const family = TOPIC_FAMILY_SEEDS.get(root);
    if (family) {
      rootFamilies.set(root, family);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [root, count] of rootCounts.entries()) {
      if (rootFamilies.has(root) || count < 2) continue;
      const family = resolveDynamicTopicFamily(root, rootFamilies, rootCounts, pairCounts);
      if (family) {
        rootFamilies.set(root, family);
        changed = true;
      }
    }
  }

  for (let index = 0; index < packs.length; index++) {
    const familyCounts = new Map<string, number>();
    const seededFamilySupport = new Set<string>();
    for (const root of packRoots[index]) {
      const family = rootFamilies.get(root);
      if (!family) continue;
      familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
      if (TOPIC_FAMILY_SEEDS.get(root) === family) {
        seededFamilySupport.add(family);
      }
    }
    packs[index].metadata.topic_families = [...familyCounts.entries()]
      .filter(([family, count]) => count >= 2 || seededFamilySupport.has(family))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([family]) => family);
  }
}

function buildPack(
  items: EvidenceItem[],
  seenTopicSignatures: string[][],
  personaSlug?: string,
  dynamicSkipTokens: Set<string> = new Set()
): EvidencePack {
  const totalChars = items.reduce((sum, item) => sum + item.content.length, 0);
  const estimatedTokens = items.reduce((sum, item) => sum + estimateTokens(item.content), 0);
  const targetCount = items.filter((item) => item.speaker_role === 'target').length;
  const crossSessionStableCount = items.filter((item) => item.stability_hints.cross_session_stable).length;
  const packTokens = items.flatMap((item) =>
    tokenizeTerms(item.content).filter((token) => !dynamicSkipTokens.has(token))
  );
  const topicTerms = collectTopTerms(packTokens, 18);
  const topicRoots = collectTopTerms(packTokens.map(normalizeTopicRoot).filter(Boolean), 12);
  const topicSignature = collectTopTerms(
    items.flatMap((item) => deriveTopicSignature(item, dynamicSkipTokens)),
    6
  );
  const sceneProfile = resolveSceneProfile(items);
  const primarySpeakerRole = resolvePrimarySpeakerRole(items);
  const quality = clamp(
    0.25 * average(items.map((item) => normalizeChars(item.content.length))) +
    0.25 * ratio(targetCount, items.length) +
    0.2 * ratio(crossSessionStableCount, items.length) +
    0.15 * scoreSceneProfile(sceneProfile) +
    0.15 * scoreItemKinds(items)
  );
  const novelty = computeNovelty(topicSignature, seenTopicSignatures);
  const stability = clamp(
    0.45 * ratio(targetCount, items.length) +
    0.35 * ratio(crossSessionStableCount, items.length) +
    0.2 * scoreSceneProfile(sceneProfile)
  );
  const risk = clamp(
    0.45 * ratio(items.filter((item) => isSensitiveScene(item.scene)).length, items.length) +
    0.35 * ratio(items.filter((item) => item.speaker_role === 'unknown').length, items.length) +
    0.2 * ratio(items.filter((item) => looksEphemeral(item.content)).length, items.length)
  );
  const targetRelevance = clamp(
    0.6 * ratio(targetCount, items.length) +
    0.25 * average(items.map((item) => item.target_confidence)) +
    0.15 * (primarySpeakerRole === 'target' ? 1 : primarySpeakerRole === 'mixed' ? 0.5 : 0.2)
  );
  const duplicationPressure = clamp(1 - novelty);
  const routingProjection = buildRoutingProjection(items, quality, stability, risk, targetRelevance);
  const value = clamp(
    0.25 * quality +
    0.2 * novelty +
    0.2 * stability +
    0.2 * targetRelevance -
    0.1 * risk -
    0.05 * duplicationPressure
  );

  const dates = items
    .flatMap((item) => [parseDate(item.timestamp_start), parseDate(item.timestamp_end)])
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime());
  const startedAt = dates[0]?.toISOString();
  const endedAt = dates[dates.length - 1]?.toISOString();
  const daysSpan = dates.length >= 2
    ? Math.max(0, Math.round((dates[dates.length - 1].getTime() - dates[0].getTime()) / 86_400_000))
    : 0;

  return {
    id: crypto.randomUUID(),
    persona_slug: personaSlug,
    source_type: items[0]?.source_type ?? 'custom',
    modality: resolveModality(items),
    scene_profile: sceneProfile,
    time_window: {
      started_at: startedAt,
      ended_at: endedAt,
      days_span: daysSpan,
    },
    item_ids: items.map((item) => item.id),
    raw_document_ids: [...new Set(items.map((item) => item.raw_document_id))],
    conversation_ids: uniqueStrings(items.map((item) => item.conversation_id)),
    session_ids: uniqueStrings(items.map((item) => item.session_id)),
    primary_speaker_role: primarySpeakerRole,
    topic_signature: topicSignature,
    stats: {
      item_count: items.length,
      raw_doc_count: new Set(items.map((item) => item.raw_document_id)).size,
      total_chars: totalChars,
      estimated_tokens: estimatedTokens,
      avg_item_chars: items.length === 0 ? 0 : totalChars / items.length,
      target_ratio: ratio(targetCount, items.length),
      cross_session_stable_ratio: ratio(crossSessionStableCount, items.length),
    },
    scores: {
      quality,
      novelty,
      stability,
      risk,
      target_relevance: targetRelevance,
      duplication_pressure: duplicationPressure,
      value,
    },
    routing_projection: routingProjection,
    metadata: {
      sample_excerpt: clipText(items[0]?.content ?? '', 160),
      source_types: [...new Set(items.map((item) => item.source_type))],
      scenes: [...new Set(items.map((item) => item.scene))],
      topic_terms: topicTerms,
      topic_roots: topicRoots,
    },
  };
}

function buildPackStats(rawItemCount: number, packs: EvidencePack[]): PackBuildStats {
  return {
    raw_item_count: rawItemCount,
    produced_pack_count: packs.length,
    avg_items_per_pack: packs.length === 0 ? 0 : rawItemCount / packs.length,
    avg_tokens_per_pack: packs.length === 0 ? 0 : average(packs.map((pack) => pack.stats.estimated_tokens)),
    mixed_source_pack_count: packs.filter((pack) => (pack.metadata.source_types as unknown[] | undefined)?.length !== 1).length,
    high_risk_pack_count: packs.filter((pack) => pack.scores.risk >= 0.55).length,
    high_duplication_pack_count: packs.filter((pack) => pack.scores.duplication_pressure >= 0.55).length,
    target_dominant_pack_count: packs.filter((pack) => pack.primary_speaker_role === 'target').length,
  };
}

function resolveModality(items: EvidenceItem[]): EvidencePackModality {
  const values = [...new Set(items.map((item) => item.modality))];
  return values.length === 1 ? values[0] : 'mixed';
}

function resolveSceneProfile(items: EvidenceItem[]): EvidencePackSceneProfile {
  const values = [...new Set(items.map((item) => item.scene))];
  return values.length === 1 ? values[0] : 'mixed';
}

function resolvePrimarySpeakerRole(items: EvidenceItem[]): EvidencePackSpeakerRole {
  const counts = new Map<EvidencePackSpeakerRole, number>();
  for (const item of items) {
    const role = item.speaker_role as EvidencePackSpeakerRole;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'unknown';
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return 'mixed';
  return sorted[0][0];
}

function buildRoutingProjection(
  items: EvidenceItem[],
  quality: number,
  stability: number,
  risk: number,
  targetRelevance: number
) {
  let soul = 0;
  let memory = 0;
  let discard = 0;
  for (const item of items) {
    const sceneBoost = scoreSceneProfile(collapseScene(item.scene) as EvidencePackSceneProfile);
    const itemScore = 0.3 * quality + 0.3 * stability + 0.2 * targetRelevance + 0.2 * sceneBoost - 0.25 * risk;
    if (item.speaker_role === 'target' && !isSensitiveScene(item.scene) && itemScore >= 0.58) {
      soul++;
    } else if (itemScore >= 0.34) {
      memory++;
    } else {
      discard++;
    }
  }
  return {
    soul_candidate_items: soul,
    memory_candidate_items: memory,
    discard_candidate_items: discard,
  };
}

function deriveTopicSignature(item: EvidenceItem, dynamicSkipTokens: Set<string> = new Set()): string[] {
  return collectTopTerms(
    tokenizeTerms(item.content).filter((token) => !dynamicSkipTokens.has(token)),
    6
  );
}

function buildDynamicSkipTokens(items: EvidenceItem[]): Set<string> {
  const tokenDocumentCounts = new Map<string, number>();
  for (const item of items) {
    const uniqueTokens = new Set(tokenizeTerms(item.content));
    for (const token of uniqueTokens) {
      tokenDocumentCounts.set(token, (tokenDocumentCounts.get(token) ?? 0) + 1);
    }
  }

  const threshold = Math.max(12, Math.round(items.length * 0.04));
  return new Set(
    [...tokenDocumentCounts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([token]) => token)
  );
}

function deriveBucketDays(items: EvidenceItem[]): number {
  const dates = items
    .map((item) => parseDate(item.timestamp_start ?? item.timestamp_end))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length < 2) return 21;
  const spanDays = Math.max(1, Math.round((dates[dates.length - 1].getTime() - dates[0].getTime()) / 86_400_000));
  const density = items.length / spanDays;
  if (density >= 8) return 7;
  if (density >= 3) return 14;
  if (density >= 1) return 21;
  return 45;
}

function deriveTargetTokensPerPack(items: EvidenceItem[]): number {
  const modalities = new Set(items.map((item) => item.modality));
  if (modalities.has('chat')) return 1200;
  if (modalities.has('transcript')) return 1800;
  return 1400;
}

function computeNovelty(topicSignature: string[], previous: string[][]): number {
  if (previous.length === 0) return 1;
  let maxOverlap = 0;
  for (const existing of previous) {
    const overlap = jaccard(topicSignature, existing);
    if (overlap > maxOverlap) maxOverlap = overlap;
  }
  return clamp(1 - maxOverlap);
}

function collapseScene(scene: string): string {
  if (scene === 'intimate' || scene === 'conflict') return scene;
  if (scene === 'public' || scene === 'work' || scene === 'private' || scene === 'casual') return scene;
  return 'unknown';
}

function collapseSpeaker(role: string): string {
  if (role === 'target') return 'target';
  if (role === 'self' || role === 'other') return 'context';
  return 'unknown';
}

function scoreSceneProfile(scene: EvidencePackSceneProfile): number {
  switch (scene) {
    case 'public':
      return 1;
    case 'work':
      return 0.9;
    case 'casual':
      return 0.55;
    case 'private':
      return 0.4;
    case 'mixed':
      return 0.5;
    case 'intimate':
    case 'conflict':
      return 0.15;
    default:
      return 0.3;
  }
}

function scoreItemKinds(items: EvidenceItem[]): number {
  const highValue = items.filter((item) =>
    item.evidence_kind === 'statement' ||
    item.evidence_kind === 'explanation' ||
    item.evidence_kind === 'decision' ||
    item.evidence_kind === 'behavior_signal'
  ).length;
  return ratio(highValue, items.length);
}

function looksEphemeral(content: string): boolean {
  return /(^|\s)(lol|lmao|haha|哈哈|ok|okay|nice|cool|soon|today|tomorrow|this week)(\s|$)/i.test(content);
}

function isSensitiveScene(scene: string): boolean {
  return scene === 'private' || scene === 'intimate' || scene === 'conflict';
}

function compareEvidenceItems(a: EvidenceItem, b: EvidenceItem): number {
  const aDate = parseDate(a.timestamp_start ?? a.timestamp_end)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDate = parseDate(b.timestamp_start ?? b.timestamp_end)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return a.id.localeCompare(b.id);
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimeBucket(value: string | undefined, bucketDays: number): string {
  const date = parseDate(value);
  if (!date) return 'time:unknown';
  const dayIndex = Math.floor(date.getTime() / 86_400_000 / bucketDays);
  return `time:${dayIndex}`;
}

function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 2 + rest / 4);
}

function tokenizeTerms(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_]+/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !shouldSkipToken(token));
}

function normalizeTopicRoot(token: string): string {
  const directAlias = TOPIC_ROOT_ALIASES.get(token);
  if (directAlias) return directAlias;

  let normalized = token.toLowerCase();
  normalized = normalized.replace(/(?:ing|edly|edly|edly|edly)$/i, '');
  normalized = normalized.replace(/(?:ations|ation)$/i, 'ate');
  normalized = normalized.replace(/(?:izers|izer)$/i, 'ize');
  normalized = normalized.replace(/(?:ments|ment)$/i, '');
  normalized = normalized.replace(/(?:ers|er)$/i, '');
  normalized = normalized.replace(/(?:ies)$/i, 'y');
  normalized = normalized.replace(/(?:ed)$/i, '');
  normalized = normalized.replace(/(?:s)$/i, '');

  const aliasAfterTrim = TOPIC_ROOT_ALIASES.get(normalized);
  if (aliasAfterTrim) return aliasAfterTrim;
  if (normalized.length < 3) return token;
  return normalized;
}

function resolveDynamicTopicFamily(
  root: string,
  rootFamilies: Map<string, string>,
  rootCounts: Map<string, number>,
  pairCounts: Map<string, number>
): string | null {
  const familyScores = new Map<string, number>();

  for (const [knownRoot, family] of rootFamilies.entries()) {
    const pairCount = pairCounts.get(pairKey(root, knownRoot)) ?? 0;
    if (pairCount === 0) continue;
    const normalizedScore = pairCount / Math.max(1, rootCounts.get(root) ?? 1);
    familyScores.set(family, (familyScores.get(family) ?? 0) + normalizedScore);
  }

  const ranked = [...familyScores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best) return null;
  if (best[1] < 0.9) return null;
  if (runnerUp && best[1] - runnerUp[1] < 0.25) return null;
  return best[0];
}

function collectTopTerms(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function readPackStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function uniqueTopicCount(packs: EvidencePack[]): number {
  return new Set(packs.flatMap((pack) => pack.topic_signature.slice(0, 3))).size;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeChars(value: number): number {
  return clamp(value / 420);
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function ratio(a: number, b: number): number {
  return b <= 0 ? 0 : a / b;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function jaccard(a: string[], b: string[]): number {
  const aSet = new Set(a);
  const bSet = new Set(b);
  const intersection = [...aSet].filter((value) => bSet.has(value)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(6));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'all', 'but', 'are', 'was', 'were', 'has', 'had', 'its', 'our', 'out',
  'too', 'you', 'your', 'his', 'her', 'him', 'she', 'who', 'why', 'how', 'get', 'got', 'can',
  'may', 'might', 'also', 'than', 'then', 'into', 'onto', 'from', 'with', 'without', 'over',
  'under', 'through', 'about', 'after', 'before', 'while', 'where', 'when', 'what', 'which',
  'this', 'that', 'these', 'those', 'there', 'their', 'they', 'them', 'have', 'been', 'being',
  'just', 'more', 'most', 'some', 'much', 'many', 'really', 'still', 'only', 'very', 'here',
  'would', 'could', 'should', 'into', 'onto', 'because', 'already', 'around', 'across',
  'another', 'every', 'everything', 'something', 'nothing', 'great', 'good', 'nice', 'cool',
  'amazing', 'awesome', 'today', 'tomorrow', 'yesterday', 'week', 'weeks', 'month', 'months',
  'year', 'years', 'said', 'says', 'saying', 'make', 'makes', 'made', 'using', 'used', 'use',
  'like', 'love', 'haha', 'lol', 'lmao', 'okay', 'ok',
  'about', 'again', 'also', 'been', 'being', 'from', 'have', 'into', 'just', 'more', 'most',
  'that', 'their', 'there', 'they', 'this', 'those', 'very', 'with', 'what', 'when', 'will',
  'your', 'ours', 'them', 'than', 'because', 'through', 'would', 'could', 'should', 'after',
  'before', 'where', 'which', 'while', 'were', 'here', 'then', 'these', 'over', 'under',
  'some', 'much', 'many', 'really', 'still', 'only', 'onto', 'http', 'https',
]);

const TOPIC_ROOT_ALIASES = new Map<string, string>([
  ['agents', 'agent'],
  ['agency', 'agent'],
  ['models', 'model'],
  ['modeling', 'model'],
  ['modelling', 'model'],
  ['train', 'training'],
  ['trains', 'training'],
  ['trained', 'training'],
  ['trainer', 'training'],
  ['trainers', 'training'],
  ['training', 'training'],
  ['compute', 'compute'],
  ['computer', 'compute'],
  ['computers', 'compute'],
  ['computing', 'compute'],
  ['computation', 'compute'],
  ['computations', 'compute'],
  ['network', 'network'],
  ['networks', 'network'],
  ['neural', 'network'],
  ['inference', 'inference'],
  ['infer', 'inference'],
  ['inferencing', 'inference'],
  ['activations', 'activation'],
  ['activation', 'activation'],
  ['transformer', 'transformer'],
  ['transformers', 'transformer'],
  ['coding', 'code'],
  ['coder', 'code'],
  ['coders', 'code'],
  ['codes', 'code'],
  ['dataset', 'data'],
  ['datasets', 'data'],
  ['datapoint', 'data'],
  ['datapoints', 'data'],
  ['tweets', 'tweet'],
  ['tweeting', 'tweet'],
  ['videos', 'video'],
  ['images', 'image'],
  ['reasoning', 'reason'],
  ['reasoned', 'reason'],
  ['reasons', 'reason'],
  ['memorys', 'memory'],
]);

const TOPIC_FAMILY_SEEDS = new Map<string, string>([
  ['training', 'family:ml_training'],
  ['model', 'family:ml_training'],
  ['inference', 'family:ml_training'],
  ['network', 'family:ml_training'],
  ['compute', 'family:ml_infra'],
  ['gpu', 'family:ml_infra'],
  ['cuda', 'family:ml_infra'],
  ['pytorch', 'family:ml_infra'],
  ['memory', 'family:ml_infra'],
  ['attention', 'family:ml_infra'],
  ['llama', 'family:llm_agents'],
  ['chatgpt', 'family:llm_agents'],
  ['claude', 'family:llm_agents'],
  ['nanochat', 'family:llm_agents'],
  ['prompt', 'family:llm_agents'],
  ['agent', 'family:llm_agents'],
  ['code', 'family:software_build'],
  ['app', 'family:software_build'],
  ['deploy', 'family:software_build'],
  ['software', 'family:software_build'],
  ['build', 'family:software_build'],
  ['research', 'family:research_work'],
  ['learn', 'family:research_work'],
  ['idea', 'family:research_work'],
  ['eval', 'family:research_work'],
  ['image', 'family:media_content'],
  ['video', 'family:media_content'],
  ['podcast', 'family:media_content'],
  ['text', 'family:media_content'],
]);

function shouldSkipToken(token: string): boolean {
  if (!token) return true;
  if (STOPWORDS.has(token)) return true;
  if (/^\d+$/.test(token)) return true;
  if (/^(19|20)\d{2}$/.test(token)) return true;
  if (/^\d+[a-z]+$/i.test(token)) return true;
  if (/^[a-z]\d+[a-z\d]*$/i.test(token)) return true;
  return false;
}

export const __packBuilderTestables = {
  buildDynamicScalingMetrics,
  buildDynamicSkipTokens,
  deriveBucketDays,
  deriveTargetTokensPerPack,
  shouldSkipToken,
};

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EvidencePack } from '../models/evidence-pack.js';

export interface AdaptiveShardPlanItem {
  shard_id: string;
  index: number;
  pack_ids: string[];
  pack_count: number;
  item_count: number;
  estimated_tokens: number;
  estimated_chunks: number;
  source_type_counts: Record<string, number>;
  topic_signatures: string[];
  dominant_topic?: string;
  dominant_topic_concentration: number;
  topical_entropy: number;
  avg_pack_value: number;
  runtime_cost_hint: number;
  started_at?: string;
  ended_at?: string;
  days_span?: number;
}

export interface AdaptiveShardPlan {
  schema_version: 1;
  generated_at: string;
  persona_slug?: string;
  planner_version: string;
  strategy: 'budget_based_v1';
  config: {
    max_estimated_tokens: number;
    max_estimated_chunks: number;
    max_pack_count: number;
    max_topical_entropy: number;
    max_runtime_cost_hint: number;
    min_topic_similarity: number;
    relaxed_topic_similarity: number;
    inter_cluster_similarity: number;
    planning_bucket_days: number;
    target_days_span: number;
    max_days_span: number;
  };
  totals: {
    shard_count: number;
    pack_count: number;
    item_count: number;
    estimated_tokens: number;
    estimated_chunks: number;
  };
  shards: AdaptiveShardPlanItem[];
}

export interface MaterializedAdaptiveShard {
  shard: AdaptiveShardPlanItem;
  packs: EvidencePack[];
}

interface AdaptiveShardPlanOptions {
  personaSlug?: string;
  maxEstimatedTokens?: number;
  maxEstimatedChunks?: number;
  maxPackCount?: number;
  maxTopicalEntropy?: number;
  maxRuntimeCostHint?: number;
  minTopicSimilarity?: number;
  relaxedTopicSimilarity?: number;
  interClusterSimilarity?: number;
  planningBucketDays?: number;
  targetDaysSpan?: number;
  maxDaysSpan?: number;
}

interface PackEnvelope {
  pack: EvidencePack;
  dominantTopic: string;
  topicSignature: string[];
  topicFamilies: string[];
  time: number;
  timeBucket: string;
}

interface AdaptiveTopicCluster {
  sourceType: string;
  timeBucket: string;
  packs: PackEnvelope[];
}

export function planAdaptiveShards(
  packs: EvidencePack[],
  options: AdaptiveShardPlanOptions = {}
): AdaptiveShardPlan {
  const maxEstimatedTokens = Math.max(1000, options.maxEstimatedTokens ?? 6000);
  const maxEstimatedChunks = Math.max(2, options.maxEstimatedChunks ?? 18);
  const maxPackCount = Math.max(1, options.maxPackCount ?? 6);
  const maxTopicalEntropy = Math.max(0.1, options.maxTopicalEntropy ?? 0.95);
  const maxRuntimeCostHint = Math.max(0.5, options.maxRuntimeCostHint ?? 2.8);
  const minTopicSimilarity = clampUnit(options.minTopicSimilarity ?? 0.14);
  const relaxedTopicSimilarity = clampUnit(
    options.relaxedTopicSimilarity ?? Math.max(0.08, minTopicSimilarity * 0.55)
  );
  const interClusterSimilarity = clampUnit(
    options.interClusterSimilarity ?? Math.max(0.1, minTopicSimilarity * 0.85)
  );
  const targetDaysSpan = Math.max(7, options.targetDaysSpan ?? 60);
  const maxDaysSpan = Math.max(targetDaysSpan, options.maxDaysSpan ?? 90);
  const planningBucketDays = Math.max(7, options.planningBucketDays ?? derivePlanningBucketDays(targetDaysSpan));
  const clusters = buildAdaptiveTopicClusters(packs, {
    minTopicSimilarity,
    relaxedTopicSimilarity,
    planningBucketDays,
  });
  const shards: AdaptiveShardPlanItem[] = [];

  let current: EvidencePack[] = [];
  let currentTokens = 0;
  let currentChunks = 0;
  let currentRuntime = 0;

  const flush = () => {
    if (current.length === 0) return;
    const topicSignatures = collectTopTopics(current);
    const sourceTypeCounts: Record<string, number> = {};
    for (const pack of current) {
      sourceTypeCounts[pack.source_type] = (sourceTypeCounts[pack.source_type] ?? 0) + 1;
    }
    const startedAt = current
      .map((pack) => pack.time_window.started_at)
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    const endedAt = current
      .map((pack) => pack.time_window.ended_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .slice(-1)[0];
    const daysSpan = startedAt && endedAt
      ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 86_400_000))
      : 0;

    shards.push({
      shard_id: `adaptive-shard-${String(shards.length + 1).padStart(3, '0')}`,
      index: shards.length,
      pack_ids: current.map((pack) => pack.id),
      pack_count: current.length,
      item_count: current.reduce((sum, pack) => sum + pack.stats.item_count, 0),
      estimated_tokens: currentTokens,
      estimated_chunks: currentChunks,
      source_type_counts: sourceTypeCounts,
      topic_signatures: topicSignatures,
      dominant_topic: resolveDominantTopic(current),
      dominant_topic_concentration: computeDominantTopicConcentration(current),
      topical_entropy: computeTopicalEntropy(current),
      avg_pack_value: average(current.map((pack) => pack.scores.value)),
      runtime_cost_hint: clampRuntime(currentRuntime),
      started_at: startedAt,
      ended_at: endedAt,
      days_span: daysSpan,
    });

    current = [];
    currentTokens = 0;
    currentChunks = 0;
    currentRuntime = 0;
  };

  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
    const cluster = clusters[clusterIndex];
    for (const envelope of cluster.packs) {
      const pack = envelope.pack;
      const packTokens = pack.stats.estimated_tokens;
      const packChunks = Math.max(1, Math.ceil(packTokens / 500));
      const packRuntime = estimateRuntimeCost(pack);
      const candidate = [...current, pack];
      const nextEntropy = computeTopicalEntropy(candidate);
      const nextDaysSpan = computeDaysSpan(candidate);
      const topicSimilarity = current.length === 0 ? 1 : computePackSetSimilarity(pack, current);
      const dominantTopicMismatch =
        current.length >= 2 &&
        envelope.dominantTopic !== resolveDominantTopic(current) &&
        topicSimilarity < relaxedTopicSimilarity;

      const topicalEntropyExceeded =
        current.length >= 3 && nextEntropy > maxTopicalEntropy;
      const softDaysSpanExceeded =
        current.length >= 3 &&
        nextDaysSpan > targetDaysSpan &&
        currentTokens >= Math.round(maxEstimatedTokens * 0.55);
      const hardDaysSpanExceeded =
        current.length > 0 && nextDaysSpan > maxDaysSpan;

      const exceedsBudget =
        current.length >= maxPackCount ||
        currentTokens + packTokens > maxEstimatedTokens ||
        currentChunks + packChunks > maxEstimatedChunks ||
        currentRuntime + packRuntime > maxRuntimeCostHint ||
        topicalEntropyExceeded ||
        softDaysSpanExceeded ||
        hardDaysSpanExceeded ||
        dominantTopicMismatch;

      if (current.length > 0 && exceedsBudget) {
        flush();
      }

      current.push(pack);
      currentTokens += packTokens;
      currentChunks += packChunks;
      currentRuntime += packRuntime;
    }

    const nextCluster = clusters[clusterIndex + 1];
    if (!nextCluster || !shouldCarryShardAcrossClusters(current, cluster, nextCluster, interClusterSimilarity, maxDaysSpan)) {
      flush();
    }
  }

  flush();

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    persona_slug: options.personaSlug,
    planner_version: 'adaptive-v1.1',
    strategy: 'budget_based_v1',
    config: {
      max_estimated_tokens: maxEstimatedTokens,
      max_estimated_chunks: maxEstimatedChunks,
      max_pack_count: maxPackCount,
      max_topical_entropy: maxTopicalEntropy,
      max_runtime_cost_hint: maxRuntimeCostHint,
      min_topic_similarity: minTopicSimilarity,
      relaxed_topic_similarity: relaxedTopicSimilarity,
      inter_cluster_similarity: interClusterSimilarity,
      planning_bucket_days: planningBucketDays,
      target_days_span: targetDaysSpan,
      max_days_span: maxDaysSpan,
    },
    totals: {
      shard_count: shards.length,
      pack_count: packs.length,
      item_count: packs.reduce((sum, pack) => sum + pack.stats.item_count, 0),
      estimated_tokens: shards.reduce((sum, shard) => sum + shard.estimated_tokens, 0),
      estimated_chunks: shards.reduce((sum, shard) => sum + shard.estimated_chunks, 0),
    },
    shards,
  };
}

export function materializeAdaptiveShardPacks(
  packs: EvidencePack[],
  plan: AdaptiveShardPlan
): MaterializedAdaptiveShard[] {
  const packById = new Map(packs.map((pack) => [pack.id, pack]));
  return plan.shards.map((shard) => ({
    shard,
    packs: shard.pack_ids.map((id) => packById.get(id)).filter((pack): pack is EvidencePack => Boolean(pack)),
  }));
}

export function writeAdaptiveShardPlanAssets(personaDir: string, plan: AdaptiveShardPlan): void {
  mkdirSync(personaDir, { recursive: true });
  writeFileSync(join(personaDir, 'adaptive-shard-plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
}

function buildAdaptiveTopicClusters(
  packs: EvidencePack[],
  options: {
    minTopicSimilarity: number;
    relaxedTopicSimilarity: number;
    planningBucketDays: number;
  }
): AdaptiveTopicCluster[] {
  const groups = new Map<string, AdaptiveTopicCluster[]>();
  const envelopes = packs.map((pack) => toPackEnvelope(pack, options.planningBucketDays)).sort(comparePackEnvelopes);

  for (const envelope of envelopes) {
    const key = `${envelope.pack.source_type}::${envelope.timeBucket}`;
    const clusters = groups.get(key) ?? [];
    const bestCluster = selectBestCluster(clusters, envelope, options);
    if (bestCluster) {
      bestCluster.packs.push(envelope);
    } else {
      clusters.push({
        sourceType: envelope.pack.source_type,
        timeBucket: envelope.timeBucket,
        packs: [envelope],
      });
    }
    groups.set(key, clusters);
  }

  return [...groups.values()]
    .flat()
    .map((cluster) => ({
      ...cluster,
      packs: [...cluster.packs].sort(comparePackEnvelopes),
    }))
    .sort(compareClusters);
}

function toPackEnvelope(pack: EvidencePack, planningBucketDays: number): PackEnvelope {
  const topicSignature = extractPackTopicFeatures(pack);
  return {
    pack,
    dominantTopic: topicSignature[0] ?? pack.topic_signature[0] ?? 'topic:unknown',
    topicSignature,
    topicFamilies: readStringArray(pack.metadata?.topic_families),
    time: parseDate(pack.time_window.started_at)?.getTime() ?? Number.MAX_SAFE_INTEGER,
    timeBucket: formatTimeBucket(pack.time_window.started_at, planningBucketDays),
  };
}

function selectBestCluster(
  clusters: AdaptiveTopicCluster[],
  envelope: PackEnvelope,
  options: {
    minTopicSimilarity: number;
    relaxedTopicSimilarity: number;
  }
): AdaptiveTopicCluster | null {
  let bestCluster: AdaptiveTopicCluster | null = null;
  let bestScore = -1;

  for (const cluster of clusters) {
    const score = computeClusterFitScore(cluster, envelope);
    const dominantMatch = resolveClusterDominantTopic(cluster) === envelope.dominantTopic;
    const threshold = dominantMatch ? options.relaxedTopicSimilarity : options.minTopicSimilarity;
    if (score >= threshold && score > bestScore) {
      bestCluster = cluster;
      bestScore = score;
    }
  }

  return bestCluster;
}

function computeClusterFitScore(cluster: AdaptiveTopicCluster, envelope: PackEnvelope): number {
  const clusterTopics = collectClusterTopics(cluster);
  const topicSimilarity = jaccard(clusterTopics, envelope.topicSignature);
  const dominantMatch = resolveClusterDominantTopic(cluster) === envelope.dominantTopic ? 0.28 : 0;
  const timeProximity = scoreTimeProximity(cluster, envelope);
  return clampUnit(topicSimilarity + dominantMatch + timeProximity);
}

function collectClusterTopics(cluster: AdaptiveTopicCluster): string[] {
  const counts = new Map<string, number>();
  for (const pack of cluster.packs) {
    for (const topic of pack.topicSignature.slice(0, 4)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([topic]) => topic);
}

function scoreTimeProximity(cluster: AdaptiveTopicCluster, envelope: PackEnvelope): number {
  const clusterTimes = cluster.packs
    .map((entry) => entry.time)
    .filter((value) => Number.isFinite(value));
  if (clusterTimes.length === 0 || !Number.isFinite(envelope.time)) return 0;
  const latest = Math.max(...clusterTimes);
  const gapDays = Math.abs(envelope.time - latest) / 86_400_000;
  if (gapDays <= 7) return 0.08;
  if (gapDays <= 30) return 0.05;
  if (gapDays <= 60) return 0.02;
  return 0;
}

function comparePackEnvelopes(a: PackEnvelope, b: PackEnvelope): number {
  if (a.pack.source_type !== b.pack.source_type) return a.pack.source_type.localeCompare(b.pack.source_type);
  if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
  if (a.dominantTopic !== b.dominantTopic) return a.dominantTopic.localeCompare(b.dominantTopic);
  if (a.time !== b.time) return a.time - b.time;
  if (a.pack.scores.value !== b.pack.scores.value) return b.pack.scores.value - a.pack.scores.value;
  return a.pack.id.localeCompare(b.pack.id);
}

function compareClusters(a: AdaptiveTopicCluster, b: AdaptiveTopicCluster): number {
  if (a.sourceType !== b.sourceType) return a.sourceType.localeCompare(b.sourceType);
  if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
  const aDominant = resolveClusterDominantTopic(a);
  const bDominant = resolveClusterDominantTopic(b);
  if (aDominant !== bDominant) return aDominant.localeCompare(bDominant);
  const aTime = Math.min(...a.packs.map((pack) => pack.time));
  const bTime = Math.min(...b.packs.map((pack) => pack.time));
  if (aTime !== bTime) return aTime - bTime;
  return b.packs.length - a.packs.length;
}

function resolveClusterDominantTopic(cluster: AdaptiveTopicCluster): string {
  const counts = new Map<string, number>();
  for (const pack of cluster.packs) {
    counts.set(pack.dominantTopic, (counts.get(pack.dominantTopic) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'topic:unknown';
}

function collectTopTopics(packs: EvidencePack[]): string[] {
  const counts = new Map<string, number>();
  for (const pack of packs) {
    for (const topic of extractPackTopicFeatures(pack).slice(0, 6)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([topic]) => topic);
}

function collectDominantTopicCounts(packs: EvidencePack[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pack of packs) {
    const dominant = extractPackTopicFeatures(pack)[0] ?? pack.topic_signature[0] ?? 'topic:unknown';
    counts.set(dominant, (counts.get(dominant) ?? 0) + 1);
  }
  return counts;
}

function resolveDominantTopic(packs: EvidencePack[]): string | undefined {
  return [...collectDominantTopicCounts(packs).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function computeDominantTopicConcentration(packs: EvidencePack[]): number {
  const counts = [...collectDominantTopicCounts(packs).values()].sort((a, b) => b - a);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0 || counts.length === 0) return 0;
  return Number((counts[0] / total).toFixed(6));
}

function computeTopicalEntropy(packs: EvidencePack[]): number {
  const counts = collectDominantTopicCounts(packs);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const value of counts.values()) {
    const p = value / total;
    entropy += -p * Math.log2(p);
  }
  const normalized = counts.size <= 1 ? 0 : entropy / Math.log2(counts.size);
  return Number(normalized.toFixed(6));
}

function computePackSetSimilarity(pack: EvidencePack, current: EvidencePack[]): number {
  return jaccard(extractPackTopicFeatures(pack), collectTopTopics(current));
}

function shouldCarryShardAcrossClusters(
  current: EvidencePack[],
  cluster: AdaptiveTopicCluster,
  nextCluster: AdaptiveTopicCluster,
  interClusterSimilarity: number,
  maxDaysSpan: number
): boolean {
  if (current.length === 0) return false;
  if (cluster.sourceType !== nextCluster.sourceType) return false;

  const currentTopics = collectTopTopics(current);
  const nextTopics = collectClusterTopics(nextCluster);
  const topicalSimilarity = jaccard(currentTopics, nextTopics);
  const dominantMatches =
    resolveDominantTopic(current) !== undefined &&
    resolveDominantTopic(current) === resolveClusterDominantTopic(nextCluster);
  const nextDaysSpan = computeDaysSpan([
    ...current,
    ...nextCluster.packs.map((entry) => entry.pack),
  ]);
  if (nextDaysSpan > maxDaysSpan) return false;

  return dominantMatches || topicalSimilarity >= interClusterSimilarity;
}

function estimateRuntimeCost(pack: EvidencePack): number {
  return Math.min(
    1.5,
    pack.stats.estimated_tokens / 5000 +
    pack.scores.duplication_pressure * 0.35 +
    (pack.scene_profile === 'mixed' ? 0.15 : 0) +
    (pack.primary_speaker_role === 'mixed' ? 0.1 : 0)
  );
}

function derivePlanningBucketDays(targetDaysSpan: number): number {
  return Math.max(21, Math.min(45, Math.round(targetDaysSpan / 2)));
}

function formatTimeBucket(value?: string, bucketDays = 30): string {
  const date = parseDate(value);
  if (!date) return 'time:unknown';
  const dayIndex = Math.floor(date.getTime() / 86_400_000 / bucketDays);
  return `time:${String(dayIndex).padStart(8, '0')}`;
}

function computeDaysSpan(packs: EvidencePack[]): number {
  const startedAt = packs
    .map((pack) => parseDate(pack.time_window.started_at))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const endedAt = packs
    .map((pack) => parseDate(pack.time_window.ended_at))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(-1)[0];
  if (!startedAt || !endedAt) return 0;
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 86_400_000));
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function clampRuntime(value: number): number {
  return Number(Math.max(0, value).toFixed(6));
}

function extractPackTopicFeatures(pack: EvidencePack): string[] {
  const topicFamilies = readStringArray(pack.metadata?.topic_families);
  const topicRoots = readStringArray(pack.metadata?.topic_roots);
  const topicTerms = readStringArray(pack.metadata?.topic_terms);
  const combined = [...topicRoots, ...topicFamilies, ...topicTerms, ...pack.topic_signature]
    .filter((value) => typeof value === 'string' && value.length > 0);
  return [...new Set(combined)].slice(0, 12);
}

function jaccard(a: string[], b: string[]): number {
  const aSet = new Set(a.filter(Boolean));
  const bSet = new Set(b.filter(Boolean));
  const intersection = [...aSet].filter((value) => bSet.has(value)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(6));
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

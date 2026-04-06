import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { InputRoutingStrategy } from './evidence-routing.js';
import { ShardDistillationResult } from './shard-distillation.js';

export interface GlobalSoulSeedItem {
  signal: string;
  signal_type: 'phrase' | 'keyword';
  keyword: string;
  shard_support: number;
  signal_count: number;
  confidence: number;
  supporting_shards: string[];
  representative_excerpts: string[];
}

export interface GlobalSoulTopicCluster {
  cluster_id: string;
  label: string;
  signal_count: number;
  member_signals: string[];
  member_signal_types: Array<'phrase' | 'keyword'>;
  shard_support: number;
  confidence: number;
  supporting_shards: string[];
  representative_excerpts: string[];
  cluster_terms: string[];
  topic_roots: string[];
  topic_families: string[];
}

export interface GlobalSoulSeed {
  schema_version: 1;
  generated_at: string;
  strategy: InputRoutingStrategy;
  shard_count: number;
  stable_signal_count: number;
  unstable_signal_count: number;
  topic_cluster_count: number;
  stable_signals: GlobalSoulSeedItem[];
  topic_clusters: GlobalSoulTopicCluster[];
}

export interface GlobalMemoryCandidate {
  keyword: string;
  shard_id: string;
  document_id: string;
  score: number;
  excerpt: string;
}

export interface GlobalMemoryCandidates {
  schema_version: 1;
  generated_at: string;
  strategy: InputRoutingStrategy;
  candidate_count: number;
  candidates: GlobalMemoryCandidate[];
}

export interface GlobalConflictItem {
  signal: string;
  signal_type: 'phrase' | 'keyword';
  keyword: string;
  shard_ids: string[];
  evidence_count: number;
  reason: string;
}

export interface GlobalConflicts {
  schema_version: 1;
  generated_at: string;
  strategy: InputRoutingStrategy;
  conflict_count: number;
  conflicts: GlobalConflictItem[];
}

export interface TrainingSeed {
  schema_version: 1;
  generated_at: string;
  strategy: InputRoutingStrategy;
  shard_count: number;
  stable_keywords: string[];
  stable_topics: string[];
  stable_topic_roots: string[];
  stable_topic_families: string[];
  stable_signal_count: number;
  topic_cluster_count: number;
  memory_candidate_count: number;
  conflict_count: number;
}

export interface GlobalMergeResult {
  soulSeed: GlobalSoulSeed;
  memoryCandidates: GlobalMemoryCandidates;
  conflicts: GlobalConflicts;
  trainingSeed: TrainingSeed;
}

export function mergeShardDistillationResults(
  results: ShardDistillationResult[],
  options: {
    strategy?: InputRoutingStrategy;
    minShardsForStableSignal?: number;
    maxStableSignals?: number;
    maxMemoryCandidates?: number;
  } = {}
): GlobalMergeResult {
  const strategy = options.strategy ?? inferStrategy(results);
  const minShardsForStableSignal = Math.max(2, options.minShardsForStableSignal ?? 2);
  const maxStableSignals = Math.max(4, options.maxStableSignals ?? 24);
  const maxMemoryCandidates = Math.max(4, options.maxMemoryCandidates ?? 40);
  const signalStats = collectSignalStats(results);
  const stable = [...signalStats.values()]
    .filter((item) => item.shardIds.size >= minShardsForStableSignal && isMeaningfulStableSignal(item))
    .sort(compareSignalStats)
    .slice(0, maxStableSignals);
  const unstable = [...signalStats.values()].filter((item) => item.shardIds.size < minShardsForStableSignal);
  const stableSignals = stable.map((item) => ({
    signal: item.signal,
    signal_type: item.signalType,
    keyword: item.keyword,
    shard_support: item.shardIds.size,
    signal_count: item.count,
    confidence: computeStableConfidence(item.shardIds.size, item.count, results.length),
    supporting_shards: [...item.shardIds].sort(),
    representative_excerpts: [...item.excerpts].slice(0, 3),
  }));
  const topicClusters = buildTopicClusters(stableSignals).filter(isMeaningfulTopicCluster);

  const soulSeed: GlobalSoulSeed = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    strategy,
    shard_count: results.length,
    stable_signal_count: stable.length,
    unstable_signal_count: unstable.length,
    topic_cluster_count: topicClusters.length,
    stable_signals: stableSignals,
    topic_clusters: topicClusters,
  };

  const memoryCandidatesList = results
    .flatMap((result) =>
      result.memorySummary.context_examples.map((example) => ({
        keyword: example.keywords[0] ?? 'context',
        shard_id: result.shard.shard_id,
        document_id: example.document_id,
        score: example.score,
        excerpt: example.excerpt,
      }))
    )
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .slice(0, maxMemoryCandidates);

  const memoryCandidates: GlobalMemoryCandidates = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    strategy,
    candidate_count: memoryCandidatesList.length,
    candidates: memoryCandidatesList,
  };

  const stableSignalSet = new Set(stable.map((item) => `${item.signalType}:${item.signal}`));
  const conflictList = unstable
    .filter((item) =>
      !stableSignalSet.has(`${item.signalType}:${item.signal}`) &&
      shouldTrackConflictSignal(item)
    )
    .sort(compareSignalStats)
    .slice(0, 20)
    .map((item) => ({
      signal: item.signal,
      signal_type: item.signalType,
      keyword: item.keyword,
      shard_ids: [...item.shardIds].sort(),
      evidence_count: item.count,
      reason: `multi-signal ${item.signalType} did not meet cross-shard stability threshold`,
    }));

  const conflicts: GlobalConflicts = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    strategy,
    conflict_count: conflictList.length,
    conflicts: conflictList,
  };

  const fallbackTopicRoots = collectTopicRoots(
    soulSeed.stable_signals,
    soulSeed.stable_signals.flatMap((item) => item.representative_excerpts)
  );
  const fallbackTopicFamilies = collectTopicFamilies(fallbackTopicRoots);
  const stableTopicRoots = uniqueStrings([
    ...soulSeed.topic_clusters.flatMap((item) => item.topic_roots),
    ...fallbackTopicRoots,
  ]);
  const stableTopicFamilies = uniqueStrings([
    ...soulSeed.topic_clusters.flatMap((item) => item.topic_families),
    ...fallbackTopicFamilies,
  ]);

  const trainingSeed: TrainingSeed = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    strategy,
    shard_count: results.length,
    stable_keywords: soulSeed.stable_signals.map((item) => item.signal),
    stable_topics: buildTrainingSeedTopics(soulSeed.topic_clusters, stableTopicRoots, stableTopicFamilies),
    stable_topic_roots: stableTopicRoots,
    stable_topic_families: stableTopicFamilies,
    stable_signal_count: soulSeed.stable_signal_count,
    topic_cluster_count: soulSeed.topic_cluster_count,
    memory_candidate_count: memoryCandidates.candidate_count,
    conflict_count: conflicts.conflict_count,
  };

  return {
    soulSeed,
    memoryCandidates,
    conflicts,
    trainingSeed,
  };
}

export function writeGlobalMergeAssets(personaDir: string, result: GlobalMergeResult): void {
  mkdirSync(personaDir, { recursive: true });
  writeFileSync(join(personaDir, 'global-soul-seed.json'), JSON.stringify(result.soulSeed, null, 2), 'utf-8');
  writeFileSync(join(personaDir, 'global-memory-candidates.json'), JSON.stringify(result.memoryCandidates, null, 2), 'utf-8');
  writeFileSync(join(personaDir, 'global-conflicts.json'), JSON.stringify(result.conflicts, null, 2), 'utf-8');
  writeFileSync(join(personaDir, 'training-seed.json'), JSON.stringify(result.trainingSeed, null, 2), 'utf-8');
}

function inferStrategy(results: ShardDistillationResult[]): InputRoutingStrategy {
  return results[0]?.soulSummary.strategy ?? 'legacy';
}

function collectSignalStats(results: ShardDistillationResult[]) {
  const map = new Map<string, {
    signal: string;
    signalType: 'phrase' | 'keyword';
    keyword: string;
    shardIds: Set<string>;
    count: number;
    excerpts: Set<string>;
    evidenceIds: Set<string>;
  }>();

  for (const result of results) {
    for (const signal of result.soulSummary.top_signals) {
      const evidenceId = `${result.shard.shard_id}:${signal.document_id}:${signal.chunk_id}`;
      const observedSignals: Array<{ signal: string; signalType: 'phrase' | 'keyword'; keyword: string }> = [
        ...signal.phrases.flatMap((phrase) =>
          derivePhraseSignals(phrase).map((variant) => ({
            signal: variant,
            signalType: 'phrase' as const,
            keyword: variant,
          }))
        ),
        ...signal.keywords.map((keyword) => ({
          signal: keyword,
          signalType: 'keyword' as const,
          keyword,
        })),
      ];

      for (const observed of observedSignals) {
        const key = `${observed.signalType}:${observed.signal}`;
        const current = map.get(key) ?? {
          signal: observed.signal,
          signalType: observed.signalType,
          keyword: observed.keyword,
          shardIds: new Set<string>(),
          count: 0,
          excerpts: new Set<string>(),
          evidenceIds: new Set<string>(),
        };
        current.shardIds.add(result.shard.shard_id);
        if (!current.evidenceIds.has(evidenceId)) {
          current.evidenceIds.add(evidenceId);
          current.count += 1;
        }
        if (signal.excerpt) current.excerpts.add(signal.excerpt);
        map.set(key, current);
      }
    }
  }

  return map;
}

function buildTopicClusters(stableSignals: GlobalSoulSeedItem[]): GlobalSoulTopicCluster[] {
  if (stableSignals.length === 0) return [];

  const visited = new Set<number>();
  const clusters: GlobalSoulTopicCluster[] = [];

  for (let i = 0; i < stableSignals.length; i++) {
    if (visited.has(i)) continue;
    const queue = [i];
    const group: number[] = [];
    visited.add(i);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      group.push(current);
      for (let j = 0; j < stableSignals.length; j++) {
        if (visited.has(j)) continue;
        if (shouldClusterSignals(stableSignals[current], stableSignals[j])) {
          visited.add(j);
          queue.push(j);
        }
      }
    }

    const members = group.map((index) => stableSignals[index]);
    const labelSource = [...members].sort(compareStableSeedItems)[0];
    const supportingShards = new Set<string>(members.flatMap((item) => item.supporting_shards));
    const excerpts = new Set<string>(members.flatMap((item) => item.representative_excerpts));
    const clusterTerms = collectClusterTerms(members);
    const topicRoots = collectTopicRoots(members, [...excerpts]);
    const topicFamilies = collectTopicFamilies(topicRoots);
    clusters.push({
      cluster_id: `cluster-${String(clusters.length + 1).padStart(3, '0')}`,
      label: labelSource?.signal ?? `cluster-${clusters.length + 1}`,
      signal_count: members.reduce((sum, item) => sum + item.signal_count, 0),
      member_signals: members.map((item) => item.signal),
      member_signal_types: members.map((item) => item.signal_type),
      shard_support: supportingShards.size,
      confidence: members.reduce((max, item) => Math.max(max, item.confidence), 0),
      supporting_shards: [...supportingShards].sort(),
      representative_excerpts: [...excerpts].slice(0, 3),
      cluster_terms: clusterTerms,
      topic_roots: topicRoots,
      topic_families: topicFamilies,
    });
  }

  return clusters.sort((a, b) =>
    b.shard_support - a.shard_support ||
    b.confidence - a.confidence ||
    b.signal_count - a.signal_count ||
    b.label.length - a.label.length ||
    a.label.localeCompare(b.label)
  );
}

function isMeaningfulTopicCluster(cluster: GlobalSoulTopicCluster): boolean {
  const domainHits = cluster.cluster_terms.filter((term) => MERGE_DOMAIN_TERMS.has(term)).length;
  if (cluster.shard_support >= 4 && domainHits >= 1 && cluster.signal_count >= 4) return true;
  if (cluster.shard_support >= 3 && domainHits >= 2) return true;
  if (cluster.signal_count >= 6 && domainHits >= 1) return true;
  return false;
}

function compareSignalStats(
  a: { signal: string; signalType: 'phrase' | 'keyword'; shardIds: Set<string>; count: number },
  b: { signal: string; signalType: 'phrase' | 'keyword'; shardIds: Set<string>; count: number }
): number {
  const typeBiasA = a.signalType === 'phrase' ? 1 : 0;
  const typeBiasB = b.signalType === 'phrase' ? 1 : 0;
  return (
    b.shardIds.size - a.shardIds.size ||
    typeBiasB - typeBiasA ||
    b.count - a.count ||
    b.signal.length - a.signal.length ||
    a.signal.localeCompare(b.signal)
  );
}

function compareStableSeedItems(a: GlobalSoulSeedItem, b: GlobalSoulSeedItem): number {
  const typeBiasA = a.signal_type === 'phrase' ? 1 : 0;
  const typeBiasB = b.signal_type === 'phrase' ? 1 : 0;
  return (
    typeBiasB - typeBiasA ||
    b.shard_support - a.shard_support ||
    b.confidence - a.confidence ||
    b.signal_count - a.signal_count ||
    b.signal.length - a.signal.length ||
    a.signal.localeCompare(b.signal)
  );
}

function shouldTrackConflictSignal(item: {
  signal: string;
  signalType: 'phrase' | 'keyword';
  shardIds: Set<string>;
  count: number;
}): boolean {
  if (!isMeaningfulStableSignal(item)) return false;
  if (item.signalType === 'phrase') {
    return item.count >= 3 && item.signal.length >= 12;
  }
  return item.count >= 2 && (item.signal.length >= 5 || MERGE_DOMAIN_TERMS.has(item.signal));
}

function shouldClusterSignals(a: GlobalSoulSeedItem, b: GlobalSoulSeedItem): boolean {
  if (a.signal === b.signal) return true;
  const excerptOverlap = countOverlap(a.representative_excerpts, b.representative_excerpts);
  if (excerptOverlap >= 1) return true;

  const aTokens = signalTerms(a.signal);
  const bTokens = signalTerms(b.signal);
  const overlap = [...aTokens].filter((token) => bTokens.has(token));
  if (overlap.length === 0) return false;
  if (overlap.some((token) => MERGE_DOMAIN_TERMS.has(token) || token.length >= 5)) return true;

  const unionSize = new Set([...aTokens, ...bTokens]).size;
  return unionSize > 0 && overlap.length / unionSize >= 0.5;
}

function derivePhraseSignals(phrase: string): string[] {
  const normalized = phrase
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const tokens = normalized.split(' ').filter(Boolean);
  const kept = new Set<string>([normalized]);
  const content = tokens.filter((token) => !MERGE_STOPWORDS.has(token));

  for (let size = 2; size <= 3; size++) {
    for (let start = 0; start <= content.length - size; start++) {
      const slice = content.slice(start, start + size);
      if (!slice.some((token) => MERGE_DOMAIN_TERMS.has(token) || token.length >= 5)) continue;
      kept.add(slice.join(' '));
    }
  }

  return [...kept]
    .filter((item) => item.length >= 7)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function countOverlap(a: string[], b: string[]): number {
  const right = new Set(b);
  let overlap = 0;
  for (const item of a) {
    if (right.has(item)) overlap += 1;
  }
  return overlap;
}

function signalTerms(signal: string): Set<string> {
  return new Set(
    signal
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token && !MERGE_STOPWORDS.has(token))
  );
}

function collectClusterTerms(members: GlobalSoulSeedItem[]): string[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    for (const token of signalTerms(member.signal)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function collectTopicRoots(members: GlobalSoulSeedItem[], excerpts: string[]): string[] {
  const counts = new Map<string, number>();
  const texts = [
    ...members.map((member) => member.signal),
    ...members.flatMap((member) => member.representative_excerpts),
    ...excerpts,
  ];

  for (const text of texts) {
    for (const token of mergeTokenizeTerms(text)) {
      const root = normalizeMergeTopicRoot(token);
      if (!root || shouldSkipMergeTopicRoot(root)) continue;
      counts.set(root, (counts.get(root) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([root]) => root);
}

function collectTopicFamilies(topicRoots: string[]): string[] {
  const counts = new Map<string, number>();
  for (const root of topicRoots) {
    const family = MERGE_TOPIC_FAMILY_SEEDS.get(root);
    if (!family) continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([family]) => family);
}

function mergeTokenizeTerms(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[\p{Script=Han}]{2,}|[\p{Letter}\p{Number}_-]{3,}/gu) ?? []
  )
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeMergeTopicRoot(token: string): string {
  const direct = MERGE_TOPIC_ROOT_ALIASES.get(token);
  if (direct) return direct;

  let normalized = token.toLowerCase();
  normalized = normalized.replace(/(?:ing)$/i, '');
  normalized = normalized.replace(/(?:ations|ation)$/i, 'ate');
  normalized = normalized.replace(/(?:izers|izer)$/i, 'ize');
  normalized = normalized.replace(/(?:ments|ment)$/i, '');
  normalized = normalized.replace(/(?:ers|er)$/i, '');
  normalized = normalized.replace(/(?:ies)$/i, 'y');
  normalized = normalized.replace(/(?:ed)$/i, '');
  normalized = normalized.replace(/(?:s)$/i, '');

  return MERGE_TOPIC_ROOT_ALIASES.get(normalized) ?? normalized;
}

function shouldSkipMergeTopicRoot(root: string): boolean {
  return MERGE_STOPWORDS.has(root) || GENERIC_CLUSTER_TERMS.has(root) || root.length < 4;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildTrainingSeedTopics(
  topicClusters: GlobalSoulTopicCluster[],
  stableTopicRoots: string[],
  stableTopicFamilies: string[]
): string[] {
  const clusterLabels = uniqueStrings(topicClusters.map((item) => item.label)).filter(isUsableTrainingTopicLabel);
  const familyLabels = uniqueStrings(stableTopicFamilies.map((value) => humanizeTopicFamily(value))).filter(Boolean);
  const rootLabels = uniqueStrings(stableTopicRoots).filter(isUsableTrainingTopicRoot);
  return uniqueStrings([
    ...clusterLabels,
    ...familyLabels,
    ...rootLabels.slice(0, 6),
  ]);
}

function isMeaningfulStableSignal(item: {
  signal: string;
  signalType: 'phrase' | 'keyword';
}): boolean {
  const terms = [...signalTerms(item.signal)];
  if (terms.length === 0) return false;
  const domainHits = terms.filter((term) => MERGE_DOMAIN_TERMS.has(term));
  const genericHits = terms.filter((term) => GENERIC_CLUSTER_TERMS.has(term));

  if (item.signalType === 'keyword') {
    if (GENERIC_CLUSTER_TERMS.has(item.signal)) return false;
    return MERGE_DOMAIN_TERMS.has(item.signal) || item.signal.length >= 6;
  }

  if (domainHits.length >= 1) return true;
  const longTerms = terms.filter((term) => term.length >= 6 && !GENERIC_CLUSTER_TERMS.has(term));
  return longTerms.length >= 2 && genericHits.length < terms.length;
}

function isUsableTrainingTopicLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('family:')) return false;

  const tokens = normalized
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.every((token) => TRAINING_TOPIC_BLOCKLIST.has(token))) return false;
  if (tokens.length === 1) return isUsableTrainingTopicRoot(tokens[0] ?? '');
  return tokens.some((token) => MERGE_DOMAIN_TERMS.has(token) || token.length >= 5);
}

function isUsableTrainingTopicRoot(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length < 4) return false;
  if (MERGE_STOPWORDS.has(normalized)) return false;
  if (GENERIC_CLUSTER_TERMS.has(normalized)) return false;
  if (TRAINING_TOPIC_BLOCKLIST.has(normalized)) return false;
  return true;
}

function humanizeTopicFamily(value: string): string {
  const normalized = value.trim().toLowerCase();
  const mapped = TOPIC_FAMILY_LABELS.get(normalized);
  if (mapped) return mapped;
  if (!normalized.startsWith('family:')) return '';
  return normalized.slice('family:'.length).replace(/[_-]+/g, ' ').trim();
}

const MERGE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'but',
  'for',
  'from',
  'how',
  'into',
  'not',
  'that',
  'the',
  'their',
  'there',
  'they',
  'this',
  'with',
]);

const MERGE_DOMAIN_TERMS = new Set([
  'agent',
  'attention',
  'chatgpt',
  'command',
  'conversation',
  'data',
  'engineering',
  'evaluation',
  'feedback',
  'human',
  'llm',
  'memory',
  'model',
  'privacy',
  'prompt',
  'reasoning',
  'research',
  'runtime',
  'supervision',
  'system',
  'tooling',
  'training',
]);

const GENERIC_CLUSTER_TERMS = new Set([
  'added',
  'agree',
  'already',
  'answer',
  'anything',
  'beautiful',
  'best',
  'better',
  'build',
  'case',
  'clear',
  'great',
  'maybe',
  'note',
  'pretty',
  'really',
  'something',
  'think',
  'thing',
  'used',
  'using',
  'work',
]);

const TRAINING_TOPIC_BLOCKLIST = new Set([
  'anyone',
  'anything',
  'capability',
  'everything',
  'everywhere',
  'even',
  'grade',
  'have',
  'human',
  'just',
  'many',
  'more',
  'much',
  'people',
  'some',
  'someone',
  'stuff',
  'that',
  'them',
  'then',
  'there',
  'these',
  'they',
  'should',
  'very',
  'what',
  'when',
  'where',
  'which',
  'with',
]);

const MERGE_TOPIC_ROOT_ALIASES = new Map<string, string>([
  ['agents', 'agent'],
  ['modeling', 'model'],
  ['modelling', 'model'],
  ['models', 'model'],
  ['training', 'training'],
  ['train', 'training'],
  ['trained', 'training'],
  ['trainer', 'training'],
  ['trainers', 'training'],
  ['compute', 'compute'],
  ['computer', 'compute'],
  ['computers', 'compute'],
  ['computing', 'compute'],
  ['computation', 'compute'],
  ['computations', 'compute'],
  ['networks', 'network'],
  ['neural', 'network'],
  ['infer', 'inference'],
  ['inferencing', 'inference'],
  ['activations', 'activation'],
  ['activation', 'activation'],
  ['transformers', 'transformer'],
  ['coding', 'code'],
  ['coder', 'code'],
  ['coders', 'code'],
  ['codes', 'code'],
  ['datasets', 'data'],
  ['datapoints', 'data'],
  ['reasoning', 'reason'],
  ['reasons', 'reason'],
  ['memorys', 'memory'],
]);

const MERGE_TOPIC_FAMILY_SEEDS = new Map<string, string>([
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
  ['agent', 'family:llm_agents'],
  ['llama', 'family:llm_agents'],
  ['chatgpt', 'family:llm_agents'],
  ['claude', 'family:llm_agents'],
  ['prompt', 'family:llm_agents'],
  ['code', 'family:software_build'],
  ['app', 'family:software_build'],
  ['deploy', 'family:software_build'],
  ['software', 'family:software_build'],
  ['build', 'family:software_build'],
  ['research', 'family:research_work'],
  ['learn', 'family:research_work'],
  ['eval', 'family:research_work'],
  ['image', 'family:media_content'],
  ['video', 'family:media_content'],
  ['podcast', 'family:media_content'],
  ['text', 'family:media_content'],
]);

const TOPIC_FAMILY_LABELS = new Map<string, string>([
  ['family:ml_training', 'ml training systems'],
  ['family:ml_infra', 'ml infrastructure'],
  ['family:llm_agents', 'llm agents'],
  ['family:software_build', 'software building'],
  ['family:research_work', 'research workflows'],
  ['family:media_content', 'media content'],
]);

function computeStableConfidence(shardSupport: number, signalCount: number, totalShards: number): number {
  const shardRatio = totalShards > 0 ? shardSupport / totalShards : 0;
  const signalBoost = Math.min(0.25, signalCount * 0.04);
  return Math.max(0, Math.min(1, 0.45 + shardRatio * 0.4 + signalBoost));
}

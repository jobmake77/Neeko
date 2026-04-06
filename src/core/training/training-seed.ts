import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type TrainingSeedMode = 'off' | 'topics' | 'signals';

export interface TrainingSeedGateStatus {
  applied: boolean;
  ready: boolean;
  readiness_score: number;
  fallback_mode?: TrainingSeedMode;
  summary: string;
  stats?: {
    raw_topic_count: number;
    raw_signal_count: number;
    usable_topic_count: number;
    usable_signal_count: number;
    multiword_signal_count: number;
    family_count: number;
    noise_ratio: number;
  };
}

export interface TrainingSeedSelection {
  requested_mode: TrainingSeedMode;
  mode: TrainingSeedMode;
  hints: string[];
  reason: string;
  gate: TrainingSeedGateStatus;
}

interface StoredTrainingSeed {
  stable_keywords?: string[];
  stable_topics?: string[];
  stable_topic_roots?: string[];
  stable_topic_families?: string[];
  stable_signal_count?: number;
  topic_cluster_count?: number;
}

export function normalizeTrainingSeedMode(raw?: string, fallback: TrainingSeedMode = 'off'): TrainingSeedMode {
  const value = String(raw ?? fallback).toLowerCase();
  if (value === 'topics' || value === 'signals') return value;
  return 'off';
}

export function loadTrainingSeedHints(
  personaDir: string,
  mode: TrainingSeedMode,
  limit = 8
): TrainingSeedSelection {
  if (mode === 'off') {
    return {
      requested_mode: mode,
      mode,
      hints: [],
      reason: 'training-seed mode disabled',
      gate: {
        applied: false,
        ready: false,
        readiness_score: 0,
        summary: 'training-seed mode disabled',
      },
    };
  }

  const path = join(personaDir, 'training-seed.json');
  if (!existsSync(path)) {
    return {
      requested_mode: mode,
      mode,
      hints: [],
      reason: 'training-seed.json not found',
      gate: {
        applied: false,
        ready: false,
        readiness_score: 0,
        summary: 'training-seed.json not found',
      },
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as StoredTrainingSeed;
    const topicHints = selectTopicHints(
      parsed.stable_topics ?? [],
      parsed.stable_topic_roots ?? [],
      parsed.stable_topic_families ?? [],
      limit
    );
    const signalHints = selectCombinedSignalHints(
      parsed.stable_topics ?? [],
      parsed.stable_keywords ?? [],
      parsed.stable_topic_roots ?? [],
      parsed.stable_topic_families ?? [],
      limit
    );
    const gate = mode === 'signals'
      ? evaluateSignalReadiness(parsed, topicHints, signalHints)
      : {
          applied: false,
          ready: mode === 'topics',
          readiness_score: 0,
          summary: mode === 'topics' ? 'topic hints requested directly' : 'training-seed mode disabled',
        };
    const effectiveMode = gate.applied && !gate.ready
      ? gate.fallback_mode ?? 'topics'
      : mode;
    const hints = effectiveMode === 'topics' ? topicHints : effectiveMode === 'signals' ? signalHints : [];
    const baseReason = effectiveMode === 'topics'
      ? `loaded ${Math.max(0, parsed.topic_cluster_count ?? hints.length ?? 0)} topic clusters`
      : effectiveMode === 'signals'
        ? `loaded ${Math.max(0, parsed.stable_signal_count ?? hints.length ?? 0)} stable signals`
        : 'training-seed mode disabled';
    return {
      requested_mode: mode,
      mode: effectiveMode,
      hints,
      reason: gate.applied && !gate.ready
        ? `${baseReason}; signal gate fallback to ${effectiveMode} (${gate.summary})`
        : gate.applied
          ? `${baseReason}; signal gate ready (${gate.summary})`
          : baseReason,
      gate,
    };
  } catch {
    return {
      requested_mode: mode,
      mode,
      hints: [],
      reason: 'training-seed.json parse failed',
      gate: {
        applied: false,
        ready: false,
        readiness_score: 0,
        summary: 'training-seed.json parse failed',
      },
    };
  }
}

function evaluateSignalReadiness(
  parsed: StoredTrainingSeed,
  topicHints: string[],
  signalHints: string[]
): TrainingSeedGateStatus {
  const rawTopicCount = dedupeHints(parsed.stable_topics ?? []).length;
  const rawSignalCount = dedupeHints(parsed.stable_keywords ?? []).length;
  const usableTopicCount = topicHints.length;
  const usableSignalCount = signalHints.length;
  const multiwordSignalCount = signalHints.filter((hint) => /\s/.test(hint)).length;
  const familyCount = dedupeHints(parsed.stable_topic_families ?? [])
    .map((value) => humanizeTopicFamily(value))
    .filter(Boolean)
    .length;
  const gateApplies = rawSignalCount >= 12 || Math.max(0, parsed.stable_signal_count ?? 0) >= 12;
  const noiseRatio = rawSignalCount === 0
    ? 0
    : Math.max(0, rawSignalCount - usableSignalCount) / rawSignalCount;
  const readinessScore = computeSignalReadinessScore({
    rawTopicCount,
    rawSignalCount,
    usableTopicCount,
    usableSignalCount,
    multiwordSignalCount,
    familyCount,
    noiseRatio,
  });

  if (!gateApplies) {
    return {
      applied: false,
      ready: true,
      readiness_score: readinessScore,
      summary: 'signal gate skipped for compact seed set',
      stats: {
        raw_topic_count: rawTopicCount,
        raw_signal_count: rawSignalCount,
        usable_topic_count: usableTopicCount,
        usable_signal_count: usableSignalCount,
        multiword_signal_count: multiwordSignalCount,
        family_count: familyCount,
        noise_ratio: noiseRatio,
      },
    };
  }

  const ready =
    readinessScore >= SIGNAL_READINESS_THRESHOLD &&
    usableTopicCount >= 3 &&
    usableSignalCount >= 4 &&
    multiwordSignalCount >= 2 &&
    familyCount >= 1;
  const fallbackMode: TrainingSeedMode = usableTopicCount >= 2 ? 'topics' : 'off';
  return {
    applied: true,
    ready,
    readiness_score: readinessScore,
    fallback_mode: ready ? undefined : fallbackMode,
    summary: `score=${readinessScore.toFixed(2)}, usable_topics=${usableTopicCount}, usable_signals=${usableSignalCount}, multiword_signals=${multiwordSignalCount}, families=${familyCount}, noise=${noiseRatio.toFixed(2)}`,
    stats: {
      raw_topic_count: rawTopicCount,
      raw_signal_count: rawSignalCount,
      usable_topic_count: usableTopicCount,
      usable_signal_count: usableSignalCount,
      multiword_signal_count: multiwordSignalCount,
      family_count: familyCount,
      noise_ratio: noiseRatio,
    },
  };
}

function computeSignalReadinessScore(input: {
  rawTopicCount: number;
  rawSignalCount: number;
  usableTopicCount: number;
  usableSignalCount: number;
  multiwordSignalCount: number;
  familyCount: number;
  noiseRatio: number;
}): number {
  const topicRetention = input.rawTopicCount === 0 ? 0 : Math.min(1, input.usableTopicCount / input.rawTopicCount);
  const signalRetention = input.rawSignalCount === 0 ? 0 : Math.min(1, input.usableSignalCount / input.rawSignalCount);
  const multiwordQuality = input.usableSignalCount === 0 ? 0 : Math.min(1, input.multiwordSignalCount / input.usableSignalCount);
  const familyCoverage = Math.min(1, input.familyCount / 2);
  const score =
    topicRetention * 0.18 +
    signalRetention * 0.34 +
    multiwordQuality * 0.22 +
    familyCoverage * 0.16 +
    (1 - Math.min(1, input.noiseRatio)) * 0.10;
  return Math.max(0, Math.min(1, score));
}

function selectTopicHints(topics: string[], roots: string[], families: string[], limit: number): string[] {
  const prioritized = dedupeHints(topics).filter((hint) => isUsableTopicHint(hint));
  const rootHints = selectRootHints(roots, Math.min(3, Math.max(0, limit - prioritized.length)));
  const familyHints = selectFamilyHints(families, Math.min(2, Math.max(0, limit - prioritized.length - rootHints.length)));
  return dedupeHints([...prioritized, ...rootHints, ...familyHints]).slice(0, limit);
}

function selectCombinedSignalHints(
  topics: string[],
  signals: string[],
  roots: string[],
  families: string[],
  limit: number
): string[] {
  const topicBudget = Math.min(Math.max(2, Math.ceil(limit / 3)), limit);
  const topicHints = selectTopicHints(topics, roots, families, topicBudget);
  const rootBudget = Math.min(2, Math.max(0, limit - topicHints.length));
  const rootHints = selectRootHints(roots, rootBudget);
  const familyBudget = Math.min(1, Math.max(0, limit - topicHints.length - rootHints.length));
  const familyHints = selectFamilyHints(families, familyBudget);
  const signalHints = selectSignalHints(
    signals,
    Math.max(0, limit - topicHints.length - rootHints.length - familyHints.length)
  );
  return dedupeHints([...topicHints, ...rootHints, ...familyHints, ...signalHints]).slice(0, limit);
}

function selectSignalHints(values: string[], limit: number): string[] {
  const deduped = dedupeHints(values);
  const selected: string[] = [];
  const usedRoots = new Set<string>();
  const sorted = [...deduped]
    .filter((hint) => isUsableSignalHint(hint))
    .sort((left, right) => scoreSignalHint(right) - scoreSignalHint(left) || right.length - left.length);

  for (const hint of sorted) {
    const root = normalizeSignalRoot(hint);
    const isPhrase = /\s/.test(hint);
    if (root && usedRoots.has(root) && !isPhrase) continue;
    selected.push(hint);
    if (root) usedRoots.add(root);
    if (selected.length >= limit) break;
  }

  return selected;
}

function dedupeHints(values: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of values) {
    const hint = String(raw ?? '').trim();
    if (!hint) continue;
    const key = hint.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(hint);
  }
  return cleaned;
}

function selectRootHints(values: string[], limit: number): string[] {
  return dedupeHints(values)
    .filter((hint) => isUsableRootHint(hint))
    .slice(0, limit);
}

function selectFamilyHints(values: string[], limit: number): string[] {
  return dedupeHints(values)
    .map((hint) => humanizeTopicFamily(hint))
    .filter(Boolean)
    .slice(0, limit);
}

function scoreSignalHint(value: string): number {
  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  const multiWordBonus = tokenCount >= 2 ? 4 : 0;
  const specificityBonus = Math.min(10, value.length) * 0.08;
  const tersePenalty = value.length <= 3 ? 1.5 : 0;
  return multiWordBonus + tokenCount * 0.7 + specificityBonus - tersePenalty;
}

function isUsableSignalHint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (SIGNAL_HINT_BLOCKLIST.has(normalized)) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return tokens.every((token) => !SIGNAL_HINT_BLOCKLIST.has(token) && token.length >= 3);
  }

  const token = tokens[0] ?? '';
  if (!/[a-z]/i.test(token)) return false;
  return TOPIC_DOMAIN_ALLOWLIST.has(token);
}

function isUsableRootHint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (SIGNAL_HINT_BLOCKLIST.has(normalized)) return false;
  if (normalized.length < 4) return false;
  if (!/[a-z]/i.test(normalized)) return false;
  return TOPIC_DOMAIN_ALLOWLIST.has(normalized);
}

function isUsableTopicHint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('family:')) return false;
  if (SIGNAL_HINT_BLOCKLIST.has(normalized)) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return tokens.every((token) => !SIGNAL_HINT_BLOCKLIST.has(token) && token.length >= 3);
  }

  const token = tokens[0] ?? '';
  return TOPIC_DOMAIN_ALLOWLIST.has(token);
}

function normalizeSignalRoot(value: string): string {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .filter((token) => token.length >= 4);
  return tokens[0] ?? value.toLowerCase();
}

function humanizeTopicFamily(value: string): string {
  const normalized = value.trim().toLowerCase();
  const mapped = TOPIC_FAMILY_LABELS.get(normalized);
  if (mapped) return mapped;

  if (normalized.startsWith('family:')) {
    const label = normalized.slice('family:'.length).replace(/[_-]+/g, ' ').trim();
    return label ? label : '';
  }

  return '';
}

const SIGNAL_HINT_BLOCKLIST = new Set([
  'usually',
  'people',
  'during',
  'even',
  'anymore',
  'asking',
  'capability',
  'example',
  'content',
  'clearly',
  'biggest',
  'grade',
  'thought',
  'looking',
  'forward',
  'have',
  'backward',
  'human',
  'more',
  'should',
  'very',
  'what',
  'when',
  'which',
]);

const TOPIC_FAMILY_LABELS = new Map<string, string>([
  ['family:ml_training', 'ml training systems'],
  ['family:ml_infra', 'ml infrastructure'],
  ['family:llm_agents', 'llm agents'],
  ['family:software_build', 'software building'],
  ['family:research_work', 'research workflows'],
  ['family:media_content', 'media content'],
]);

const TOPIC_DOMAIN_ALLOWLIST = new Set([
  'agent',
  'agents',
  'attention',
  'code',
  'coding',
  'compute',
  'data',
  'deploy',
  'evaluation',
  'inference',
  'learn',
  'learning',
  'llm',
  'memory',
  'model',
  'models',
  'prompt',
  'prompts',
  'reasoning',
  'research',
  'software',
  'training',
]);

const SIGNAL_READINESS_THRESHOLD = Number(process.env.NEEKO_TRAINING_SEED_SIGNAL_THRESHOLD ?? 0.78);

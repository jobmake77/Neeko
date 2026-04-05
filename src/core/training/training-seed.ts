import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type TrainingSeedMode = 'off' | 'topics' | 'signals';

interface StoredTrainingSeed {
  stable_keywords?: string[];
  stable_topics?: string[];
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
): { mode: TrainingSeedMode; hints: string[]; reason: string } {
  if (mode === 'off') {
    return { mode, hints: [], reason: 'training-seed mode disabled' };
  }

  const path = join(personaDir, 'training-seed.json');
  if (!existsSync(path)) {
    return { mode, hints: [], reason: 'training-seed.json not found' };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as StoredTrainingSeed;
    const hints = mode === 'topics'
      ? selectTopicHints(parsed.stable_topics ?? [], limit)
      : selectCombinedSignalHints(parsed.stable_topics ?? [], parsed.stable_keywords ?? [], limit);
    return {
      mode,
      hints,
      reason: mode === 'topics'
        ? `loaded ${Math.max(0, parsed.topic_cluster_count ?? hints.length ?? 0)} topic clusters`
        : `loaded ${Math.max(0, parsed.stable_signal_count ?? hints.length ?? 0)} stable signals`,
    };
  } catch {
    return { mode, hints: [], reason: 'training-seed.json parse failed' };
  }
}

function selectTopicHints(values: string[], limit: number): string[] {
  return dedupeHints(values).slice(0, limit);
}

function selectCombinedSignalHints(topics: string[], signals: string[], limit: number): string[] {
  const topicBudget = Math.min(Math.max(2, Math.ceil(limit / 3)), limit);
  const topicHints = selectTopicHints(topics, topicBudget);
  const signalHints = selectSignalHints(signals, Math.max(0, limit - topicHints.length));
  return dedupeHints([...topicHints, ...signalHints]).slice(0, limit);
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
  if (token.length < 5) return false;
  if (token.endsWith('ie')) return false;
  if (!/[a-z]/i.test(token)) return false;
  return true;
}

function normalizeSignalRoot(value: string): string {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .filter((token) => token.length >= 4);
  return tokens[0] ?? value.toLowerCase();
}

const SIGNAL_HINT_BLOCKLIST = new Set([
  'usually',
  'people',
  'during',
  'anymore',
  'asking',
  'example',
  'content',
  'clearly',
  'biggest',
  'thought',
  'looking',
  'forward',
  'backward',
  'human',
]);

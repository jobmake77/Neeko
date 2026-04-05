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
      : selectSignalHints(parsed.stable_keywords ?? [], limit);
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
  return dedupeHints(values)
    .sort((left, right) => scoreTopicHint(right) - scoreTopicHint(left) || right.length - left.length)
    .slice(0, limit);
}

function selectSignalHints(values: string[], limit: number): string[] {
  const deduped = dedupeHints(values);
  const selected: string[] = [];
  const usedRoots = new Set<string>();

  for (const hint of [...deduped].sort((left, right) => scoreSignalHint(right) - scoreSignalHint(left) || right.length - left.length)) {
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

function scoreTopicHint(value: string): number {
  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  return tokenCount * 1.5 + Math.min(12, value.length) * 0.05;
}

function scoreSignalHint(value: string): number {
  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  const multiWordBonus = tokenCount >= 2 ? 4 : 0;
  const specificityBonus = Math.min(10, value.length) * 0.08;
  const tersePenalty = value.length <= 3 ? 1.5 : 0;
  return multiWordBonus + tokenCount * 0.7 + specificityBonus - tersePenalty;
}

function normalizeSignalRoot(value: string): string {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .filter((token) => token.length >= 4);
  return tokens[0] ?? value.toLowerCase();
}

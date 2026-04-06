import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RawDocument } from '../models/memory.js';
import { InputRoutingStrategy } from './evidence-routing.js';
import { InputRoutingRecommendation, KimiStabilityMode } from '../training/strategy-resolver.js';
import { DynamicScalingAction, DynamicScalingRecommendation, DynamicScalingState } from './dynamic-scaling-recommendation.js';

export interface CorpusSnapshot {
  schema_version: 1;
  generated_at: string;
  persona_slug?: string;
  raw_doc_count: number;
  source_type_counts: Record<string, number>;
  total_chars: number;
  total_estimated_tokens: number;
  oldest_published_at?: string;
  newest_published_at?: string;
  content_hash: string;
}

export interface CorpusShardPlanItem {
  shard_id: string;
  index: number;
  raw_doc_count: number;
  estimated_tokens: number;
  estimated_chunks: number;
  started_at?: string;
  ended_at?: string;
  days_span?: number;
}

export interface CorpusShardPlan {
  schema_version: 1;
  generated_at: string;
  persona_slug?: string;
  planner_version: string;
  config: {
    target_docs_per_shard: number;
    max_docs_per_shard: number;
    target_tokens_per_shard: number;
    max_tokens_per_shard: number;
    target_window_days: number;
    max_window_days: number;
  };
  totals: {
    shard_count: number;
    raw_doc_count: number;
    estimated_tokens: number;
    estimated_chunks: number;
  };
  shards: CorpusShardPlanItem[];
}

export interface InputRunManifest {
  schema_version: 1;
  generated_at: string;
  persona_slug?: string;
  corpus_snapshot_hash: string;
  raw_doc_count: number;
  selected_input_routing: InputRoutingStrategy;
  selected_kimi_stability_mode: KimiStabilityMode;
  provider?: string;
  requested_rounds?: number;
  training_profile?: string;
  recommendation?: {
    strategy: InputRoutingStrategy;
    shape: string;
    confidence: number;
    reason: string;
  };
  dynamic_scaling_recommendation?: {
    state: DynamicScalingState;
    action: DynamicScalingAction;
    confidence: number;
    reason: string;
  };
  shard_plan: {
    shard_count: number;
    planner_version: string;
  };
  versions: {
    routing_version: string;
    extractor_prompt_version: string;
    shard_plan_version: string;
    merge_rule_version: string;
  };
  freeze_scope: string[];
}

export interface MaterializedShard {
  shard: CorpusShardPlanItem;
  docs: RawDocument[];
}

export function buildCorpusSnapshot(
  docs: RawDocument[],
  options: { personaSlug?: string } = {}
): CorpusSnapshot {
  const dated = docs
    .map((doc) => normalizeDate(doc.published_at))
    .filter((value): value is string => Boolean(value))
    .sort();
  const sourceTypeCounts: Record<string, number> = {};
  let totalChars = 0;
  let totalEstimatedTokens = 0;

  for (const doc of docs) {
    sourceTypeCounts[doc.source_type] = (sourceTypeCounts[doc.source_type] ?? 0) + 1;
    totalChars += doc.content.length;
    totalEstimatedTokens += estimateTokens(doc.content);
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    persona_slug: options.personaSlug,
    raw_doc_count: docs.length,
    source_type_counts: sourceTypeCounts,
    total_chars: totalChars,
    total_estimated_tokens: totalEstimatedTokens,
    oldest_published_at: dated[0],
    newest_published_at: dated[dated.length - 1],
    content_hash: hashDocs(docs),
  };
}

export function planCorpusShards(
  docs: RawDocument[],
  options: {
    personaSlug?: string;
    targetDocsPerShard?: number;
    maxDocsPerShard?: number;
    targetTokensPerShard?: number;
    maxTokensPerShard?: number;
    targetWindowDays?: number;
    maxWindowDays?: number;
  } = {}
): CorpusShardPlan {
  const targetDocsPerShard = Math.max(50, options.targetDocsPerShard ?? 220);
  const maxDocsPerShard = Math.max(targetDocsPerShard, options.maxDocsPerShard ?? 300);
  const targetTokensPerShard = Math.max(2_000, options.targetTokensPerShard ?? 12_000);
  const maxTokensPerShard = Math.max(targetTokensPerShard, options.maxTokensPerShard ?? 18_000);
  const targetWindowDays = Math.max(7, options.targetWindowDays ?? 45);
  const maxWindowDays = Math.max(targetWindowDays, options.maxWindowDays ?? 75);

  const ordered = [...docs].sort(compareDocsByTimeAsc);
  const shards: CorpusShardPlanItem[] = [];

  let currentDocs: RawDocument[] = [];
  let currentTokens = 0;
  let currentFirstDate: Date | null = null;
  let currentLastDate: Date | null = null;

  const flush = () => {
    if (currentDocs.length === 0) return;
    const dates = currentDocs
      .map((doc) => parseDate(doc.published_at))
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime());
    const startedAt = dates[0]?.toISOString();
    const endedAt = dates[dates.length - 1]?.toISOString();
    const daysSpan =
      dates.length >= 2
        ? Math.max(0, Math.round((dates[dates.length - 1].getTime() - dates[0].getTime()) / 86_400_000))
        : 0;
    shards.push({
      shard_id: `shard-${String(shards.length + 1).padStart(3, '0')}`,
      index: shards.length,
      raw_doc_count: currentDocs.length,
      estimated_tokens: currentTokens,
      estimated_chunks: Math.max(1, Math.ceil(currentTokens / 500)),
      started_at: startedAt,
      ended_at: endedAt,
      days_span: daysSpan,
    });
    currentDocs = [];
    currentTokens = 0;
    currentFirstDate = null;
    currentLastDate = null;
  };

  for (const doc of ordered) {
    const docTokens = estimateTokens(doc.content);
    const docDate = parseDate(doc.published_at);
    const nextFirst = currentFirstDate ?? docDate;
    const nextLast = docDate ?? currentLastDate ?? currentFirstDate;
    const nextDaysSpan =
      nextFirst && nextLast
        ? Math.max(0, Math.round((nextLast.getTime() - nextFirst.getTime()) / 86_400_000))
        : 0;

    const softLimitReached =
      currentDocs.length >= targetDocsPerShard &&
      (currentTokens >= targetTokensPerShard || nextDaysSpan >= targetWindowDays);
    const hardLimitReached =
      currentDocs.length >= maxDocsPerShard ||
      currentTokens + docTokens > maxTokensPerShard ||
      nextDaysSpan > maxWindowDays;

    if (currentDocs.length > 0 && (softLimitReached || hardLimitReached)) {
      flush();
    }

    currentDocs.push(doc);
    currentTokens += docTokens;
    currentFirstDate = currentFirstDate ?? docDate;
    currentLastDate = docDate ?? currentLastDate;
  }

  flush();

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    persona_slug: options.personaSlug,
    planner_version: 'v1',
    config: {
      target_docs_per_shard: targetDocsPerShard,
      max_docs_per_shard: maxDocsPerShard,
      target_tokens_per_shard: targetTokensPerShard,
      max_tokens_per_shard: maxTokensPerShard,
      target_window_days: targetWindowDays,
      max_window_days: maxWindowDays,
    },
    totals: {
      shard_count: shards.length,
      raw_doc_count: docs.length,
      estimated_tokens: shards.reduce((sum, item) => sum + item.estimated_tokens, 0),
      estimated_chunks: shards.reduce((sum, item) => sum + item.estimated_chunks, 0),
    },
    shards,
  };
}

export function buildInputRunManifest(options: {
  personaSlug?: string;
  snapshot: CorpusSnapshot;
  shardPlan: CorpusShardPlan;
  selectedInputRouting: InputRoutingStrategy;
  selectedKimiStabilityMode: KimiStabilityMode;
  provider?: string;
  requestedRounds?: number;
  trainingProfile?: string;
  recommendation?: InputRoutingRecommendation | null;
  dynamicScalingRecommendation?: DynamicScalingRecommendation | null;
}): InputRunManifest {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    persona_slug: options.personaSlug,
    corpus_snapshot_hash: options.snapshot.content_hash,
    raw_doc_count: options.snapshot.raw_doc_count,
    selected_input_routing: options.selectedInputRouting,
    selected_kimi_stability_mode: options.selectedKimiStabilityMode,
    provider: options.provider,
    requested_rounds: options.requestedRounds,
    training_profile: options.trainingProfile,
    recommendation: options.recommendation
      ? {
        strategy: options.recommendation.recommendedStrategy,
        shape: options.recommendation.shape,
        confidence: options.recommendation.confidence,
        reason: options.recommendation.reason,
      }
      : undefined,
    dynamic_scaling_recommendation: options.dynamicScalingRecommendation
      ? {
        state: options.dynamicScalingRecommendation.state,
        action: options.dynamicScalingRecommendation.recommended_action,
        confidence: options.dynamicScalingRecommendation.confidence,
        reason: options.dynamicScalingRecommendation.reason,
      }
      : undefined,
    shard_plan: {
      shard_count: options.shardPlan.totals.shard_count,
      planner_version: options.shardPlan.planner_version,
    },
    versions: {
      routing_version: 'v2-routing-2026-04',
      extractor_prompt_version: 'extractor-compact-kimi-2026-04',
      shard_plan_version: options.shardPlan.planner_version,
      merge_rule_version: 'merge-planned-v1',
    },
    freeze_scope: [
      'corpus_snapshot',
      'selected_input_routing',
      'selected_kimi_stability_mode',
      'dynamic_scaling_recommendation',
      'shard_plan',
      'provider',
      'version_pins',
    ],
  };
}

export function writeCorpusPlanningAssets(
  personaDir: string,
  input: {
    snapshot: CorpusSnapshot;
    shardPlan: CorpusShardPlan;
    manifest: InputRunManifest;
  }
): void {
  writeFileSync(join(personaDir, 'corpus-snapshot.json'), JSON.stringify(input.snapshot, null, 2), 'utf-8');
  writeFileSync(join(personaDir, 'shard-plan.json'), JSON.stringify(input.shardPlan, null, 2), 'utf-8');
  writeFileSync(join(personaDir, 'input-run-manifest.json'), JSON.stringify(input.manifest, null, 2), 'utf-8');
}

export function materializeShardDocs(
  docs: RawDocument[],
  shardPlan: CorpusShardPlan
): MaterializedShard[] {
  const ordered = [...docs].sort(compareDocsByTimeAsc);
  const shards: MaterializedShard[] = [];
  let cursor = 0;

  for (const shard of shardPlan.shards) {
    const next = ordered.slice(cursor, cursor + shard.raw_doc_count);
    shards.push({ shard, docs: next });
    cursor += shard.raw_doc_count;
  }

  return shards;
}

export function writeShardCorpusAssets(
  personaDir: string,
  docs: RawDocument[],
  shardPlan: CorpusShardPlan
): void {
  const materialized = materializeShardDocs(docs, shardPlan);
  const shardsDir = join(personaDir, 'shards');
  mkdirSync(shardsDir, { recursive: true });

  for (const item of materialized) {
    const dir = join(shardsDir, item.shard.shard_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'raw-docs.json'), JSON.stringify(item.docs, null, 2), 'utf-8');
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(item.shard, null, 2), 'utf-8');
  }
}

function compareDocsByTimeAsc(a: RawDocument, b: RawDocument): number {
  const aDate = parseDate(a.published_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDate = parseDate(b.published_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return String(a.id).localeCompare(String(b.id));
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDate(value?: string): string | undefined {
  const date = parseDate(value);
  return date?.toISOString();
}

function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 2 + rest / 4);
}

function hashDocs(docs: RawDocument[]): string {
  const sorted = [...docs].sort(compareDocsByTimeAsc);
  const joined = sorted
    .map((doc) => [
      doc.source_type,
      doc.author,
      doc.author_handle ?? '',
      normalizeDate(doc.published_at) ?? '',
      doc.content.trim().replace(/\s+/g, ' '),
    ].join('::'))
    .join('\n');
  return simpleHash(joined);
}

function simpleHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

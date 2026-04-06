import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DynamicScalingMetrics } from '../models/evidence-pack.js';
import { AdaptiveShardPlan } from './adaptive-shard-plan.js';

export type DynamicScalingState = 'explore' | 'compress' | 'stabilize' | 'align';
export type DynamicScalingAction =
  | 'continue_expand'
  | 'repack_and_dedup'
  | 'merge_and_canonicalize'
  | 'train_on_seeds';

export interface DynamicScalingRecommendation {
  schema_version: 1;
  generated_at: string;
  persona_slug?: string;
  state: DynamicScalingState;
  recommended_action: DynamicScalingAction;
  confidence: number;
  reason: string;
  metrics_snapshot: DynamicScalingMetrics;
  shard_snapshot: {
    shard_count: number;
    pack_count: number;
    avg_packs_per_shard: number;
    avg_tokens_per_shard: number;
    avg_topical_entropy: number;
    avg_dominant_topic_concentration: number;
    avg_runtime_cost_hint: number;
    max_days_span: number;
  };
}

export function recommendDynamicScaling(
  metrics: DynamicScalingMetrics,
  plan: AdaptiveShardPlan,
  options: { personaSlug?: string } = {}
): DynamicScalingRecommendation {
  const shardSnapshot = buildShardSnapshot(plan);

  if (
    metrics.runtime_pressure >= 0.72 ||
    metrics.duplication_pressure >= 0.58 ||
    shardSnapshot.avg_topical_entropy >= 0.72
  ) {
    return buildRecommendation(
      options.personaSlug,
      metrics,
      shardSnapshot,
      'compress',
      'repack_and_dedup',
      Math.max(metrics.runtime_pressure, metrics.duplication_pressure, shardSnapshot.avg_topical_entropy),
      'runtime or duplication pressure is climbing, so the next best move is to compress packs, strengthen dedup, and reduce shard load before expanding further'
    );
  }

  if (
    metrics.seed_maturity >= 0.74 &&
    metrics.stable_topic_growth <= 0.32 &&
    metrics.conflict_pressure <= 0.32 &&
    shardSnapshot.avg_dominant_topic_concentration >= 0.62
  ) {
    return buildRecommendation(
      options.personaSlug,
      metrics,
      shardSnapshot,
      'align',
      'train_on_seeds',
      average([
        metrics.seed_maturity,
        1 - metrics.stable_topic_growth,
        1 - metrics.conflict_pressure,
        shardSnapshot.avg_dominant_topic_concentration,
      ]),
      'stable topics have largely converged, conflict remains controlled, and shard coherence is strong enough to move into seed-driven training alignment'
    );
  }

  if (
    metrics.seed_maturity >= 0.56 &&
    metrics.stable_topic_growth <= 0.48 &&
    metrics.conflict_pressure <= 0.45
  ) {
    return buildRecommendation(
      options.personaSlug,
      metrics,
      shardSnapshot,
      'stabilize',
      'merge_and_canonicalize',
      average([
        metrics.seed_maturity,
        1 - metrics.stable_topic_growth,
        1 - metrics.conflict_pressure,
      ]),
      'seed maturity is improving while topic growth is slowing, so the next step should favor cross-shard merge, topic canonicalization, and conflict isolation'
    );
  }

  if (
    metrics.marginal_coverage_gain >= 0.52 &&
    metrics.stable_topic_growth >= 0.42 &&
    metrics.duplication_pressure <= 0.44
  ) {
    return buildRecommendation(
      options.personaSlug,
      metrics,
      shardSnapshot,
      'explore',
      'continue_expand',
      average([
        metrics.marginal_coverage_gain,
        metrics.stable_topic_growth,
        1 - metrics.duplication_pressure,
      ]),
      'the corpus is still yielding meaningful new coverage and topic growth without heavy duplication, so continued expansion is still justified'
    );
  }

  const defaultState: DynamicScalingState = metrics.seed_maturity >= 0.6 ? 'stabilize' : 'explore';
  const defaultAction: DynamicScalingAction =
    defaultState === 'stabilize' ? 'merge_and_canonicalize' : 'continue_expand';
  return buildRecommendation(
    options.personaSlug,
    metrics,
    shardSnapshot,
    defaultState,
    defaultAction,
    average([
      metrics.seed_maturity,
      metrics.marginal_coverage_gain,
      1 - metrics.duplication_pressure,
    ]),
    defaultState === 'stabilize'
      ? 'the corpus is in a mixed middle state, so it is safer to consolidate stable signals before spending more budget on fresh expansion'
      : 'the corpus is still in an exploratory middle state, so the next step can continue expansion while keeping observability on duplication and runtime pressure'
  );
}

export function writeDynamicScalingRecommendationAssets(
  personaDir: string,
  recommendation: DynamicScalingRecommendation
): string {
  mkdirSync(personaDir, { recursive: true });
  const filePath = join(personaDir, 'dynamic-scaling-recommendation.json');
  writeFileSync(filePath, JSON.stringify(recommendation, null, 2), 'utf-8');
  return filePath;
}

function buildRecommendation(
  personaSlug: string | undefined,
  metrics: DynamicScalingMetrics,
  shardSnapshot: DynamicScalingRecommendation['shard_snapshot'],
  state: DynamicScalingState,
  recommendedAction: DynamicScalingAction,
  confidence: number,
  reason: string
): DynamicScalingRecommendation {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    persona_slug: personaSlug,
    state,
    recommended_action: recommendedAction,
    confidence: clamp(confidence),
    reason,
    metrics_snapshot: metrics,
    shard_snapshot: shardSnapshot,
  };
}

function buildShardSnapshot(plan: AdaptiveShardPlan): DynamicScalingRecommendation['shard_snapshot'] {
  const shardCount = plan.totals.shard_count;
  return {
    shard_count: shardCount,
    pack_count: plan.totals.pack_count,
    avg_packs_per_shard: shardCount === 0 ? 0 : plan.totals.pack_count / shardCount,
    avg_tokens_per_shard: shardCount === 0 ? 0 : plan.totals.estimated_tokens / shardCount,
    avg_topical_entropy: average(plan.shards.map((shard) => shard.topical_entropy)),
    avg_dominant_topic_concentration: average(plan.shards.map((shard) => shard.dominant_topic_concentration ?? 0)),
    avg_runtime_cost_hint: average(plan.shards.map((shard) => shard.runtime_cost_hint)),
    max_days_span: Math.max(0, ...plan.shards.map((shard) => shard.days_span ?? 0)),
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

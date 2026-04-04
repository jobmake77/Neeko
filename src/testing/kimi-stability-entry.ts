import { readFileSync } from 'fs';
import { MemoryStore } from '../core/memory/store.js';
import { createPersona } from '../core/models/persona.js';
import { RawDocument } from '../core/models/memory.js';
import { createEmptySoul, Soul } from '../core/models/soul.js';
import { routeEvidenceDocuments, InputRoutingStrategy } from '../core/pipeline/evidence-routing.js';
import { SoulAggregator, SoulExtractor } from '../core/soul/extractor.js';
import { TrainingLoop } from '../core/training/loop.js';
import { settings } from '../config/settings.js';
import { snapshotAndResetAgentFallbackMetrics } from '../core/agents/index.js';
import {
  estimateExtractionStageTimeoutMs,
  KimiStabilityMode,
  normalizeKimiStabilityMode,
  normalizeOptimizationMode,
  resolveKimiStabilityDecision,
  resolveTrainingStrategy,
  selectSoulChunksForStrategy,
} from '../core/training/strategy-resolver.js';
import { resolvePreferredProviderName } from '../config/model.js';

interface TweetLike {
  id: string;
  author: string;
  text: string;
  created_at: string;
  url: string;
  likes?: number;
  views?: string | number;
}

async function main() {
  const [
    postsPath,
    handle = 'turingou',
    roundsRaw = '2',
    profile = 'full',
    timeoutRaw,
    routingRaw = 'both',
    modesRaw = 'standard,tight_runtime,sparse_director,hybrid',
    optimizationModeRaw,
  ] = process.argv.slice(2);

  if (!postsPath) {
    throw new Error(
      'Usage: node dist/testing/kimi-stability-entry.js <posts.json> [handle] [rounds] [profile] [timeoutMs] [routing] [modes] [optimizationMode]'
    );
  }

  const rounds = Math.max(1, parseInt(roundsRaw, 10) || 2);
  const strategyTimeoutMs = Math.max(
    60_000,
    parseInt(timeoutRaw ?? process.env.KIMI_STABILITY_TIMEOUT_MS ?? '300000', 10) || 300_000
  );
  const routingStrategies = resolveRoutingStrategies(routingRaw);
  const stabilityModes = resolveStabilityModes(modesRaw);
  const optimizationMode = normalizeOptimizationMode(
    optimizationModeRaw ?? process.env.INPUT_ROUTING_OPT_MODE,
    'auto'
  );
  const providerName = resolvePreferredProviderName();
  const tweets = JSON.parse(readFileSync(postsPath, 'utf-8')) as TweetLike[];
  const docs = tweets.map(toRawDocument);
  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });
  const extractor = new SoulExtractor();
  const aggregator = new SoulAggregator();
  const results: Array<Record<string, unknown>> = [];

  for (const strategy of routingStrategies) {
    console.error(`[kimi-stability] strategy=${strategy} routing start`);
    const routed = routeEvidenceDocuments(docs, {
      strategy,
      targetSignals: [handle, `@${handle}`],
    });
    const strategyDecision = resolveTrainingStrategy({
      inputRoutingStrategy: strategy,
      observability: routed.observability,
      rawDocCount: docs.length,
      explicitOptimizationMode: optimizationMode,
      providerName,
    });

    const soulSeed = createEmptySoul(handle, `@${handle}`);
    const soulSlice = selectSoulChunksForStrategy(
      routed.soulChunks,
      routed.routedDocs.map((item) => ({ document_id: item.doc.id, score: item.score })),
      strategyDecision,
      Math.min(4, strategyDecision.maxSoulChunks)
    );

    let seededSoul: Soul = soulSeed;
    if (routed.soulChunks.length > 0) {
      const extractionStageTimeoutMs = estimateExtractionStageTimeoutMs(
        strategyDecision,
        soulSlice.length,
        strategyTimeoutMs
      );
      const extractionStartedAt = Date.now();
      console.error(`[kimi-stability] strategy=${strategy} extraction start soul_chunks=${soulSlice.length}`);
      const extractions = await withTimeout(
        extractor.extractBatch(soulSlice, handle, strategyDecision.extractionConcurrency, {
          timeoutMs: strategyDecision.extractionTimeoutMs,
          retries: strategyDecision.extractionRetries,
          cacheEnabled: strategyDecision.extractorCacheEnabled,
          cachePath: `/tmp/neeko-soul-cache-${handle}-${strategy}.json`,
        }),
        extractionStageTimeoutMs,
        `extraction ${strategy}`
      );
      seededSoul = aggregator.aggregate(soulSeed, extractions, soulSlice);
      console.error(`[kimi-stability] strategy=${strategy} extraction done elapsed_ms=${Date.now() - extractionStartedAt}`);
      results.push({
        strategy,
        kind: 'seed',
        extraction_elapsed_ms: Date.now() - extractionStartedAt,
        soul_chunks_used: soulSlice.length,
        input_observability: routed.observability,
        runtime_observability: {
          optimization_mode: strategyDecision.optimizationMode,
          runtime_preset: strategyDecision.runtimePreset,
          corpus_segment: strategyDecision.corpusSegment,
          decision_reason: strategyDecision.reason,
        },
      });
    }

    for (const mode of stabilityModes) {
      snapshotAndResetAgentFallbackMetrics();
      const stabilityDecision = resolveKimiStabilityDecision({
        baseDecision: strategyDecision,
        providerName,
        rounds,
        explicitMode: mode,
      });
      const persona = createPersona(handle, 'single', [handle], () => false);
      persona.id = crypto.randomUUID();
      persona.slug = `${handle}-${strategy}-${mode}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
      persona.memory_collection = `nico_${persona.slug}`;
      await store.ensureCollection(persona.memory_collection);

      const loop = new TrainingLoop(structuredClone(seededSoul), persona, store);
      const started = Date.now();
      console.error(`[kimi-stability] strategy=${strategy} mode=${mode} training start`);

      try {
        const result = await withTimeout(
          loop.run({
            maxRounds: rounds,
            profile: profile as any,
            questionsPerRound: 1,
            runtimePreset: stabilityDecision.runtimePreset,
            runtimeOverrides: stabilityDecision.runtimeOverrides,
            evaluatorLayered: stabilityDecision.evaluatorLayered,
            evaluatorDualReview: stabilityDecision.evaluatorDualReview,
            directorReviewInterval: stabilityDecision.directorReviewInterval,
            directorAlwaysOnFinalRound: stabilityDecision.directorAlwaysOnFinalRound,
          }),
          strategyTimeoutMs,
          `${strategy}:${mode}`
        );
        const elapsedMs = Date.now() - started;
        const avgQuality = result.history.length === 0
          ? 0
          : result.history.reduce((sum, item) => sum + item.avgQualityScore, 0) / result.history.length;
        const contradictionRate = result.history.length === 0
          ? 0
          : result.history.reduce((sum, item) => sum + item.observability.contradictionRate, 0) / result.history.length;
        const duplicationRate = result.history.length === 0
          ? 0
          : result.history.reduce((sum, item) => sum + item.observability.duplicationRate, 0) / result.history.length;
        console.error(
          `[kimi-stability] strategy=${strategy} mode=${mode} done elapsed_ms=${elapsedMs} quality=${avgQuality.toFixed(3)} coverage=${result.soul.coverage_score.toFixed(3)}`
        );

        results.push({
          strategy,
          mode,
          rounds: result.totalRounds,
          elapsed_ms: elapsedMs,
          timed_out: false,
          avg_quality: avgQuality,
          contradiction_rate: contradictionRate,
          duplication_rate: duplicationRate,
          coverage: result.soul.coverage_score,
          input_observability: routed.observability,
          runtime_observability: {
            provider: providerName ?? 'unknown',
            base_runtime_preset: strategyDecision.runtimePreset,
            runtime_preset: stabilityDecision.runtimePreset,
            optimization_mode: strategyDecision.optimizationMode,
            corpus_segment: strategyDecision.corpusSegment,
            decision_reason: strategyDecision.reason,
            stability_reason: stabilityDecision.reason,
            soul_chunks_used: soulSlice.length,
            director_review_interval: stabilityDecision.directorReviewInterval,
            evaluator_dual_review: stabilityDecision.evaluatorDualReview ?? (profile === 'a2' || profile === 'a3' || profile === 'a4' || profile === 'full'),
            rounds_with_llm_director: result.history.filter((item) => item.runtime.directorDecisionSource === 'llm').length,
            rounds_with_skipped_director: result.history.filter((item) => item.runtime.directorDecisionSource === 'heuristic_skip').length,
            total_trainer_ms: result.history.reduce((sum, item) => sum + item.runtime.trainerMs, 0),
            total_dialogue_eval_ms: result.history.reduce((sum, item) => sum + item.runtime.dialogueEvalMs, 0),
            total_director_ms: result.history.reduce((sum, item) => sum + item.runtime.directorMs, 0),
            ...snapshotAndResetAgentFallbackMetrics(),
          },
        });
      } catch (error) {
        console.error(
          `[kimi-stability] strategy=${strategy} mode=${mode} failed error=${error instanceof Error ? error.message : String(error)}`
        );
        results.push({
          strategy,
          mode,
          rounds: 0,
          elapsed_ms: strategyTimeoutMs,
          timed_out: true,
          error: error instanceof Error ? error.message : String(error),
          input_observability: routed.observability,
          runtime_observability: {
            provider: providerName ?? 'unknown',
            base_runtime_preset: strategyDecision.runtimePreset,
            runtime_preset: stabilityDecision.runtimePreset,
            optimization_mode: strategyDecision.optimizationMode,
            corpus_segment: strategyDecision.corpusSegment,
            decision_reason: strategyDecision.reason,
            stability_reason: stabilityDecision.reason,
            soul_chunks_used: soulSlice.length,
            director_review_interval: stabilityDecision.directorReviewInterval,
            evaluator_dual_review: stabilityDecision.evaluatorDualReview ?? (profile === 'a2' || profile === 'a3' || profile === 'a4' || profile === 'full'),
            ...snapshotAndResetAgentFallbackMetrics(),
          },
        });
      }
    }
  }

  process.stdout.write(JSON.stringify({
    handle,
    rounds,
    profile,
    compared_at: new Date().toISOString(),
    provider: providerName ?? 'unknown',
    routing: routingStrategies,
    modes: stabilityModes,
    results,
  }, null, 2), () => process.exit(0));
}

function resolveRoutingStrategies(raw?: string): InputRoutingStrategy[] {
  const value = String(raw ?? 'both').trim().toLowerCase();
  if (value === 'legacy' || value === 'v2') return [value];
  return ['legacy', 'v2'];
}

function resolveStabilityModes(raw?: string): KimiStabilityMode[] {
  const modes = String(raw ?? '')
    .split(',')
    .map((item) => normalizeKimiStabilityMode(item.trim(), 'auto'))
    .filter((item): item is KimiStabilityMode => item !== 'auto');
  return modes.length > 0 ? Array.from(new Set(modes)) : ['standard', 'tight_runtime', 'sparse_director', 'hybrid'];
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toRawDocument(tweet: TweetLike): RawDocument {
  return {
    id: crypto.randomUUID(),
    source_type: 'twitter',
    source_url: tweet.url,
    source_platform: 'twitter',
    content: tweet.text,
    author: tweet.author,
    author_handle: `@${String(tweet.author).replace(/^@/, '')}`,
    published_at: new Date(tweet.created_at).toISOString(),
    fetched_at: new Date().toISOString(),
    metadata: {
      tweet_id: tweet.id,
      likes: tweet.likes,
      views: tweet.views,
    },
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

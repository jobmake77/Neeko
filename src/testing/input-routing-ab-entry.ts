import { readFileSync } from 'fs';
import { MemoryStore } from '../core/memory/store.js';
import { createPersona } from '../core/models/persona.js';
import { RawDocument } from '../core/models/memory.js';
import { createEmptySoul } from '../core/models/soul.js';
import { routeEvidenceDocuments, InputRoutingStrategy } from '../core/pipeline/evidence-routing.js';
import { SoulAggregator, SoulExtractor } from '../core/soul/extractor.js';
import { TrainingLoop } from '../core/training/loop.js';
import { settings } from '../config/settings.js';
import { snapshotAndResetAgentFallbackMetrics } from '../core/agents/index.js';
import {
  normalizeOptimizationMode,
  resolveTrainingStrategy,
  selectSoulChunksForStrategy,
} from '../core/training/strategy-resolver.js';

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
    roundsRaw = '1',
    profile = 'baseline',
    timeoutRaw,
    runtimePresetRaw,
    optimizationModeRaw,
  ] = process.argv.slice(2);
  if (!postsPath) {
    throw new Error(
      'Usage: node dist/testing/input-routing-ab-entry.js <posts.json> [handle] [rounds] [profile] [timeoutMs] [runtimePreset] [optimizationMode]'
    );
  }

  const rounds = Math.max(1, parseInt(roundsRaw, 10) || 1);
  const runtimePresetOverrideRaw = runtimePresetRaw ?? process.env.INPUT_ROUTING_RUNTIME_PRESET;
  const runtimePresetOverride =
    runtimePresetOverrideRaw && String(runtimePresetOverrideRaw).toLowerCase() !== 'auto'
      ? runtimePresetOverrideRaw
      : undefined;
  const optimizationMode = normalizeOptimizationMode(
    optimizationModeRaw ?? process.env.INPUT_ROUTING_OPT_MODE,
    'auto'
  );
  const strategyTimeoutMs = Math.max(
    60_000,
    parseInt(timeoutRaw ?? process.env.INPUT_ROUTING_AB_TIMEOUT_MS ?? '60000', 10) || 60_000
  );
  const extractionStageTimeoutMs = Math.max(
    30_000,
    Math.min(strategyTimeoutMs, parseInt(process.env.INPUT_ROUTING_EXTRACTION_TIMEOUT_MS ?? '90000', 10) || 90_000)
  );
  const tweets = JSON.parse(readFileSync(postsPath, 'utf-8')) as TweetLike[];
  const docs = tweets.map(toRawDocument);
  const strategies: InputRoutingStrategy[] = ['legacy', 'v2'];
  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });
  const extractor = new SoulExtractor();
  const aggregator = new SoulAggregator();
  const results: Array<Record<string, unknown>> = [];

  for (const strategy of strategies) {
    snapshotAndResetAgentFallbackMetrics();
    try {
      const routed = routeEvidenceDocuments(docs, {
        strategy,
        targetSignals: [handle, `@${handle}`],
      });
      const strategyDecision = resolveTrainingStrategy({
        inputRoutingStrategy: strategy,
        observability: routed.observability,
        rawDocCount: docs.length,
        explicitRuntimePreset: runtimePresetOverride,
        explicitOptimizationMode: optimizationMode,
      });
      const persona = createPersona(handle, 'single', [handle], () => false);
      persona.id = crypto.randomUUID();
      persona.slug = `${handle}-${strategy}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
      persona.memory_collection = `nico_${persona.slug}`;
      await store.ensureCollection(persona.memory_collection);

      const soulSeed = createEmptySoul(handle, `@${handle}`);
      let soul = soulSeed;
      const soulSlice = selectSoulChunksForStrategy(
        routed.soulChunks,
        routed.routedDocs.map((item) => ({ document_id: item.doc.id, score: item.score })),
        strategyDecision,
        4
      );
      if (routed.soulChunks.length > 0) {
        const extractions = await withTimeout(
          extractor.extractBatch(soulSlice, handle, strategyDecision.extractionConcurrency, {
            timeoutMs: strategyDecision.extractionTimeoutMs,
            retries: strategyDecision.extractionRetries,
            cacheEnabled: strategyDecision.extractorCacheEnabled,
            cachePath: `/tmp/neeko-soul-cache-${handle}.json`,
          }),
          extractionStageTimeoutMs,
          `extraction ${strategy}`
        );
        soul = aggregator.aggregate(soulSeed, extractions, soulSlice);
      }

      const loop = new TrainingLoop(soul, persona, store);
      const started = Date.now();
      let result:
        | Awaited<ReturnType<TrainingLoop['run']>>
        | null = null;
      let timedOut = false;
      try {
        result = await withTimeout(
          loop.run({
            maxRounds: rounds,
            profile: profile as any,
            questionsPerRound: 1,
            runtimePreset: strategyDecision.runtimePreset,
            evaluatorLayered: strategyDecision.evaluatorLayered,
          }),
          strategyTimeoutMs,
          `routing ${strategy}`
        );
      } catch (error) {
        timedOut = true;
        results.push({
          strategy,
          rounds: 0,
          elapsed_ms: strategyTimeoutMs,
          timed_out: true,
          error: error instanceof Error ? error.message : String(error),
          input_observability: routed.observability,
          runtime_observability: {
            optimization_mode: strategyDecision.optimizationMode,
            runtime_preset: strategyDecision.runtimePreset,
            corpus_segment: strategyDecision.corpusSegment,
            decision_reason: strategyDecision.reason,
            soul_chunks_used: soulSlice.length,
            ...snapshotAndResetAgentFallbackMetrics(),
          },
        });
        continue;
      }
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

      results.push({
        strategy,
        rounds: result.totalRounds,
        elapsed_ms: elapsedMs,
        timed_out: timedOut,
        avg_quality: avgQuality,
        contradiction_rate: contradictionRate,
        duplication_rate: duplicationRate,
        coverage: result.soul.coverage_score,
        input_observability: routed.observability,
        runtime_observability: {
          optimization_mode: strategyDecision.optimizationMode,
          runtime_preset: strategyDecision.runtimePreset,
          corpus_segment: strategyDecision.corpusSegment,
          decision_reason: strategyDecision.reason,
          soul_chunks_used: soulSlice.length,
          ...snapshotAndResetAgentFallbackMetrics(),
        },
      });
    } catch (error) {
      results.push({
        strategy,
        rounds: 0,
        elapsed_ms: 0,
        timed_out: false,
        error: error instanceof Error ? error.message : String(error),
        input_observability: {
          strategy,
          raw_docs: docs.length,
          clean_docs: 0,
          chunks: 0,
          soul_docs: 0,
          memory_docs: 0,
          discard_docs: 0,
          quarantined_docs: 0,
          promotion_candidates: 0,
          promoted_to_soul_docs: 0,
          filtered_low_quality_docs: 0,
        },
        runtime_observability: {
          optimization_mode: 'failed_before_training',
          runtime_preset: runtimePresetOverride ?? 'auto',
          corpus_segment: 'unknown',
          decision_reason: 'strategy failed before training loop started',
          soul_chunks_used: 0,
          ...snapshotAndResetAgentFallbackMetrics(),
        },
      });
    }
  }

  process.stdout.write(JSON.stringify({
    handle,
    rounds,
    profile,
    runtime_preset: runtimePresetOverride ?? 'auto',
    optimization_mode: optimizationMode,
    compared_at: new Date().toISOString(),
    results,
  }, null, 2), () => {
    process.exit(0);
  });
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

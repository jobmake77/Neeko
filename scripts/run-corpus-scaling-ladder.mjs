import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const [corpusPathArg, outputPathArg] = args;

if (!corpusPathArg || !outputPathArg) {
  console.error(
    'Usage: /usr/local/bin/node scripts/run-corpus-scaling-ladder.mjs <corpus.json> <output.json> [--step 250] [--checkpoints 500,1000,1500]'
  );
  process.exit(1);
}

const corpusPath = path.resolve(corpusPathArg);
const outputPath = path.resolve(outputPathArg);
const step = readIntFlag('--step', 250);
const explicitCheckpoints = readCsvIntFlag('--checkpoints');

if (!fs.existsSync(corpusPath)) {
  throw new Error(`Corpus file not found: ${corpusPath}`);
}

const rows = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
if (!Array.isArray(rows)) {
  throw new Error('Corpus file must contain a JSON array');
}

const checkpoints = explicitCheckpoints.length > 0
  ? normalizeCheckpoints(explicitCheckpoints, rows.length)
  : buildStepCheckpoints(rows.length, step);

const inferredHandle = inferHandle(rows);

const {
  buildCorpusSnapshot,
  buildInputRunManifest,
  planCorpusShards,
} = await import('../dist/testing/corpus-plan-test-entry.js');
const {
  buildStandaloneEvidenceBatch,
} = await import('../dist/testing/evidence-layer-test-entry.js');
const {
  buildEvidencePacks,
  planAdaptiveShards,
  recommendDynamicScaling,
} = await import('../dist/testing/dynamic-scaling-test-entry.js');
const {
  distillCorpusShards,
} = await import('../dist/testing/shard-distillation-test-entry.js');
const {
  mergeShardDistillationResults,
} = await import('../dist/testing/global-merge-test-entry.js');

const stages = [];

for (const checkpoint of checkpoints) {
  const subset = rows.slice(0, checkpoint);
  const personaSlug = `scaling-${inferredHandle}-${checkpoint}`;
  const docs = subset.map((tweet) => toDoc(tweet, inferredHandle));
  const snapshot = buildCorpusSnapshot(docs, { personaSlug });
  const shardPlan = planCorpusShards(docs, { personaSlug });
  const evidenceBatch = buildStandaloneEvidenceBatch(docs, {
    manifest: {
      target_name: inferredHandle,
      target_aliases: [inferredHandle, `@${inferredHandle}`],
      self_aliases: [],
      known_other_aliases: [],
      default_scene: 'public',
    },
    sourceLabel: 'twitter',
  });
  const packBuild = buildEvidencePacks(evidenceBatch.items, { personaSlug });
  const adaptiveShardPlan = planAdaptiveShards(packBuild.packs, { personaSlug });
  const dynamicScalingRecommendation = recommendDynamicScaling(packBuild.metrics, adaptiveShardPlan, {
    personaSlug,
  });
  const shardResults = distillCorpusShards(docs, shardPlan, {
    strategy: 'v2',
    targetSignals: [inferredHandle, `@${inferredHandle}`],
    strategyDecision: {
      optimizationMode: 'combined',
      prioritizeTopSoulChunks: true,
      maxSoulChunks: 12,
    },
  });
  const merged = mergeShardDistillationResults(shardResults, { strategy: 'v2' });
  const manifest = buildInputRunManifest({
    personaSlug,
    snapshot,
    shardPlan,
    selectedInputRouting: 'v2',
    selectedKimiStabilityMode: 'hybrid',
    provider: 'kimi',
    requestedRounds: 0,
    trainingProfile: 'full',
    recommendation: null,
    dynamicScalingRecommendation,
  });

  stages.push({
    checkpoint,
    corpus_window: {
      newest: subset[0]?.created_at ?? subset[0]?.published_at,
      oldest: subset[subset.length - 1]?.created_at ?? subset[subset.length - 1]?.published_at,
    },
    corpus_snapshot: {
      raw_doc_count: snapshot.raw_doc_count,
      total_estimated_tokens: snapshot.total_estimated_tokens,
      oldest_published_at: snapshot.oldest_published_at,
      newest_published_at: snapshot.newest_published_at,
    },
    shard_plan: {
      shard_count: shardPlan.totals.shard_count,
      estimated_tokens: shardPlan.totals.estimated_tokens,
      estimated_chunks: shardPlan.totals.estimated_chunks,
    },
    adaptive_packing: {
      pack_count: packBuild.packs.length,
      avg_tokens_per_pack: packBuild.stats.avg_tokens_per_pack,
      adaptive_shard_count: adaptiveShardPlan.totals.shard_count,
      adaptive_avg_packs_per_shard:
        adaptiveShardPlan.totals.shard_count === 0
          ? 0
          : adaptiveShardPlan.totals.pack_count / adaptiveShardPlan.totals.shard_count,
      adaptive_avg_tokens_per_shard:
        adaptiveShardPlan.totals.shard_count === 0
          ? 0
          : adaptiveShardPlan.totals.estimated_tokens / adaptiveShardPlan.totals.shard_count,
    },
    metrics: packBuild.metrics,
    dynamic_scaling_recommendation: {
      state: dynamicScalingRecommendation.state,
      action: dynamicScalingRecommendation.recommended_action,
      confidence: dynamicScalingRecommendation.confidence,
      reason: dynamicScalingRecommendation.reason,
    },
    merged_summary: {
      stable_signal_count: merged.soulSeed.stable_signal_count,
      topic_cluster_count: merged.soulSeed.topic_cluster_count,
      memory_candidate_count: merged.memoryCandidates.candidate_count,
      conflict_count: merged.conflicts.conflict_count,
    },
    input_run_manifest: {
      selected_input_routing: manifest.selected_input_routing,
      selected_kimi_stability_mode: manifest.selected_kimi_stability_mode,
      dynamic_scaling_recommendation: manifest.dynamic_scaling_recommendation,
    },
  });
}

const monitoredStages = stages.map((stage, index) => {
  const previous = index > 0 ? stages[index - 1] : null;
  return {
    ...stage,
    monitoring: buildStageMonitoring(stage, previous),
  };
});

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  corpus: corpusPath,
  inferred_handle: inferredHandle,
  total_rows: rows.length,
  checkpoints,
  ladder_strategy: {
    mode: explicitCheckpoints.length > 0 ? 'explicit' : 'step',
    step,
  },
  stages: monitoredStages,
  summary: buildSummary(monitoredStages),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

function buildStepCheckpoints(total, size) {
  const checkpoints = [];
  for (let value = Math.max(1, size); value < total; value += Math.max(1, size)) {
    checkpoints.push(value);
  }
  checkpoints.push(total);
  return normalizeCheckpoints(checkpoints, total);
}

function normalizeCheckpoints(values, total) {
  return [...new Set(values.map((value) => Math.max(1, Math.min(total, value))))]
    .sort((left, right) => left - right);
}

function readIntFlag(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const raw = Number.parseInt(args[index + 1] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function readCsvIntFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return [];
  return String(args[index + 1] ?? '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function inferHandle(rows) {
  const author = rows.find((row) => typeof row?.author === 'string' && row.author.trim())?.author;
  if (typeof author === 'string' && author.trim()) {
    return author.replace(/^@/, '').toLowerCase();
  }
  const url = rows.find((row) => row?.url)?.url;
  if (typeof url === 'string') {
    const match = url.match(/x\.com\/([^/]+)\/status/i);
    if (match?.[1] && match[1].toLowerCase() !== 'i') return match[1].replace(/^@/, '').toLowerCase();
  }
  return 'twitter-user';
}

function toDoc(tweet, inferredHandle) {
  const publishedAt = toIso(tweet.created_at ?? tweet.published_at);
  return {
    id: crypto.randomUUID(),
    source_type: 'twitter',
    source_url: tweet.url ?? tweet.source_url ?? `https://x.com/${inferredHandle}/status/${tweet.id}`,
    source_platform: 'twitter',
    content: String(tweet.text ?? tweet.content ?? '').trim(),
    author: tweet.author ?? inferredHandle,
    author_handle: `@${inferredHandle}`,
    published_at: publishedAt,
    fetched_at: new Date().toISOString(),
    metadata: {
      tweet_id: tweet.id,
      likes: tweet.likes,
      retweets: tweet.retweets,
      replies: tweet.replies,
      views: tweet.views,
    },
  };
}

function toIso(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildSummary(stages) {
  const states = summarizeCounts(stages.map((stage) => stage.dynamic_scaling_recommendation.state));
  const actions = summarizeCounts(stages.map((stage) => stage.dynamic_scaling_recommendation.action));
  const issueCounts = summarizeCounts(stages.flatMap((stage) => stage.monitoring.issues.map((issue) => issue.code)));
  const stagesWithIssues = stages
    .filter((stage) => stage.monitoring.issues.length > 0)
    .map((stage) => ({
      checkpoint: stage.checkpoint,
      issue_count: stage.monitoring.issues.length,
      issue_codes: stage.monitoring.issues.map((issue) => issue.code),
    }));
  const last = stages.at(-1);
  return {
    state_counts: states,
    action_counts: actions,
    issue_counts: issueCounts,
    stages_with_issues: stagesWithIssues,
    final_checkpoint: last?.checkpoint ?? 0,
    final_recommendation: last?.dynamic_scaling_recommendation ?? null,
    final_metrics: last?.metrics ?? null,
  };
}

function summarizeCounts(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function buildStageMonitoring(stage, previous) {
  const delta = previous
    ? {
        docs: stage.corpus_snapshot.raw_doc_count - previous.corpus_snapshot.raw_doc_count,
        stable_topic_growth: roundMetric(stage.metrics.stable_topic_growth - previous.metrics.stable_topic_growth),
        marginal_coverage_gain: roundMetric(stage.metrics.marginal_coverage_gain - previous.metrics.marginal_coverage_gain),
        duplication_pressure: roundMetric(stage.metrics.duplication_pressure - previous.metrics.duplication_pressure),
        conflict_pressure: roundMetric(stage.metrics.conflict_pressure - previous.metrics.conflict_pressure),
        runtime_pressure: roundMetric(stage.metrics.runtime_pressure - previous.metrics.runtime_pressure),
        seed_maturity: roundMetric(stage.metrics.seed_maturity - previous.metrics.seed_maturity),
        stable_signal_count: stage.merged_summary.stable_signal_count - previous.merged_summary.stable_signal_count,
        conflict_count: stage.merged_summary.conflict_count - previous.merged_summary.conflict_count,
        adaptive_shard_count: stage.adaptive_packing.adaptive_shard_count - previous.adaptive_packing.adaptive_shard_count,
      }
    : null;

  const issues = [];

  if (stage.metrics.runtime_pressure >= 0.45) {
    issues.push({
      severity: 'warn',
      code: 'runtime_pressure_high',
      message: `runtime pressure reached ${stage.metrics.runtime_pressure.toFixed(3)}, indicating provider latency or shard cost may soon become a bottleneck`,
    });
  }
  if (stage.metrics.duplication_pressure >= 0.18) {
    issues.push({
      severity: 'warn',
      code: 'duplication_pressure_high',
      message: `duplication pressure reached ${stage.metrics.duplication_pressure.toFixed(3)}, suggesting stronger dedup or pack compression may be needed`,
    });
  }
  if (stage.metrics.conflict_pressure >= 0.22) {
    issues.push({
      severity: 'warn',
      code: 'conflict_pressure_high',
      message: `conflict pressure reached ${stage.metrics.conflict_pressure.toFixed(3)}, so conflict isolation should be watched before promoting more soul signals`,
    });
  }
  if (
    stage.corpus_snapshot.raw_doc_count >= 750 &&
    stage.merged_summary.stable_signal_count <= 24 &&
    stage.merged_summary.topic_cluster_count <= 2
  ) {
    issues.push({
      severity: 'info',
      code: 'stable_signal_growth_plateau',
      message: `stable signal growth is flattening at ${stage.merged_summary.stable_signal_count} signals and ${stage.merged_summary.topic_cluster_count} topic clusters`,
    });
  }
  if (delta && delta.runtime_pressure >= 0.05) {
    issues.push({
      severity: 'warn',
      code: 'runtime_pressure_jump',
      message: `runtime pressure jumped by ${delta.runtime_pressure.toFixed(3)} from the previous checkpoint`,
    });
  }
  if (delta && delta.duplication_pressure >= 0.04) {
    issues.push({
      severity: 'warn',
      code: 'duplication_pressure_jump',
      message: `duplication pressure jumped by ${delta.duplication_pressure.toFixed(3)} from the previous checkpoint`,
    });
  }
  if (delta && delta.stable_signal_count <= 0 && stage.corpus_snapshot.raw_doc_count > 500) {
    issues.push({
      severity: 'info',
      code: 'no_new_stable_signals',
      message: 'this checkpoint did not add any new stable signals, which may indicate diminishing marginal evidence value',
    });
  }
  if (
    stage.adaptive_packing.adaptive_shard_count > 0 &&
    stage.corpus_snapshot.raw_doc_count / stage.adaptive_packing.adaptive_shard_count < 8
  ) {
    issues.push({
      severity: 'info',
      code: 'shard_granularity_tight',
      message: `adaptive shard density is tightening to ${(stage.corpus_snapshot.raw_doc_count / stage.adaptive_packing.adaptive_shard_count).toFixed(2)} docs per adaptive shard`,
    });
  }

  return {
    delta,
    issues,
    status: issues.some((issue) => issue.severity === 'warn') ? 'watch' : issues.length > 0 ? 'observe' : 'healthy',
  };
}

function roundMetric(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

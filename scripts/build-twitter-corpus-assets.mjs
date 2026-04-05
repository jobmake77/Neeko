import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const [
  corpusPathArg,
  outDirArg,
  strategyRaw = 'v2',
  providerRaw = 'kimi',
  roundsRaw = '0',
  profileRaw = 'full',
  targetDocsPerShardRaw = '220',
  maxDocsPerShardRaw = '300',
] = process.argv.slice(2);

if (!corpusPathArg || !outDirArg) {
  console.error('Usage: node scripts/build-twitter-corpus-assets.mjs <corpus.json> <outDir> [strategy=v2] [provider=kimi] [rounds=0] [profile=full] [targetDocsPerShard=220] [maxDocsPerShard=300]');
  process.exit(1);
}

const corpusPath = path.resolve(corpusPathArg);
const outDir = path.resolve(outDirArg);
const strategy = String(strategyRaw).toLowerCase() === 'legacy' ? 'legacy' : 'v2';
const provider = String(providerRaw || 'kimi');
const requestedRounds = Math.max(0, parseInt(roundsRaw, 10) || 0);
const trainingProfile = String(profileRaw || 'full');
const targetDocsPerShard = Math.max(50, parseInt(targetDocsPerShardRaw, 10) || 220);
const maxDocsPerShard = Math.max(targetDocsPerShard, parseInt(maxDocsPerShardRaw, 10) || 300);

const {
  buildCorpusSnapshot,
  planCorpusShards,
  buildInputRunManifest,
  writeCorpusPlanningAssets,
  writeShardCorpusAssets,
} = await import('../dist/testing/corpus-plan-test-entry.js');
const {
  distillCorpusShards,
  writeShardDistillationAssets,
} = await import('../dist/testing/shard-distillation-test-entry.js');
const {
  mergeShardDistillationResults,
  writeGlobalMergeAssets,
} = await import('../dist/testing/global-merge-test-entry.js');

if (!fs.existsSync(corpusPath)) {
  throw new Error(`Corpus file not found: ${corpusPath}`);
}

const rows = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
if (!Array.isArray(rows)) {
  throw new Error('Corpus file must contain a JSON array');
}

const inferredHandle = inferHandle(rows);
const personaSlug = path.basename(outDir);
const now = new Date().toISOString();
const docs = rows
  .filter((tweet) => tweet && tweet.id && tweet.text && String(tweet.text).trim())
  .map((tweet) => ({
    id: crypto.randomUUID(),
    source_type: 'twitter',
    source_url: tweet.url ?? `https://x.com/${inferredHandle}/status/${tweet.id}`,
    source_platform: 'twitter',
    content: String(tweet.text).trim(),
    author: inferredHandle,
    author_handle: `@${inferredHandle}`,
    published_at: tweet.created_at ? new Date(tweet.created_at).toISOString() : undefined,
    fetched_at: new Date().toISOString(),
    metadata: {
      tweet_id: tweet.id,
      likes: tweet.likes,
      retweets: tweet.retweets,
      replies: tweet.replies,
      views: tweet.views,
    },
  }));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'raw-docs.json'), JSON.stringify(docs, null, 2));
fs.writeFileSync(
  path.join(outDir, 'persona.json'),
  JSON.stringify(buildPersonaAsset({
    handle: inferredHandle,
    personaSlug,
    corpusPath,
    docCount: docs.length,
    now,
  }), null, 2)
);
fs.writeFileSync(
  path.join(outDir, 'soul.yaml'),
  yaml.dump(buildEmptySoulAsset({
    handle: inferredHandle,
    corpusPath,
    now,
  })),
  'utf8'
);

const snapshot = buildCorpusSnapshot(docs, { personaSlug });
const shardPlan = planCorpusShards(docs, {
  personaSlug,
  targetDocsPerShard,
  maxDocsPerShard,
});
const manifest = buildInputRunManifest({
  personaSlug,
  snapshot,
  shardPlan,
  selectedInputRouting: strategy,
  selectedKimiStabilityMode: provider === 'kimi' ? 'hybrid' : 'standard',
  provider,
  requestedRounds,
  trainingProfile,
  recommendation: null,
});

writeCorpusPlanningAssets(outDir, { snapshot, shardPlan, manifest });
writeShardCorpusAssets(outDir, docs, shardPlan);
const shardResults = distillCorpusShards(docs, shardPlan, {
  strategy,
  targetSignals: [inferredHandle, `@${inferredHandle}`],
  strategyDecision: {
    optimizationMode: 'combined',
    prioritizeTopSoulChunks: true,
    maxSoulChunks: 12,
  },
});
writeShardDistillationAssets(outDir, shardResults);
const merged = mergeShardDistillationResults(shardResults, { strategy });
writeGlobalMergeAssets(outDir, merged);
const trainingSeedPath = path.join(outDir, 'training-seed.json');
if (fs.existsSync(trainingSeedPath)) {
  const trainingSeed = fs.readFileSync(trainingSeedPath, 'utf8');
  fs.writeFileSync(path.join(outDir, 'training-seed-legacy.json'), trainingSeed);
  fs.writeFileSync(path.join(outDir, 'training-seed-v2.json'), trainingSeed);
}

const summary = {
  corpus: corpusPath,
  output_dir: outDir,
  inferred_handle: inferredHandle,
  docs: docs.length,
  shards: shardPlan.totals.shard_count,
  strategy,
  provider,
  stable_signal_count: merged.soulSeed.stable_signal_count,
  topic_cluster_count: merged.soulSeed.topic_cluster_count,
  memory_candidate_count: merged.memoryCandidates.candidate_count,
  conflict_count: merged.conflicts.conflict_count,
  stable_keywords: merged.trainingSeed.stable_keywords.slice(0, 12),
  stable_topics: merged.trainingSeed.stable_topics.slice(0, 12),
};

fs.writeFileSync(path.join(outDir, 'validation-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

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

function buildPersonaAsset({ handle, personaSlug, corpusPath, docCount, now }) {
  return {
    id: crypto.randomUUID(),
    name: handle,
    slug: personaSlug,
    handle: `@${handle}`,
    mode: 'single',
    source_targets: [handle, `@${handle}`, corpusPath],
    soul_path: 'soul.yaml',
    memory_collection: `nico_${personaSlug}`,
    status: 'created',
    training_rounds: 0,
    memory_node_count: 0,
    doc_count: docCount,
    created_at: now,
    updated_at: now,
  };
}

function buildEmptySoulAsset({ handle, corpusPath, now }) {
  return {
    version: 1,
    target_name: handle,
    target_handle: `@${handle}`,
    created_at: now,
    updated_at: now,
    data_sources: [corpusPath],
    total_chunks_processed: 0,
    language_style: {
      vocabulary_preferences: [],
      sentence_patterns: [],
      formality_level: 0.5,
      avg_sentence_length: 'medium',
      punctuation_quirks: [],
      frequent_phrases: [],
      languages_used: [],
    },
    values: {
      core_beliefs: [],
      priorities: [],
      known_stances: {},
    },
    thinking_patterns: {
      reasoning_style: [],
      decision_frameworks: [],
      cognitive_biases: [],
      problem_solving_approach: '',
      first_principles_tendency: 0.5,
      analogy_usage: 'occasional',
    },
    behavioral_traits: {
      social_patterns: [],
      stress_responses: [],
      signature_behaviors: [],
      humor_style: 'none',
      controversy_handling: 'engages-carefully',
    },
    knowledge_domains: {
      expert: [],
      familiar: [],
      blind_spots: [],
    },
    overall_confidence: 0,
    coverage_score: 0,
    training_rounds_completed: 0,
  };
}

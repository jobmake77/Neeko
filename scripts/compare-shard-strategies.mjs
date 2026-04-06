import fs from 'node:fs';
import path from 'node:path';

const [personaDirArg, outputPathArg] = process.argv.slice(2);

if (!personaDirArg) {
  console.error('Usage: node scripts/compare-shard-strategies.mjs <personaDir> [outputPath]');
  process.exit(1);
}

const personaDir = path.resolve(personaDirArg);
const outputPath = outputPathArg
  ? path.resolve(outputPathArg)
  : path.join(personaDir, 'adaptive-shard-comparison.json');

const rawDocsPath = path.join(personaDir, 'raw-docs.json');
const personaPath = path.join(personaDir, 'persona.json');
const evidenceIndexPath = path.join(personaDir, 'evidence-index.jsonl');

if (!fs.existsSync(rawDocsPath) || !fs.existsSync(personaPath)) {
  throw new Error(`Missing persona assets under ${personaDir}`);
}

const persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
const rawDocs = JSON.parse(fs.readFileSync(rawDocsPath, 'utf8'));

const {
  buildStandaloneEvidenceBatch,
  loadEvidenceItemsFromFile,
} = await import('../dist/testing/evidence-layer-test-entry.js');
const {
  buildCorpusSnapshot,
  planCorpusShards,
} = await import('../dist/testing/corpus-plan-test-entry.js');
const {
  buildEvidencePacks,
} = await import('../dist/testing/dynamic-scaling-test-entry.js');
const {
  planAdaptiveShards,
} = await import('../dist/testing/shard-distillation-test-entry.js');

const evidenceItems = fs.existsSync(evidenceIndexPath)
  ? loadEvidenceItemsFromFile(evidenceIndexPath)
  : [];
const packSourceItems = evidenceItems.length > 0 ? evidenceItems : buildStandaloneEvidenceBatch(rawDocs).items;

const snapshot = buildCorpusSnapshot(rawDocs, { personaSlug: persona.slug });
const legacyShardPlan = planCorpusShards(rawDocs, { personaSlug: persona.slug });
const packBuild = buildEvidencePacks(packSourceItems, { personaSlug: persona.slug });
const adaptiveShardPlan = planAdaptiveShards(packBuild.packs, { personaSlug: persona.slug });

const comparison = {
  generated_at: new Date().toISOString(),
  persona: {
    slug: persona.slug,
    handle: persona.handle,
    doc_count: rawDocs.length,
  },
  corpus_snapshot: snapshot,
  legacy_shard_plan: {
    shard_count: legacyShardPlan.totals.shard_count,
    estimated_tokens: legacyShardPlan.totals.estimated_tokens,
    estimated_chunks: legacyShardPlan.totals.estimated_chunks,
    avg_docs_per_shard:
      legacyShardPlan.totals.shard_count === 0
        ? 0
        : legacyShardPlan.totals.raw_doc_count / legacyShardPlan.totals.shard_count,
    avg_tokens_per_shard:
      legacyShardPlan.totals.shard_count === 0
        ? 0
        : legacyShardPlan.totals.estimated_tokens / legacyShardPlan.totals.shard_count,
    max_days_span: Math.max(0, ...legacyShardPlan.shards.map((shard) => shard.days_span ?? 0)),
  },
  pack_summary: {
    pack_count: packBuild.packs.length,
    avg_items_per_pack: packBuild.stats.avg_items_per_pack,
    avg_tokens_per_pack: packBuild.stats.avg_tokens_per_pack,
    high_risk_pack_count: packBuild.stats.high_risk_pack_count,
    high_duplication_pack_count: packBuild.stats.high_duplication_pack_count,
    target_dominant_pack_count: packBuild.stats.target_dominant_pack_count,
  },
  dynamic_scaling_metrics: packBuild.metrics,
  adaptive_shard_plan: {
    shard_count: adaptiveShardPlan.totals.shard_count,
    estimated_tokens: adaptiveShardPlan.totals.estimated_tokens,
    estimated_chunks: adaptiveShardPlan.totals.estimated_chunks,
    avg_packs_per_shard:
      adaptiveShardPlan.totals.shard_count === 0
        ? 0
        : adaptiveShardPlan.totals.pack_count / adaptiveShardPlan.totals.shard_count,
    avg_tokens_per_shard:
      adaptiveShardPlan.totals.shard_count === 0
        ? 0
        : adaptiveShardPlan.totals.estimated_tokens / adaptiveShardPlan.totals.shard_count,
    avg_runtime_cost_hint:
      adaptiveShardPlan.shards.length === 0
        ? 0
        : adaptiveShardPlan.shards.reduce((sum, shard) => sum + shard.runtime_cost_hint, 0) / adaptiveShardPlan.shards.length,
    avg_topical_entropy:
      adaptiveShardPlan.shards.length === 0
        ? 0
        : adaptiveShardPlan.shards.reduce((sum, shard) => sum + shard.topical_entropy, 0) / adaptiveShardPlan.shards.length,
    avg_dominant_topic_concentration:
      adaptiveShardPlan.shards.length === 0
        ? 0
        : adaptiveShardPlan.shards.reduce((sum, shard) => sum + (shard.dominant_topic_concentration ?? 0), 0) / adaptiveShardPlan.shards.length,
    high_coherence_shard_ratio:
      adaptiveShardPlan.shards.length === 0
        ? 0
        : adaptiveShardPlan.shards.filter((shard) => (shard.dominant_topic_concentration ?? 0) >= 0.67).length / adaptiveShardPlan.shards.length,
    max_days_span: Math.max(0, ...adaptiveShardPlan.shards.map((shard) => shard.days_span ?? 0)),
  },
  representative_packs: packBuild.packs.slice(0, 5).map((pack) => ({
    id: pack.id,
    source_type: pack.source_type,
    scene_profile: pack.scene_profile,
    primary_speaker_role: pack.primary_speaker_role,
    item_count: pack.stats.item_count,
    estimated_tokens: pack.stats.estimated_tokens,
    topic_signature: pack.topic_signature,
    scores: pack.scores,
  })),
  representative_adaptive_shards: adaptiveShardPlan.shards.slice(0, 5).map((shard) => ({
    shard_id: shard.shard_id,
    pack_count: shard.pack_count,
    item_count: shard.item_count,
    estimated_tokens: shard.estimated_tokens,
    dominant_topic: shard.dominant_topic,
    dominant_topic_concentration: shard.dominant_topic_concentration,
    topical_entropy: shard.topical_entropy,
    avg_pack_value: shard.avg_pack_value,
    runtime_cost_hint: shard.runtime_cost_hint,
    topic_signatures: shard.topic_signatures,
  })),
};

fs.writeFileSync(outputPath, JSON.stringify(comparison, null, 2));
console.log(JSON.stringify(comparison, null, 2));

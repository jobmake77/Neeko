import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  WorkbenchService,
  WorkbenchStore,
} from '../dist/testing/train-test-entry.js';
import { buildChatEvidenceBatchFromFile } from '../dist/testing/evidence-layer-test-entry.js';
import { buildEvidencePacks } from '../dist/testing/shard-distillation-test-entry.js';
import { withTempDataDir } from './helpers/with-temp-data-dir.mjs';

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function makeSource(id = 'source-1') {
  return {
    id,
    type: 'social',
    mode: 'handle',
    platform: 'x',
    handle_or_url: '@relation-net',
    links: [],
    target_aliases: [],
    sync_strategy: 'deep_window',
    horizon_mode: 'deep_archive',
    horizon_years: 5,
    batch_limit: 100,
    enabled: true,
    status: 'idle',
  };
}

test('workbench cultivation detail reads training-seed-v3 and exposes network summary', async () => {
  await withTempDataDir('neeko-workbench-network-', async (dataDir) => {
    const slug = 'relation-net';
    const now = '2026-04-25T10:00:00.000Z';
    const store = new WorkbenchStore(join(dataDir, 'workbench'));

    store.savePersonaConfig({
      persona_slug: slug,
      name: 'Relation Net',
      sources: [makeSource()],
      update_policy: {
        auto_check_remote: true,
        check_interval_minutes: 60,
        strategy: 'incremental',
      },
      updated_at: now,
    });

    const personaDir = join(dataDir, 'personas', slug);
    mkdirSync(personaDir, { recursive: true });
    saveJson(join(personaDir, 'training-seed-v3.json'), {
      dominant_domains: ['Relationships', 'Systems'],
      high_confidence_claims: [
        { claim: 'Worked with collaborator entities', ownership: 'self_related', confidence: 0.82 },
      ],
    });
    saveJson(join(personaDir, 'entity-index.json'), {
      entities: [
        { id: 'entity-1', label: 'Collaborator', domains: ['Collaboration'] },
      ],
    });
    saveJson(join(personaDir, 'relation-graph.json'), {
      relations: [
        { source: 'entity-1', target: 'entity-2', type: 'worked_with' },
      ],
    });
    saveJson(join(personaDir, 'context-packs.json'), {
      packs: [
        { id: 'pack-1', domain_labels: ['Private Context', 'Systems'] },
      ],
    });
    saveJson(join(personaDir, 'identity-arcs.json'), {
      arcs: [
        { from: 'builder', to: 'mentor' },
      ],
    });

    const service = new WorkbenchService(store, process.execPath, '/Users/a77/Desktop/Neeko');
    const detail = service.getCultivationDetail(slug);

    assert.equal(detail.network_summary.entity_count, 1);
    assert.equal(detail.network_summary.relation_count, 1);
    assert.equal(detail.network_summary.context_pack_count, 1);
    assert.equal(detail.network_summary.arc_count, 1);
    assert.equal(detail.network_summary.high_confidence_claim_count, 1);
    assert.equal(detail.source_summary.network_summary.entity_count, 1);
    assert.equal(detail.source_summary.network_summary.relation_count, 1);
    assert.equal(detail.source_summary.network_summary.context_pack_count, 1);
    assert.equal(detail.source_summary.network_summary.arc_count, 1);
    assert.equal(detail.source_summary.network_summary.high_confidence_claim_count, 1);
    assert.deepEqual(
      detail.network_summary.dominant_domains,
      ['relationships', 'systems', 'collaboration', 'private context'],
    );
  });
});

test('workbench cultivation detail backfills persona-web artifacts from legacy training prep', async () => {
  await withTempDataDir('neeko-workbench-network-', async (dataDir) => {
    const slug = 'legacy-network';
    const now = '2026-04-25T12:00:00.000Z';
    const store = new WorkbenchStore(join(dataDir, 'workbench'));
    const prepId = '22222222-2222-4222-8222-222222222222';

    store.savePersonaConfig({
      persona_slug: slug,
      name: 'Legacy Network',
      sources: [makeSource('legacy-source')],
      update_policy: {
        auto_check_remote: true,
        check_interval_minutes: 60,
        strategy: 'incremental',
        last_training_prep_id: prepId,
        last_training_prep_count: 1,
        last_training_baseline_clean_count: 1,
      },
      updated_at: now,
    });

    const personaDir = join(dataDir, 'personas', slug);
    mkdirSync(personaDir, { recursive: true });
    saveJson(join(personaDir, 'persona.json'), {
      id: '11111111-1111-1111-1111-111111111111',
      slug,
      name: 'Legacy Network',
      handle: '@legacy-network',
      mode: 'single',
      source_targets: ['@legacy-network'],
      soul_path: 'soul.yaml',
      memory_collection: `nico_${slug}`,
      status: 'available',
      memory_node_count: 0,
      doc_count: 1,
      training_rounds: 1,
      created_at: now,
      updated_at: now,
    });

    const prepDir = join(dataDir, 'workbench', 'training-preps', prepId);
    mkdirSync(prepDir, { recursive: true });
    saveJson(join(prepDir, 'documents.json'), [
      {
        id: '33333333-3333-4333-8333-333333333333',
        source_type: 'twitter',
        author: 'Legacy Network',
        source_url: 'https://x.com/legacy/status/1',
        content: 'I built Bookface and I write about founders, YC, and developer tools.',
        fetched_at: now,
        published_at: '2026-04-24T00:00:00.000Z',
      },
    ]);
    writeFileSync(join(prepDir, 'evidence-index.jsonl'), [
      JSON.stringify({
        id: '44444444-4444-4444-8444-444444444444',
        raw_document_id: '33333333-3333-4333-8333-333333333333',
        source_type: 'twitter',
        modality: 'text',
        content: 'I built Bookface and I work with founders on developer tools.',
        speaker_role: 'target',
        speaker_name: 'Legacy Network',
        target_confidence: 0.98,
        scene: 'public',
        window_role: 'target_centered',
        context_before: [],
        context_after: [],
        evidence_kind: 'statement',
        stability_hints: {
          repeated_count: 1,
          repeated_in_sessions: 1,
          cross_session_stable: true,
        },
        metadata: {},
      }),
      '',
    ].join('\n'), 'utf-8');

    store.saveTrainingPrepArtifact({
      id: prepId,
      persona_slug: slug,
      status: 'drafted',
      item_count: 1,
      summary: 'Legacy prep without persona-web artifacts metadata.',
      evidence_index_path: join(prepDir, 'evidence-index.jsonl'),
      documents_path: join(prepDir, 'documents.json'),
      created_at: now,
      updated_at: now,
    });

    const service = new WorkbenchService(store, process.execPath, '/Users/a77/Desktop/Neeko');
    const detail = service.getCultivationDetail(slug);
    const updatedPrep = store.getTrainingPrepArtifact(prepId);

    assert.ok(detail.network_summary.entity_count > 0);
    assert.ok(detail.network_summary.relation_count > 0);
    assert.ok(existsSync(join(personaDir, 'training-seed-v3.json')));
    assert.ok(existsSync(join(personaDir, 'entity-index.json')));
    assert.ok(existsSync(join(personaDir, 'relation-graph.json')));
    assert.ok(updatedPrep?.persona_web_artifacts?.training_seed_v3_path);
    assert.ok(existsSync(updatedPrep.persona_web_artifacts.training_seed_v3_path));
  });
});

test('private chat evidence stays private and never expands into public soul candidates', async () => {
  await withTempDataDir('neeko-workbench-network-', async (dataDir) => {
    const transcriptPath = join(dataDir, 'private-chat.jsonl');
    writeFileSync(transcriptPath, [
      JSON.stringify({
        sender: 'Teammate',
        content: 'Can you share how you really think about this relationship?',
        timestamp: '2026-04-25T08:00:00.000Z',
      }),
      JSON.stringify({
        sender: 'Relation Net',
        content: 'Keep this between us for now, I only want to talk about it privately until it is stable.',
        timestamp: '2026-04-25T08:01:00.000Z',
      }),
      '',
    ].join('\n'), 'utf-8');

    const batch = await buildChatEvidenceBatchFromFile(transcriptPath, {
      manifest: {
        target_name: 'Relation Net',
        target_aliases: ['Relation Net'],
        self_aliases: ['Teammate'],
        known_other_aliases: [],
      },
      sourceType: 'wechat',
      sourceUrl: 'wechat://private-thread',
    });

    const packBuild = buildEvidencePacks(batch.items, {
      personaSlug: 'relation-net',
      targetTokensPerPack: 300,
      maxTokensPerPack: 600,
    });

    assert.equal(batch.items.length, 1);
    assert.equal(batch.items[0].scene, 'private');
    assert.equal(batch.stats.downgraded_scene_items, 1);
    assert.equal(batch.scene_summary.private, 1);
    assert.equal(packBuild.packs.length, 1);
    assert.equal(packBuild.packs[0].scene_profile, 'private');
    assert.equal(packBuild.packs[0].routing_projection.soul_candidate_items, 0);
    assert.equal(packBuild.packs[0].routing_projection.memory_candidate_items, 1);
  });
});

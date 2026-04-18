import test from 'node:test';
import assert from 'node:assert/strict';
import { __evaluationV2Testables } from '../dist/testing/evaluation-v2-test-entry.js';

const { buildBenchmarkContext, buildRerunStabilitySummary, inferBenchmarkSuiteTier } = __evaluationV2Testables;

test('buildBenchmarkContext adds P1 manifest and suite tier metadata', () => {
  const context = buildBenchmarkContext({
    slug: 'onevcat',
    suiteType: 'smoke_pk',
    variant: 'v2:off',
    rounds: 1,
    questionsPerRound: 1,
    smokeMode: true,
    replicaGroup: 'smoke_pk:onevcat:1x1:v2:off',
    replicaId: 'v2:off#01',
  });

  assert.equal(context.suite_tier, 'smoke');
  assert.equal(context.case_manifest.manifest_version, 'benchmark-case-manifest-v1');
  assert.equal(context.case_manifest.recipe_version, 'training-question-recipe-v1');
  assert.equal(context.case_manifest.replayable, true);
  assert.equal(context.case_manifest.replay_mode, 'replica_summary');
  assert.equal(context.case_manifest.replica_group, 'smoke_pk:onevcat:1x1:v2:off');
  assert.equal(context.case_manifest.replica_id, 'v2:off#01');
  assert.match(context.case_manifest.pack_version, /^pack-v1-/);
  assert.equal(inferBenchmarkSuiteTier('ab_regression'), 'regression');
});

test('buildRerunStabilitySummary distinguishes stable and insufficient evidence runs', () => {
  const stable = buildRerunStabilitySummary({
    runs: [
      { quality: 0.91, coverage: 0.54, contradictionRate: 0.06, duplicationRate: 0.05 },
      { quality: 0.92, coverage: 0.55, contradictionRate: 0.05, duplicationRate: 0.04 },
      { quality: 0.905, coverage: 0.545, contradictionRate: 0.055, duplicationRate: 0.045 },
    ],
    cleanReplicaCount: 3,
    totalReplicaCount: 3,
  });
  const insufficient = buildRerunStabilitySummary({
    runs: [{ quality: 0.91, coverage: 0.54, contradictionRate: 0.06, duplicationRate: 0.05 }],
    cleanReplicaCount: 1,
    totalReplicaCount: 1,
  });

  assert.equal(stable.stability_label, 'stable');
  assert.equal(stable.stable, true);
  assert.equal(stable.replica_count, 3);
  assert.equal(stable.excluded_replica_count, 0);
  assert.equal(insufficient.stability_label, 'insufficient_evidence');
  assert.equal(insufficient.stable, false);
  assert.match(insufficient.reasons.join(' '), /at least 2 measured replicas/);
});

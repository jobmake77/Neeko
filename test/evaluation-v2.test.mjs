import test from 'node:test';
import assert from 'node:assert/strict';
import { __evaluationV2Testables } from '../dist/testing/evaluation-v2-test-entry.js';

const {
  buildBenchmarkContext,
  buildBenchmarkFingerprints,
  buildFrozenCaseManifest,
  buildRerunStabilitySummary,
  inferBenchmarkSuiteTier,
  summarizeBenchmarkHomogeneity,
  toFrozenQuestionRounds,
} = __evaluationV2Testables;

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

test('buildFrozenCaseManifest freezes generated cases with provider/runtime/judge fingerprints', () => {
  const fingerprints = buildBenchmarkFingerprints({
    provider: {
      training: { provider: 'openai', model: 'gpt-4o-mini' },
    },
    runtime: {
      runtime_preset: 'balanced',
      kimi_stability_mode: 'standard',
    },
    judge: {
      evaluator_layered: true,
      evaluator_dual_review: false,
      calibration_version: 'evaluation-rubric-v1-mini',
      calibration_examples: 3,
    },
  });
  const frozen = buildFrozenCaseManifest({
    slug: 'onevcat',
    suiteType: 'routing_compare',
    variant: 'v2:off',
    rounds: 2,
    questionsPerRound: 2,
    replicaGroup: 'routing_compare:onevcat:2x2:v2:off',
    replicaId: 'v2:off#01',
    freezeFingerprints: fingerprints,
    cases: [
      {
        case_id: 'r01-q01',
        round: 1,
        ordinal: 1,
        question: 'How do you review an architecture proposal?',
        strategy: 'consistency',
        target_dimension: 'thinking_patterns',
        expected_challenge_level: 'medium',
      },
      {
        case_id: 'r02-q01',
        round: 2,
        ordinal: 1,
        question: 'What tradeoff do you accept for long-term maintainability?',
        strategy: 'scenario',
        target_dimension: 'values',
        expected_challenge_level: 'hard',
      },
    ],
  });

  assert.equal(frozen.manifest.manifest_version, 'benchmark-case-manifest-v2');
  assert.equal(frozen.manifest.freeze_level, 'frozen_cases');
  assert.equal(frozen.manifest.case_count, 2);
  assert.equal(frozen.manifest.replay_mode, 'replica_summary');
  assert.equal(frozen.manifest.provider_fingerprint, fingerprints.provider_fingerprint);
  assert.equal(frozen.manifest.runtime_fingerprint, fingerprints.runtime_fingerprint);
  assert.equal(frozen.manifest.judge_fingerprint, fingerprints.judge_fingerprint);
  assert.match(frozen.manifest.pack_version, /^pack-v2-/);
  assert.match(frozen.manifest.case_manifest_hash, /^[a-f0-9]{12}$/);
  assert.match(frozen.manifest.question_digest, /^[a-f0-9]{12}$/);
});

test('summarizeBenchmarkHomogeneity rejects mixed freeze levels and missing fingerprints', () => {
  const fingerprints = buildBenchmarkFingerprints({
    provider: { training: { provider: 'openai', model: 'gpt-4o-mini' } },
    runtime: { runtime_preset: 'balanced' },
    judge: { evaluator_layered: true },
  });
  const frozen = buildFrozenCaseManifest({
    slug: 'onevcat',
    suiteType: 'smoke_pk',
    variant: 'v2:off',
    rounds: 1,
    questionsPerRound: 1,
    freezeFingerprints: fingerprints,
    cases: [
      {
        case_id: 'r01-q01',
        round: 1,
        ordinal: 1,
        question: 'Describe your preferred code review cadence.',
        strategy: 'scenario',
        target_dimension: 'behavioral_traits',
        expected_challenge_level: 'easy',
      },
    ],
  });
  const recipeOnly = buildBenchmarkContext({
    slug: 'onevcat',
    suiteType: 'smoke_pk',
    variant: 'v2:off',
    rounds: 1,
    questionsPerRound: 1,
    smokeMode: true,
  }).case_manifest;
  const summary = summarizeBenchmarkHomogeneity([
    frozen.manifest,
    {
      ...frozen.manifest,
      manifest_id: 'smoke_pk:onevcat:v2:off:other',
      pack_version: 'pack-v2-other',
      provider_fingerprint: 'provider-other',
    },
    recipeOnly,
  ]);

  assert.equal(summary.homogeneous, false);
  assert.deepEqual(summary.manifest_versions.sort(), ['benchmark-case-manifest-v1', 'benchmark-case-manifest-v2']);
  assert.deepEqual(summary.freeze_levels.sort(), ['frozen_cases', 'recipe_only']);
  assert.match(summary.reasons.join(' '), /mixed manifest versions detected/);
  assert.match(summary.reasons.join(' '), /benchmark set is not fully frozen at case level/);
  assert.match(summary.reasons.join(' '), /provider freeze fingerprint missing/);
  assert.match(summary.reasons.join(' '), /mixed provider freeze fingerprints detected/);
});

test('toFrozenQuestionRounds restores ordered replay rounds from a frozen manifest', () => {
  const frozen = {
    manifest: {
      manifest_id: 'routing_compare:onevcat:v2:off:digest',
      manifest_version: 'benchmark-case-manifest-v2',
      pack_version: 'pack-v2-demo',
      recipe_version: 'training-question-recipe-v1',
      suite_label: 'routing_compare:v2:off',
      suite_tier: 'ad_hoc',
      flavor: 'v2:off',
      replayable: true,
      replay_mode: 'recipe_only',
      freeze_level: 'frozen_cases',
      case_count: 3,
      provider_fingerprint: 'provider-demo',
      runtime_fingerprint: 'runtime-demo',
      judge_fingerprint: 'judge-demo',
    },
    cases: [
      {
        case_id: 'r02-q01',
        round: 2,
        ordinal: 1,
        question: 'How do you reduce variance in evaluation runs?',
        strategy: 'scenario',
        target_dimension: 'thinking_patterns',
        expected_challenge_level: 'hard',
      },
      {
        case_id: 'r01-q02',
        round: 1,
        ordinal: 2,
        question: 'What kind of benchmark drift do you distrust most?',
        strategy: 'stress_test',
        target_dimension: 'values',
        expected_challenge_level: 'medium',
      },
      {
        case_id: 'r01-q01',
        round: 1,
        ordinal: 1,
        question: 'How do you structure a benchmark replay?',
        strategy: 'consistency',
        target_dimension: 'behavioral_traits',
        expected_challenge_level: 'easy',
      },
    ],
  };

  const rounds = toFrozenQuestionRounds(frozen);
  assert.equal(rounds.length, 2);
  assert.deepEqual(
    rounds[0].map((item) => item.question),
    ['How do you structure a benchmark replay?', 'What kind of benchmark drift do you distrust most?']
  );
  assert.equal(rounds[1][0].strategy, 'scenario');
  assert.equal(rounds[1][0].target_dimension, 'thinking_patterns');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPkAggregateSummary,
  defaultCurrentGrayPathRecommendation,
} from '../dist/testing/pk-aggregate-test-entry.js';

function benchmarkContextForVariant(variant, overrides = {}) {
  const baseManifest = {
    manifest_id: `smoke_pk:demo:${variant}:manifest`,
    manifest_version: 'benchmark-case-manifest-v2',
    pack_version: `pack-v2-${variant.replace(/[^a-z0-9]+/gi, '-')}`,
    recipe_version: 'training-question-recipe-v1',
    suite_label: `smoke_pk:${variant}`,
    suite_tier: 'smoke',
    flavor: variant,
    replayable: true,
    replay_mode: 'replica_summary',
    freeze_level: 'frozen_cases',
    case_manifest_hash: `hash-${variant.replace(/[^a-z0-9]+/gi, '-')}`,
    question_digest: `digest-${variant.replace(/[^a-z0-9]+/gi, '-')}`,
    case_count: 1,
    provider_fingerprint: 'provider-demo',
    runtime_fingerprint: 'runtime-demo',
    judge_fingerprint: 'judge-demo',
  };
  const manifestOverrides = overrides.case_manifest ?? {};

  return {
    pack_id: `smoke_pk:demo:${variant}:1x1`,
    pack_type: 'smoke',
    suite_type: 'smoke_pk',
    suite_tier: 'smoke',
    case_count: 1,
    rounds: 1,
    questions_per_round: 1,
    case_distribution: { generated_questions: 1 },
    ...overrides,
    case_manifest: {
      ...baseManifest,
      ...manifestOverrides,
    },
  };
}

function run(overrides = {}) {
  const variant = overrides.variant ?? 'legacy:off';
  const [inputRouting = 'legacy', trainingSeedMode = 'off'] = String(variant).split(':');
  return {
    variant,
    repeat: 1,
    quality: 0.91,
    coverage: 0.5333,
    contradictionRate: 0,
    duplicationRate: 0,
    inputRouting,
    trainingSeedMode,
    observability: {
      raw_docs: 1503,
      clean_docs: 1420,
      chunks: 1380,
      soul_docs: 920,
      memory_docs: 300,
      discard_docs: 200,
      filtered_low_quality_docs: 83,
    },
    scalingObservability: {
      stable_topic_growth: 0.76,
      duplication_pressure: 0.11,
      seed_maturity: 0.8,
      dynamic_scaling_state: 'explore',
      dynamic_scaling_action: 'continue_expand',
      dynamic_scaling_confidence: 0.87,
      dynamic_scaling_reason: 'still growing',
    },
    runtimeObservability: {
      trainer_fallbacks: 0,
      persona_fallbacks: 0,
      evaluator_fallbacks: 0,
      director_fallbacks: 0,
    },
    runQuality: 'clean',
    contamination: null,
    benchmarkContext: benchmarkContextForVariant(variant, overrides.benchmarkContext),
    routingDecisionRecord: {
      account_type: 'mixed_commentary_stream',
      stage_type: 'mixed_growth',
      recommended_routing: { input_routing: 'legacy', training_seed_mode: 'off' },
    },
    ...overrides,
  };
}

test('pk aggregate summary keeps raw mean and clean mean after excluding fallback outlier', () => {
  const summary = buildPkAggregateSummary({
    runs: [
      run({ variant: 'legacy:off', repeat: 1 }),
      run({
        variant: 'v2:off',
        repeat: 1,
        quality: 0.91,
        coverage: 0.5333,
        inputRouting: 'v2',
        routingDecisionRecord: {
          account_type: 'mixed_commentary_stream',
          stage_type: 'mixed_growth',
          recommended_routing: { input_routing: 'legacy', training_seed_mode: 'off' },
        },
      }),
      run({
        variant: 'v2:off',
        repeat: 2,
        quality: 0.15,
        coverage: 0.3135,
        inputRouting: 'v2',
        runtimeObservability: {
          trainer_fallbacks: 0,
          persona_fallbacks: 1,
          evaluator_fallbacks: 0,
          director_fallbacks: 0,
        },
        routingDecisionRecord: {
          account_type: 'mixed_commentary_stream',
          stage_type: 'noise_limited',
          recommended_routing: { input_routing: 'legacy', training_seed_mode: 'off' },
        },
      }),
    ],
    currentGrayPathRecommendation: defaultCurrentGrayPathRecommendation(),
  });

  const v2Off = summary.aggregate_by_variant['v2:off'];
  assert.equal(v2Off.runs, 2);
  assert.equal(v2Off.clean_runs, 1);
  assert.equal(v2Off.excluded_runs, 1);
  assert.equal(v2Off.mean_quality, 0.53);
  assert.equal(v2Off.clean_mean_quality, 0.91);
  assert.equal(v2Off.run_quality_counts.clean, 2);
  assert.equal(v2Off.official_scorecard?.version, 'evaluation-v2-p1');
  assert.equal(v2Off.observed_scorecard?.version, 'evaluation-v2-p1');
  assert.equal(v2Off.observed_rerun_stability.stability_label, 'volatile');
  assert.equal(v2Off.official_rerun_stability.stability_label, 'insufficient_evidence');
  assert.equal(v2Off.benchmark_homogeneity.homogeneous, true);
  assert.match(v2Off.excluded_run_details[0].reason, /fallback-contaminated outlier/);

  assert.equal(summary.benchmark_homogeneity.overall_homogeneous, true);
  assert.equal(summary.routing_decision_aggregate.excluded_run_count, 1);
  assert.equal(summary.routing_decision_aggregate.run_quality_counts.clean, 3);
  assert.equal(summary.rerun_stability_by_variant['v2:off'].observed.stability_label, 'volatile');
  assert.equal(summary.routing_decision_aggregate.local_recommendation_counts['legacy+off'], 2);
  assert.equal(summary.routing_decision_aggregate.record_coverage.available, 2);
  assert.equal(summary.routing_decision_aggregate.record_coverage.missing, 0);
  assert.equal(summary.routing_decision_aggregate.overall_record?.stage_type, 'mixed_growth');
  assert.deepEqual(summary.routing_decision_aggregate.overall_record?.recommended_routing, {
    input_routing: 'v2',
    training_seed_mode: 'off',
  });
});

test('pk aggregate excludes explicitly contaminated runs before fallback-outlier heuristics', () => {
  const summary = buildPkAggregateSummary({
    runs: [
      run({
        variant: 'v2:signals',
        repeat: 1,
        quality: 0.9,
        coverage: 0.54,
        inputRouting: 'v2',
        trainingSeedMode: 'signals',
        routingDecisionRecord: {
          account_type: 'mixed_commentary_stream',
          stage_type: 'mixed_growth',
          recommended_routing: { input_routing: 'v2', training_seed_mode: 'signals' },
        },
      }),
      run({
        variant: 'v2:signals',
        repeat: 2,
        quality: 0.89,
        coverage: 0.53,
        inputRouting: 'v2',
        trainingSeedMode: 'signals',
        runQuality: 'contaminated',
        contamination: {
          status: 'contaminated',
          reasons: ['judge_fallback'],
          summary: 'run is contaminated: judge_fallback',
          details: ['evaluator=1'],
        },
        runtimeObservability: {
          trainer_fallbacks: 0,
          persona_fallbacks: 0,
          evaluator_fallbacks: 1,
          director_fallbacks: 0,
        },
        routingDecisionRecord: {
          account_type: 'mixed_commentary_stream',
          stage_type: 'mixed_growth',
          recommended_routing: { input_routing: 'v2', training_seed_mode: 'signals' },
        },
      }),
    ],
    currentGrayPathRecommendation: defaultCurrentGrayPathRecommendation(),
  });

  const aggregate = summary.aggregate_by_variant['v2:signals'];
  assert.equal(aggregate.runs, 2);
  assert.equal(aggregate.clean_runs, 1);
  assert.equal(aggregate.excluded_runs, 1);
  assert.equal(aggregate.run_quality_counts.clean, 1);
  assert.equal(aggregate.run_quality_counts.contaminated, 1);
  assert.equal(aggregate.excluded_run_details[0].reason, 'run is contaminated: judge_fallback');
  assert.equal(aggregate.official_scorecard?.version, 'evaluation-v2-p1');
  assert.equal(aggregate.observed_scorecard?.version, 'evaluation-v2-p1');
  assert.equal(aggregate.observed_rerun_stability.stability_label, 'provisional');
  assert.equal(aggregate.official_rerun_stability.stability_label, 'insufficient_evidence');
  assert.equal(aggregate.benchmark_homogeneity.homogeneous, true);
  assert.equal(summary.routing_decision_aggregate.run_quality_counts.contaminated, 1);
  assert.equal(summary.routing_decision_aggregate.excluded_reason_counts['run is contaminated: judge_fallback'], 1);
});

test('pk aggregate flags benchmark homogeneity drift within the same variant', () => {
  const summary = buildPkAggregateSummary({
    runs: [
      run({
        variant: 'v2:off',
        repeat: 1,
        inputRouting: 'v2',
      }),
      run({
        variant: 'v2:off',
        repeat: 2,
        inputRouting: 'v2',
        benchmarkContext: benchmarkContextForVariant('v2:off', {
          case_manifest: {
            manifest_id: 'smoke_pk:demo:v2:off:manifest-b',
            pack_version: 'pack-v2-v2-off-b',
            provider_fingerprint: 'provider-demo-b',
          },
        }),
      }),
    ],
    currentGrayPathRecommendation: defaultCurrentGrayPathRecommendation(),
  });

  const aggregate = summary.aggregate_by_variant['v2:off'];
  assert.equal(aggregate.benchmark_homogeneity.homogeneous, false);
  assert.match(aggregate.benchmark_homogeneity.reasons.join(' '), /mixed pack versions detected/);
  assert.match(aggregate.benchmark_homogeneity.reasons.join(' '), /mixed provider freeze fingerprints detected/);
  assert.equal(summary.benchmark_homogeneity.overall_homogeneous, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPkAggregateSummary,
  defaultCurrentGrayPathRecommendation,
} from '../dist/testing/pk-aggregate-test-entry.js';

function run(overrides = {}) {
  return {
    variant: 'legacy:off',
    repeat: 1,
    quality: 0.91,
    coverage: 0.5333,
    contradictionRate: 0,
    duplicationRate: 0,
    inputRouting: 'legacy',
    trainingSeedMode: 'off',
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
  assert.match(v2Off.excluded_run_details[0].reason, /fallback-contaminated outlier/);

  assert.equal(summary.routing_decision_aggregate.excluded_run_count, 1);
  assert.equal(summary.routing_decision_aggregate.local_recommendation_counts['legacy+off'], 2);
  assert.equal(summary.routing_decision_aggregate.record_coverage.available, 2);
  assert.equal(summary.routing_decision_aggregate.record_coverage.missing, 0);
  assert.equal(summary.routing_decision_aggregate.overall_record?.stage_type, 'mixed_growth');
  assert.deepEqual(summary.routing_decision_aggregate.overall_record?.recommended_routing, {
    input_routing: 'v2',
    training_seed_mode: 'off',
  });
});

import fs from 'node:fs';
import path from 'node:path';

const [slug, outputPathArg, ...summaryPathsRaw] = process.argv.slice(2);

if (!slug || !outputPathArg || summaryPathsRaw.length === 0) {
  console.error(
    'Usage: /usr/local/bin/node scripts/build-pk-aggregate.mjs <slug> <outputPath> <summaryPath...>'
  );
  process.exit(1);
}

const outputPath = path.resolve(outputPathArg);
const summaryPaths = summaryPathsRaw.map((item) => path.resolve(item));
const { buildPkAggregateSummary, defaultCurrentGrayPathRecommendation } = await import(
  '../dist/testing/pk-aggregate-test-entry.js'
);

const allRuns = [];
for (const summaryPath of summaryPaths) {
  const parsed = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
  allRuns.push(...runs.map(hydrateRunFromReport));
}

const aggregateSummary = buildPkAggregateSummary({
  runs: allRuns,
  currentGrayPathRecommendation: defaultCurrentGrayPathRecommendation(),
});

const overallRecord = aggregateSummary.routing_decision_aggregate.overall_record;
const report = {
  slug,
  schema_version: 2,
  suite_type: 'smoke_pk',
  generated_at: new Date().toISOString(),
  source_summaries: summaryPaths,
  aggregate: aggregateSummary.aggregate_by_variant,
  routing_decision_aggregate: aggregateSummary.routing_decision_aggregate,
  stage_conclusion: {
    safe_default: 'legacy + off',
    recommended_gray_path: 'v2 + off',
    local_account_stage_path: overallRecord
      ? `${overallRecord.recommended_routing.input_routing} + ${overallRecord.recommended_routing.training_seed_mode}`
      : 'unknown',
    signals_status: 'keep gated',
      runtime_governance:
      aggregateSummary.routing_decision_aggregate.excluded_run_count > 0
        ? 'provider/runtime noise was detected and isolated via excluded-run handling in the PK aggregate layer'
        : 'no excluded runs were detected in the supplied summaries; current PK aggregate is clean under the new routing-decision-aware report layer',
    notes: buildStageNotes(aggregateSummary),
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputPath, summaryCount: summaryPaths.length, runCount: allRuns.length }, null, 2));

function hydrateRunFromReport(run) {
  if (
    run.runtimeObservability &&
    run.observability &&
    run.scalingObservability &&
    Object.prototype.hasOwnProperty.call(run, 'routingDecisionRecord')
  ) {
    return run;
  }

  const reportPath = typeof run.reportPath === 'string' ? run.reportPath : null;
  if (!reportPath || !fs.existsSync(reportPath)) return run;

  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const comparisonRow = Array.isArray(parsed.input_routing_comparison)
      ? parsed.input_routing_comparison.find((item) =>
          item?.input_routing === run.inputRouting &&
          item?.training_seed_mode === run.trainingSeedMode
        ) ?? parsed.input_routing_comparison[0]
      : null;

    return {
      ...run,
      runQuality: run.runQuality ?? comparisonRow?.run_quality ?? null,
      contamination: run.contamination ?? comparisonRow?.contamination ?? null,
      scorecard: run.scorecard ?? comparisonRow?.scorecard ?? null,
      judgeProvenance: run.judgeProvenance ?? comparisonRow?.judge_provenance ?? null,
      benchmarkContext: run.benchmarkContext ?? comparisonRow?.benchmark_context ?? null,
      runtimeObservability: run.runtimeObservability ?? comparisonRow?.runtime_observability ?? null,
      observability: run.observability ?? comparisonRow?.observability ?? null,
      scalingObservability: run.scalingObservability ?? comparisonRow?.scaling_observability ?? null,
      routingDecisionRecord: run.routingDecisionRecord ?? parsed.routing_decision_record ?? null,
    };
  } catch {
    return run;
  }
}

function buildStageNotes(summary) {
  const notes = [];
  const overallRecord = summary.routing_decision_aggregate.overall_record;
  const legacy = summary.aggregate_by_variant['legacy:off'];
  const v2off = summary.aggregate_by_variant['v2:off'];
  const v2signals = summary.aggregate_by_variant['v2:signals'];

  if (summary.routing_decision_aggregate.excluded_run_count > 0) {
    notes.push(
      `${summary.routing_decision_aggregate.excluded_run_count} run(s) were excluded from clean means because they matched the fallback-contaminated outlier rule`
    );
  }

  if (legacy && v2off) {
    notes.push(
      `legacy/off clean mean=${formatMetric(legacy.clean_mean_quality)}/${formatMetric(legacy.clean_mean_coverage)} vs v2/off clean mean=${formatMetric(v2off.clean_mean_quality)}/${formatMetric(v2off.clean_mean_coverage)}`
    );
  }

  if (v2signals) {
    notes.push(
      `v2/signals clean mean=${formatMetric(v2signals.clean_mean_quality)}/${formatMetric(v2signals.clean_mean_coverage)} and remains gated pending stable replication`
    );
  }

  if (overallRecord) {
    notes.push(
      `aggregate local decision currently classifies this corpus as ${overallRecord.account_type} in stage ${overallRecord.stage_type}`
    );
    notes.push(overallRecord.reason);
  }

  if (notes.length === 0) {
    notes.push('no successful runs were available to build an aggregate conclusion');
  }

  return notes;
}

function formatMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

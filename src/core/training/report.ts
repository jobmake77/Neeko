import { TrainingProgress } from './loop.js';
import { TrainingProfile } from './types.js';

export interface TrainingRunReport {
  schema_version: 1;
  generated_at: string;
  profile: TrainingProfile;
  total_rounds: number;
  summary: {
    avg_quality_score: number;
    avg_contradiction_rate: number;
    avg_duplication_rate: number;
    avg_low_confidence_coverage: number;
    total_nodes_written: number;
    total_nodes_reinforced: number;
    total_high_value_memories: number;
    total_quarantined_memories: number;
  };
  rounds: Array<{
    round: number;
    status: TrainingProgress['status'];
    avg_quality_score: number;
    nodes_written: number;
    nodes_reinforced: number;
    contradiction_rate: number;
    duplication_rate: number;
    low_confidence_coverage: number;
    new_high_value_memories: number;
    quarantined_memories: number;
    score_distribution: TrainingProgress['observability']['scoreDistribution'];
  }>;
}

export type TrainingRoundSnapshot = TrainingRunReport['rounds'][number];

export function buildTrainingRunReport(
  profile: TrainingProfile,
  history: TrainingProgress[]
): TrainingRunReport {
  const rounds = history.map((item) => ({
    round: item.round,
    status: item.status,
    avg_quality_score: item.avgQualityScore,
    nodes_written: item.nodesWritten,
    nodes_reinforced: item.nodesReinforced,
    contradiction_rate: item.observability.contradictionRate,
    duplication_rate: item.observability.duplicationRate,
    low_confidence_coverage: item.observability.lowConfidenceCoverage,
    new_high_value_memories: item.observability.newHighValueMemories,
    quarantined_memories: item.observability.quarantinedMemories,
    score_distribution: item.observability.scoreDistribution,
  }));

  return buildTrainingRunReportFromRounds(profile, rounds);
}

export function buildTrainingRunReportFromRounds(
  profile: TrainingProfile,
  rounds: TrainingRoundSnapshot[]
): TrainingRunReport {
  const normalizedRounds = [...rounds].sort((a, b) => a.round - b.round);

  const count = Math.max(1, normalizedRounds.length);
  const totalNodesWritten = normalizedRounds.reduce((sum, r) => sum + r.nodes_written, 0);
  const totalNodesReinforced = normalizedRounds.reduce((sum, r) => sum + r.nodes_reinforced, 0);
  const totalHighValueMemories = normalizedRounds.reduce((sum, r) => sum + r.new_high_value_memories, 0);
  const totalQuarantinedMemories = normalizedRounds.reduce((sum, r) => sum + r.quarantined_memories, 0);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    profile,
    total_rounds: normalizedRounds.length,
    summary: {
      avg_quality_score: normalizedRounds.reduce((sum, r) => sum + r.avg_quality_score, 0) / count,
      avg_contradiction_rate: normalizedRounds.reduce((sum, r) => sum + r.contradiction_rate, 0) / count,
      avg_duplication_rate: normalizedRounds.reduce((sum, r) => sum + r.duplication_rate, 0) / count,
      avg_low_confidence_coverage: normalizedRounds.reduce((sum, r) => sum + r.low_confidence_coverage, 0) / count,
      total_nodes_written: totalNodesWritten,
      total_nodes_reinforced: totalNodesReinforced,
      total_high_value_memories: totalHighValueMemories,
      total_quarantined_memories: totalQuarantinedMemories,
    },
    rounds: normalizedRounds,
  };
}

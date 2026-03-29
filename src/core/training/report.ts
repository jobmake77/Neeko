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
    origin_skills_added: number;
    distilled_skills_added: number;
    skill_coverage_score: number;
    gap_focused_questions_ratio: number;
    skill_trigger_precision: number;
    skill_method_adherence: number;
    skill_boundary_violation_rate: number;
    skill_transfer_success_rate: number;
    skill_set_stability: number;
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
    gap_focused_questions: number;
    total_questions: number;
    skill_trigger_precision: number;
    skill_method_adherence: number;
    skill_boundary_violation_rate: number;
    skill_transfer_success_rate: number;
    skill_set_change_rate: number;
    score_distribution: TrainingProgress['observability']['scoreDistribution'];
  }>;
}

export type TrainingRoundSnapshot = TrainingRunReport['rounds'][number];

export function buildTrainingRunReport(
  profile: TrainingProfile,
  history: TrainingProgress[],
  skillMetrics?: { originSkillsAdded: number; distilledSkillsAdded: number; skillCoverageScore: number }
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
    gap_focused_questions: item.observability.gapFocusedQuestions,
    total_questions: item.observability.totalQuestions,
    skill_trigger_precision: item.observability.skillTriggerPrecision,
    skill_method_adherence: item.observability.skillMethodAdherence,
    skill_boundary_violation_rate: item.observability.skillBoundaryViolationRate,
    skill_transfer_success_rate: item.observability.skillTransferSuccessRate,
    skill_set_change_rate: item.observability.skillSetChangeRate,
    score_distribution: item.observability.scoreDistribution,
  }));

  return buildTrainingRunReportFromRounds(profile, rounds, skillMetrics);
}

export function buildTrainingRunReportFromRounds(
  profile: TrainingProfile,
  rounds: TrainingRoundSnapshot[],
  skillMetrics?: { originSkillsAdded: number; distilledSkillsAdded: number; skillCoverageScore: number }
): TrainingRunReport {
  const normalizedRounds = [...rounds].sort((a, b) => a.round - b.round);

  const count = Math.max(1, normalizedRounds.length);
  const totalNodesWritten = normalizedRounds.reduce((sum, r) => sum + r.nodes_written, 0);
  const totalNodesReinforced = normalizedRounds.reduce((sum, r) => sum + r.nodes_reinforced, 0);
  const totalHighValueMemories = normalizedRounds.reduce((sum, r) => sum + r.new_high_value_memories, 0);
  const totalQuarantinedMemories = normalizedRounds.reduce((sum, r) => sum + r.quarantined_memories, 0);
  const totalGapFocusedQuestions = normalizedRounds.reduce((sum, r) => sum + (r.gap_focused_questions ?? 0), 0);
  const totalQuestions = normalizedRounds.reduce((sum, r) => sum + (r.total_questions ?? 0), 0);
  const avgSkillTriggerPrecision = normalizedRounds.reduce((sum, r) => sum + (r.skill_trigger_precision ?? 0), 0) / count;
  const avgSkillMethodAdherence = normalizedRounds.reduce((sum, r) => sum + (r.skill_method_adherence ?? 0), 0) / count;
  const avgSkillBoundaryViolationRate =
    normalizedRounds.reduce((sum, r) => sum + (r.skill_boundary_violation_rate ?? 0), 0) / count;
  const avgSkillTransferSuccessRate =
    normalizedRounds.reduce((sum, r) => sum + (r.skill_transfer_success_rate ?? 0), 0) / count;
  const avgSkillSetChangeRate = normalizedRounds.reduce((sum, r) => sum + (r.skill_set_change_rate ?? 0), 0) / count;

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
      origin_skills_added: skillMetrics?.originSkillsAdded ?? 0,
      distilled_skills_added: skillMetrics?.distilledSkillsAdded ?? 0,
      skill_coverage_score: skillMetrics?.skillCoverageScore ?? 0,
      gap_focused_questions_ratio: totalQuestions > 0 ? totalGapFocusedQuestions / totalQuestions : 0,
      skill_trigger_precision: avgSkillTriggerPrecision,
      skill_method_adherence: avgSkillMethodAdherence,
      skill_boundary_violation_rate: avgSkillBoundaryViolationRate,
      skill_transfer_success_rate: avgSkillTransferSuccessRate,
      skill_set_stability: 1 - Math.max(0, Math.min(1, avgSkillSetChangeRate)),
    },
    rounds: normalizedRounds,
  };
}

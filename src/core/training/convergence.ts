export interface ConvergenceState {
  round: number;
  nodesWrittenThisRound: number;
  overallConfidence: number;
  coverageScore: number;
  contradictionRate: number;
  newHighValueMemories: number;
  skillCoverageScore?: number;
  skillSetChangeRate?: number;
}

const CONVERGENCE_RULES = {
  /** Consecutive rounds with fewer than this many new nodes written */
  maxNewNodes: 3,
  consecutiveQuietRounds: 3,
  /** Minimum confidence before we can call it converged */
  minConfidence: 0.80,
  /** Minimum coverage before we can call it converged */
  minCoverage: 0.85,
  /** Contradiction signal must stay low */
  maxContradictionRate: 0.15,
  /** Recent trend in high-value memory growth should stabilize */
  maxRecentHighValueAvg: 1.5,
  /** Skill library should be stable before converge */
  maxSkillSetChangeRate: 0.2,
  minSkillCoverageScore: 0.75,
};

/**
 * Returns true if ALL convergence criteria are satisfied:
 * 1. Last 3 rounds each wrote fewer than 3 new nodes
 * 2. Overall confidence > 0.80
 * 3. Coverage score > 0.85
 * 4. Contradiction rate stays below threshold
 * 5. New high-value memories trend has stabilized
 */
export function checkConvergence(history: ConvergenceState[]): boolean {
  if (history.length < CONVERGENCE_RULES.consecutiveQuietRounds) return false;

  const latest = history[history.length - 1];

  // Check confidence and coverage thresholds
  if (latest.overallConfidence < CONVERGENCE_RULES.minConfidence) return false;
  if (latest.coverageScore < CONVERGENCE_RULES.minCoverage) return false;
  if (latest.contradictionRate > CONVERGENCE_RULES.maxContradictionRate) return false;
  if (
    typeof latest.skillCoverageScore === 'number' &&
    latest.skillCoverageScore < CONVERGENCE_RULES.minSkillCoverageScore
  ) return false;

  // Check that the last N rounds were all "quiet"
  const recentRounds = history.slice(-CONVERGENCE_RULES.consecutiveQuietRounds);
  const allQuiet = recentRounds.every(
    (r) => r.nodesWrittenThisRound < CONVERGENCE_RULES.maxNewNodes
  );
  const avgHighValue =
    recentRounds.reduce((sum, r) => sum + r.newHighValueMemories, 0) / recentRounds.length;
  const stableSkills = recentRounds.every(
    (r) => (r.skillSetChangeRate ?? 0) <= CONVERGENCE_RULES.maxSkillSetChangeRate
  );

  return allQuiet && avgHighValue <= CONVERGENCE_RULES.maxRecentHighValueAvg && stableSkills;
}

/** Returns a human-readable convergence status for display */
export function convergenceStatus(history: ConvergenceState[]): string {
  if (history.length === 0) return 'No rounds completed';

  const latest = history[history.length - 1];
  const issues: string[] = [];

  if (latest.overallConfidence < CONVERGENCE_RULES.minConfidence) {
    issues.push(
      `confidence ${(latest.overallConfidence * 100).toFixed(0)}% < ${CONVERGENCE_RULES.minConfidence * 100}%`
    );
  }
  if (latest.coverageScore < CONVERGENCE_RULES.minCoverage) {
    issues.push(
      `coverage ${(latest.coverageScore * 100).toFixed(0)}% < ${CONVERGENCE_RULES.minCoverage * 100}%`
    );
  }
  if (latest.contradictionRate > CONVERGENCE_RULES.maxContradictionRate) {
    issues.push(
      `contradiction rate ${(latest.contradictionRate * 100).toFixed(0)}% > ${CONVERGENCE_RULES.maxContradictionRate * 100}%`
    );
  }
  if (
    typeof latest.skillCoverageScore === 'number' &&
    latest.skillCoverageScore < CONVERGENCE_RULES.minSkillCoverageScore
  ) {
    issues.push(
      `skill coverage ${(latest.skillCoverageScore * 100).toFixed(0)}% < ${CONVERGENCE_RULES.minSkillCoverageScore * 100}%`
    );
  }

  if (history.length >= CONVERGENCE_RULES.consecutiveQuietRounds) {
    const recentRounds = history.slice(-CONVERGENCE_RULES.consecutiveQuietRounds);
    const allQuiet = recentRounds.every(
      (r) => r.nodesWrittenThisRound < CONVERGENCE_RULES.maxNewNodes
    );
    if (!allQuiet) {
      const avgNew =
        recentRounds.reduce((s, r) => s + r.nodesWrittenThisRound, 0) /
        recentRounds.length;
      issues.push(`still writing avg ${avgNew.toFixed(1)} nodes/round`);
    }
    const avgHighValue =
      recentRounds.reduce((sum, r) => sum + r.newHighValueMemories, 0) / recentRounds.length;
    if (avgHighValue > CONVERGENCE_RULES.maxRecentHighValueAvg) {
      issues.push(`high-value memory growth avg ${avgHighValue.toFixed(1)} still high`);
    }
    const unstable = recentRounds.some(
      (r) => (r.skillSetChangeRate ?? 0) > CONVERGENCE_RULES.maxSkillSetChangeRate
    );
    if (unstable) {
      issues.push('skill set still changing too fast');
    }
  } else {
    issues.push(
      `need ${CONVERGENCE_RULES.consecutiveQuietRounds - history.length} more rounds`
    );
  }

  if (issues.length === 0) return 'Converged';
  return `Not yet converged: ${issues.join(', ')}`;
}

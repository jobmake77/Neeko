export interface ConvergenceState {
  round: number;
  nodesWrittenThisRound: number;
  overallConfidence: number;
  coverageScore: number;
}

const CONVERGENCE_RULES = {
  /** Consecutive rounds with fewer than this many new nodes written */
  maxNewNodes: 3,
  consecutiveQuietRounds: 3,
  /** Minimum confidence before we can call it converged */
  minConfidence: 0.80,
  /** Minimum coverage before we can call it converged */
  minCoverage: 0.85,
};

/**
 * Returns true if ALL convergence criteria are satisfied:
 * 1. Last 3 rounds each wrote fewer than 3 new nodes
 * 2. Overall confidence > 0.80
 * 3. Coverage score > 0.85
 */
export function checkConvergence(history: ConvergenceState[]): boolean {
  if (history.length < CONVERGENCE_RULES.consecutiveQuietRounds) return false;

  const latest = history[history.length - 1];

  // Check confidence and coverage thresholds
  if (latest.overallConfidence < CONVERGENCE_RULES.minConfidence) return false;
  if (latest.coverageScore < CONVERGENCE_RULES.minCoverage) return false;

  // Check that the last N rounds were all "quiet"
  const recentRounds = history.slice(-CONVERGENCE_RULES.consecutiveQuietRounds);
  const allQuiet = recentRounds.every(
    (r) => r.nodesWrittenThisRound < CONVERGENCE_RULES.maxNewNodes
  );

  return allQuiet;
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
  } else {
    issues.push(
      `need ${CONVERGENCE_RULES.consecutiveQuietRounds - history.length} more rounds`
    );
  }

  if (issues.length === 0) return 'Converged';
  return `Not yet converged: ${issues.join(', ')}`;
}

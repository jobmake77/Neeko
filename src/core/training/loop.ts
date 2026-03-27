import { Soul } from '../models/soul.js';
import { MemoryNode, createMemoryNode } from '../models/memory.js';
import { Persona } from '../models/persona.js';
import { MemoryStore } from '../memory/store.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { PersonaAgent, TrainerAgent, EvaluatorAgent, DirectorAgent, Evaluation } from '../agents/index.js';
import { checkConvergence, ConvergenceState } from './convergence.js';
import { TrainingPolicy } from './policy.js';
import { GovernanceDecision, MemoryGovernance } from './governance.js';
import { RoundObservability, TrainingProfile } from './types.js';

export interface TrainingOptions {
  maxRounds?: number;
  questionsPerRound?: number;
  profile?: TrainingProfile;
  onProgress?: (progress: TrainingProgress) => void;
}

export interface TrainingProgress {
  round: number;
  maxRounds: number;
  nodesWritten: number;
  nodesReinforced: number;
  avgQualityScore: number;
  convergenceState: ConvergenceState;
  observability: RoundObservability;
  status: 'running' | 'converged' | 'max_rounds_reached';
}

/**
 * TrainingLoop — the core cultivation loop state machine.
 *
 * State transitions:
 *   IDLE → GENERATING_QUESTIONS → RUNNING_CONVERSATION → EVALUATING → UPDATING_SOUL → CONVERGENCE_CHECK
 *   ↑____________________________________________________|
 *   └─ (if not converged, loop back)
 */
export class TrainingLoop {
  private personaAgent: PersonaAgent;
  private trainerAgent: TrainerAgent;
  private evaluatorAgent: EvaluatorAgent;
  private directorAgent: DirectorAgent;
  private retriever: MemoryRetriever;
  private trainingPolicy: TrainingPolicy;
  private governance: MemoryGovernance;

  constructor(
    private soul: Soul,
    private readonly persona: Persona,
    private readonly store: MemoryStore
  ) {
    this.retriever = new MemoryRetriever(store);
    this.personaAgent = new PersonaAgent(soul, this.retriever, persona.memory_collection);
    this.trainerAgent = new TrainerAgent();
    this.evaluatorAgent = new EvaluatorAgent();
    this.directorAgent = new DirectorAgent();
    this.trainingPolicy = new TrainingPolicy();
    this.governance = new MemoryGovernance(this.retriever);
  }

  async run(options: TrainingOptions = {}): Promise<{ soul: Soul; totalRounds: number; history: TrainingProgress[] }> {
    const { maxRounds = 20, questionsPerRound = 5, profile = 'full', onProgress } = options;

    const convergenceHistory: ConvergenceState[] = [];
    const allPreviousQuestions: string[] = [];
    let previousRoundObservability: RoundObservability | undefined;
    const quarantineQueue: MemoryNode[] = [];
    const history: TrainingProgress[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      // ── Step 1: Generate questions ─────────────────────────────────────────
      const plan = this.trainingPolicy.buildQuestionPlan(
        this.soul,
        round,
        profile,
        questionsPerRound,
        previousRoundObservability
      );
      const questionSet = await this.trainerAgent.generateQuestions(
        this.soul,
        round,
        allPreviousQuestions,
        {
          strategyTargets: plan.strategyTargets,
          lowConfidenceDimensions: plan.lowConfidenceDimensions,
          previousRound: previousRoundObservability,
          questionsPerRound,
        }
      );
      allPreviousQuestions.push(...questionSet.map((q) => q.question));

      // ── Step 2: Run conversations + evaluate ───────────────────────────────
      const roundEvaluations: Evaluation[] = [];
      const dimensionCoverage = new Set<string>();
      let nodesWrittenThisRound = 0;
      let nodesReinforcedThisRound = 0;
      let duplicatesThisRound = 0;
      let contradictionsThisRound = 0;
      let highValueMemoriesThisRound = 0;
      let quarantinedThisRound = 0;
      const memoryGrowthByType = {
        semantic: 0,
        procedural: 0,
        episodic: 0,
        working: 0,
      };

      for (const qItem of questionSet) {
        dimensionCoverage.add(qItem.target_dimension);
        const response = await this.personaAgent.respond(qItem.question);
        const evaluation = await this.evaluatorAgent.evaluate(
          qItem.question,
          response,
          this.soul.target_name,
          qItem.strategy,
          {
            calibrationEnabled: profile !== 'baseline' && profile !== 'a1',
            dualReview: profile === 'a2' || profile === 'a3' || profile === 'a4' || profile === 'full',
            disagreementThreshold: 0.2,
          }
        );

        roundEvaluations.push(evaluation);

        // ── Step 3: Apply evaluation verdicts ──────────────────────────────
        if (evaluation.verdict === 'write') {
          for (const candidate of evaluation.new_memory_candidates) {
            const governanceEnabled = profile === 'a3' || profile === 'a4' || profile === 'full';
            const decision: GovernanceDecision = governanceEnabled
              ? await this.governance.reviewCandidate(this.persona.memory_collection, candidate)
              : {
                action: candidate.confidence >= 0.4 ? 'write' : 'discard',
                reason: 'baseline threshold routing',
                highValue: candidate.confidence >= 0.7,
              };

            if (decision.action === 'discard') continue;
            if (decision.action === 'reinforce') {
              if (decision.duplicateNodeId) {
                await this.store.updateReinforcement(
                  this.persona.memory_collection,
                  decision.duplicateNodeId,
                  1
                );
                nodesReinforcedThisRound++;
              }
              duplicatesThisRound++;
              continue;
            }
            if (decision.action === 'quarantine') {
              const queuedNode = createMemoryNode({
                persona_id: this.persona.id,
                original_text: response.slice(0, 2000),
                summary: candidate.summary,
                category: candidate.category,
                soul_dimension: candidate.soul_dimension,
                source_chunk_id: crypto.randomUUID(),
                source_type: 'custom',
                confidence: candidate.confidence,
                semantic_tags: [qItem.strategy, qItem.target_dimension, 'quarantine'],
              });
              quarantineQueue.push(queuedNode);
              quarantinedThisRound++;
              contradictionsThisRound++;
              continue;
            }

            const node = createMemoryNode({
              persona_id: this.persona.id,
              original_text: response.slice(0, 2000),
              summary: candidate.summary,
              category: candidate.category,
              soul_dimension: candidate.soul_dimension,
              source_chunk_id: crypto.randomUUID(), // synthetic — from training
              source_type: 'custom',
              confidence: candidate.confidence,
              semantic_tags: [qItem.strategy, qItem.target_dimension],
            });

            await this.store.upsert(this.persona.memory_collection, node);
            nodesWrittenThisRound++;
            if (decision.highValue) highValueMemoriesThisRound++;
            memoryGrowthByType.semantic++;
          }
        } else if (evaluation.verdict === 'reinforce') {
          // Find relevant existing nodes and boost their reinforcement count
          const related = await this.retriever.retrieve(
            this.persona.memory_collection,
            qItem.question,
            { limit: 3, minConfidence: 0.4 }
          );
          for (const node of related) {
            await this.store.updateReinforcement(this.persona.memory_collection, node.id, 1);
          }
          nodesReinforcedThisRound++;
        } else if (evaluation.verdict === 'flag_contradiction') {
          contradictionsThisRound++;
        }
        // 'discard' and 'flag_contradiction' → no action (contradiction flagging could be extended)
      }

      // ── Step 4: Director review ─────────────────────────────────────────────
      const avgQuality =
        roundEvaluations.reduce((s, e) => s + e.overall_score, 0) / roundEvaluations.length;
      const lowConfidenceCoverage = plan.lowConfidenceDimensions.length === 0
        ? 1
        : plan.lowConfidenceDimensions.filter((d) => dimensionCoverage.has(d)).length /
          plan.lowConfidenceDimensions.length;

      const observability = this.buildObservability({
        round,
        evaluations: roundEvaluations,
        lowConfidenceCoverage,
        contradictionsThisRound,
        duplicatesThisRound,
        highValueMemoriesThisRound,
        quarantinedThisRound,
        memoryGrowthByType,
      });

      const directorDecision = await this.directorAgent.review(this.soul, {
        round,
        questions_asked: questionSet.length,
        nodes_written: nodesWrittenThisRound,
        nodes_reinforced: nodesReinforcedThisRound,
        avg_quality_score: avgQuality,
        evaluations: roundEvaluations,
        observability,
      });

      // Apply director's soul updates
      if (directorDecision.soul_updates.problem_solving_approach) {
        this.soul.thinking_patterns.problem_solving_approach =
          directorDecision.soul_updates.problem_solving_approach;
      }
      if (directorDecision.soul_updates.new_blind_spots) {
        this.soul.knowledge_domains.blind_spots.push(
          ...directorDecision.soul_updates.new_blind_spots
        );
      }
      this.soul.coverage_score = directorDecision.coverage_score;
      this.soul.training_rounds_completed = round;

      // ── Step 5: Convergence check ────────────────────────────────────────────
      const convergenceState: ConvergenceState = {
        round,
        nodesWrittenThisRound,
        overallConfidence: this.soul.overall_confidence,
        coverageScore: this.soul.coverage_score,
        contradictionRate: observability.contradictionRate,
        newHighValueMemories: observability.newHighValueMemories,
      };
      convergenceHistory.push(convergenceState);
      previousRoundObservability = observability;

      const progress: TrainingProgress = {
        round,
        maxRounds,
        nodesWritten: nodesWrittenThisRound,
        nodesReinforced: nodesReinforcedThisRound,
        avgQualityScore: avgQuality,
        convergenceState,
        observability,
        status: 'running',
      };

      const converged = checkConvergence(convergenceHistory);
      if (converged || !directorDecision.should_continue) {
        progress.status = 'converged';
        onProgress?.(progress);
        history.push(progress);
        break;
      }

      if (round === maxRounds) {
        progress.status = 'max_rounds_reached';
      }

      onProgress?.(progress);
      history.push(progress);
    }

    return { soul: this.soul, totalRounds: this.soul.training_rounds_completed, history };
  }

  private buildObservability(input: {
    round: number;
    evaluations: Evaluation[];
    lowConfidenceCoverage: number;
    contradictionsThisRound: number;
    duplicatesThisRound: number;
    highValueMemoriesThisRound: number;
    quarantinedThisRound: number;
    memoryGrowthByType: {
      semantic: number;
      procedural: number;
      episodic: number;
      working: number;
    };
  }): RoundObservability {
    const scores = input.evaluations.map((e) => e.overall_score).sort((a, b) => a - b);
    const byIndex = (p: number) => {
      if (scores.length === 0) return 0;
      return scores[Math.min(scores.length - 1, Math.floor((scores.length - 1) * p))];
    };
    const denominator = Math.max(1, input.evaluations.length);
    const writes = input.evaluations.filter((e) => e.verdict === 'write').length;
    return {
      round: input.round,
      scoreDistribution: {
        min: scores[0] ?? 0,
        max: scores[scores.length - 1] ?? 0,
        p50: byIndex(0.5),
        p90: byIndex(0.9),
      },
      lowConfidenceCoverage: input.lowConfidenceCoverage,
      contradictionRate: input.contradictionsThisRound / denominator,
      duplicationRate: input.duplicatesThisRound / Math.max(1, writes),
      newHighValueMemories: input.highValueMemoriesThisRound,
      quarantinedMemories: input.quarantinedThisRound,
      memoryGrowthByType: input.memoryGrowthByType,
    };
  }
}

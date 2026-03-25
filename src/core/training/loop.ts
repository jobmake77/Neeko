import { Soul } from '../models/soul.js';
import { MemoryNode, createMemoryNode } from '../models/memory.js';
import { Persona } from '../models/persona.js';
import { MemoryStore } from '../memory/store.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { PersonaAgent, TrainerAgent, EvaluatorAgent, DirectorAgent, Evaluation } from '../agents/index.js';
import { checkConvergence, ConvergenceState } from './convergence.js';

export interface TrainingOptions {
  maxRounds?: number;
  questionsPerRound?: number;
  onProgress?: (progress: TrainingProgress) => void;
}

export interface TrainingProgress {
  round: number;
  maxRounds: number;
  nodesWritten: number;
  nodesReinforced: number;
  avgQualityScore: number;
  convergenceState: ConvergenceState;
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
  }

  async run(options: TrainingOptions = {}): Promise<{ soul: Soul; totalRounds: number }> {
    const { maxRounds = 20, questionsPerRound = 5, onProgress } = options;

    const convergenceHistory: ConvergenceState[] = [];
    const allPreviousQuestions: string[] = [];
    let totalNodesWritten = 0;

    for (let round = 1; round <= maxRounds; round++) {
      // ── Step 1: Generate questions ─────────────────────────────────────────
      const questionSet = await this.trainerAgent.generateQuestions(
        this.soul,
        round,
        allPreviousQuestions
      );
      allPreviousQuestions.push(...questionSet.map((q) => q.question));

      // ── Step 2: Run conversations + evaluate ───────────────────────────────
      const roundEvaluations: Evaluation[] = [];
      let nodesWrittenThisRound = 0;
      let nodesReinforcedThisRound = 0;

      for (const qItem of questionSet) {
        const response = await this.personaAgent.respond(qItem.question);
        const evaluation = await this.evaluatorAgent.evaluate(
          qItem.question,
          response,
          this.soul.target_name,
          qItem.strategy
        );

        roundEvaluations.push(evaluation);

        // ── Step 3: Apply evaluation verdicts ──────────────────────────────
        if (evaluation.verdict === 'write') {
          for (const candidate of evaluation.new_memory_candidates) {
            if (candidate.confidence < 0.4) continue; // skip low-confidence

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
            totalNodesWritten++;
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
        }
        // 'discard' and 'flag_contradiction' → no action (contradiction flagging could be extended)
      }

      // ── Step 4: Director review ─────────────────────────────────────────────
      const avgQuality =
        roundEvaluations.reduce((s, e) => s + e.overall_score, 0) / roundEvaluations.length;

      const directorDecision = await this.directorAgent.review(this.soul, {
        round,
        questions_asked: questionSet.length,
        nodes_written: nodesWrittenThisRound,
        nodes_reinforced: nodesReinforcedThisRound,
        avg_quality_score: avgQuality,
        evaluations: roundEvaluations,
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
      };
      convergenceHistory.push(convergenceState);

      const progress: TrainingProgress = {
        round,
        maxRounds,
        nodesWritten: nodesWrittenThisRound,
        nodesReinforced: nodesReinforcedThisRound,
        avgQualityScore: avgQuality,
        convergenceState,
        status: 'running',
      };

      const converged = checkConvergence(convergenceHistory);
      if (converged || !directorDecision.should_continue) {
        progress.status = 'converged';
        onProgress?.(progress);
        break;
      }

      if (round === maxRounds) {
        progress.status = 'max_rounds_reached';
      }

      onProgress?.(progress);
    }

    return { soul: this.soul, totalRounds: this.soul.training_rounds_completed };
  }
}

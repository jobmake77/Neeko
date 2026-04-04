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
import { settings } from '../../config/settings.js';
import { computeCoverageByOrigin, loadSkillLibrary } from '../skills/library.js';
import { PersonaSkillLibrary } from '../skills/types.js';
import {
  mergeTrainingRuntimeConfig,
  TrainingRuntimeConfig,
  TrainingRuntimeOverrides,
  TrainingRuntimePreset,
} from './runtime-tuning.js';

export interface TrainingOptions {
  maxRounds?: number;
  questionsPerRound?: number;
  profile?: TrainingProfile;
  runtimePreset?: TrainingRuntimePreset;
  runtimeOverrides?: TrainingRuntimeOverrides;
  evaluatorLayered?: boolean;
  evaluatorDualReview?: boolean;
  directorReviewInterval?: number;
  directorAlwaysOnFinalRound?: boolean;
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
  runtime: {
    trainerMs: number;
    dialogueEvalMs: number;
    directorMs: number;
    totalRoundMs: number;
    directorDecisionSource: 'llm' | 'fallback' | 'heuristic_skip';
  };
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
  private skillLibrary: PersonaSkillLibrary | null;

  constructor(
    private soul: Soul,
    private readonly persona: Persona,
    private readonly store: MemoryStore
  ) {
    this.skillLibrary = this.loadSkills();
    this.retriever = new MemoryRetriever(store);
    this.personaAgent = new PersonaAgent(soul, this.retriever, persona.memory_collection, this.skillLibrary);
    this.trainerAgent = new TrainerAgent();
    this.evaluatorAgent = new EvaluatorAgent();
    this.directorAgent = new DirectorAgent();
    this.trainingPolicy = new TrainingPolicy();
    this.governance = new MemoryGovernance(this.retriever);
  }

  async run(options: TrainingOptions = {}): Promise<{ soul: Soul; totalRounds: number; history: TrainingProgress[] }> {
    const {
      maxRounds = 20,
      questionsPerRound = 5,
      profile = 'full',
      runtimePreset = 'balanced',
      runtimeOverrides,
      evaluatorLayered,
      evaluatorDualReview,
      directorReviewInterval = 1,
      directorAlwaysOnFinalRound = true,
      onProgress,
    } = options;
    const runtime = mergeTrainingRuntimeConfig(runtimePreset, runtimeOverrides);

    const convergenceHistory: ConvergenceState[] = [];
    const allPreviousQuestions: string[] = [];
    let previousRoundObservability: RoundObservability | undefined;
    const quarantineQueue: MemoryNode[] = [];
    const history: TrainingProgress[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      const roundStartedAt = Date.now();

      // ── Step 1: Generate questions ─────────────────────────────────────────
      const trainerStartedAt = Date.now();
      const gapHints = this.skillGapHints();
      const gapPressure = this.skillGapPressure();
      const plan = this.trainingPolicy.buildQuestionPlan(
        this.soul,
        round,
        profile,
        questionsPerRound,
        previousRoundObservability,
        gapPressure
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
          skillHints: this.skillHints(),
          skillGapHints: gapHints,
          timeoutMs: runtime.trainerTimeoutMs,
          retries: runtime.trainerRetries,
          compactPrompt: runtime.trainerCompactPrompt,
        }
      );
      allPreviousQuestions.push(...questionSet.map((q) => q.question));
      const gapFocusedQuestions = this.countGapFocusedQuestions(
        questionSet.map((q) => q.question),
        gapHints
      );
      const trainerMs = Date.now() - trainerStartedAt;

      // ── Step 2: Run conversations + evaluate ───────────────────────────────
      const dialogueEvalStartedAt = Date.now();
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
        const trainingResponse = await this.personaAgent.respond(qItem.question, [], {
          maxTokens: runtime.personaMaxTokens,
          timeoutMs: runtime.personaTimeoutMs,
          retries: runtime.personaRetries,
          compactPrompt: runtime.personaCompactPrompt,
          memoryLimit: runtime.personaMemoryLimit,
          memoryMaxChars: runtime.personaMemoryMaxChars,
        });
        const evaluation = await this.evaluatorAgent.evaluate(
          qItem.question,
          trainingResponse,
          this.soul.target_name,
          qItem.strategy,
          {
            calibrationEnabled: profile !== 'baseline' && profile !== 'a1',
            dualReview:
              evaluatorDualReview ??
              (profile === 'a2' || profile === 'a3' || profile === 'a4' || profile === 'full'),
            disagreementThreshold: 0.2,
            timeoutMs: runtime.evaluatorTimeoutMs,
            retries: runtime.evaluatorRetries,
            maxResponseChars: runtime.evaluatorMaxResponseChars,
            compactPrompt: runtime.evaluatorCompactPrompt,
            layeredMode: evaluatorLayered ?? runtime.evaluatorLayered,
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
                original_text: trainingResponse.slice(0, 2000),
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
              original_text: trainingResponse.slice(0, 2000),
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
      const dialogueEvalMs = Date.now() - dialogueEvalStartedAt;

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
        gapFocusedQuestions,
        totalQuestions: questionSet.length,
        previousRound: previousRoundObservability,
      });

      const directorStartedAt = Date.now();
      const shouldRunDirectorModel = this.shouldRunDirectorReview({
        round,
        maxRounds,
        interval: directorReviewInterval,
        alwaysOnFinalRound: directorAlwaysOnFinalRound,
      });
      const directorDecision = await this.directorAgent.review(this.soul, {
        round,
        questions_asked: questionSet.length,
        nodes_written: nodesWrittenThisRound,
        nodes_reinforced: nodesReinforcedThisRound,
        avg_quality_score: avgQuality,
        evaluations: roundEvaluations,
        observability,
      }, {
        timeoutMs: runtime.directorTimeoutMs,
        retries: runtime.directorRetries,
        compactPrompt: runtime.directorCompactPrompt,
        skipModel: !shouldRunDirectorModel,
      });
      const directorMs = Date.now() - directorStartedAt;

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
        skillCoverageScore: this.skillCoverageScore(),
        skillSetChangeRate: observability.skillSetChangeRate,
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
        runtime: {
          trainerMs,
          dialogueEvalMs,
          directorMs,
          totalRoundMs: Date.now() - roundStartedAt,
          directorDecisionSource: directorDecision.decision_source,
        },
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

  private shouldRunDirectorReview(input: {
    round: number;
    maxRounds: number;
    interval: number;
    alwaysOnFinalRound: boolean;
  }): boolean {
    const safeInterval = Math.max(1, input.interval);
    if (input.alwaysOnFinalRound && input.round === input.maxRounds) return true;
    return input.round % safeInterval === 0;
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
    gapFocusedQuestions: number;
    totalQuestions: number;
    previousRound?: RoundObservability;
  }): RoundObservability {
    const scores = input.evaluations.map((e) => e.overall_score).sort((a, b) => a - b);
    const byIndex = (p: number) => {
      if (scores.length === 0) return 0;
      return scores[Math.min(scores.length - 1, Math.floor((scores.length - 1) * p))];
    };
    const denominator = Math.max(1, input.evaluations.length);
    const writes = input.evaluations.filter((e) => e.verdict === 'write').length;
    const reinforces = input.evaluations.filter((e) => e.verdict === 'reinforce').length;
    const avgDepth = input.evaluations.reduce((sum, e) => sum + e.depth_score, 0) / denominator;
    const avgConsistency = input.evaluations.reduce((sum, e) => sum + e.consistency_score, 0) / denominator;
    const skillTriggerPrecision = input.gapFocusedQuestions / Math.max(1, input.totalQuestions);
    const skillMethodAdherence = (avgDepth * 0.6) + (avgConsistency * 0.4);
    const skillBoundaryViolationRate = input.contradictionsThisRound / denominator;
    const skillTransferSuccessRate = (writes + reinforces) / denominator;
    const prevMethod = input.previousRound?.skillMethodAdherence ?? skillMethodAdherence;
    const prevTrigger = input.previousRound?.skillTriggerPrecision ?? skillTriggerPrecision;
    const skillSetChangeRate = Math.max(
      Math.abs(skillMethodAdherence - prevMethod),
      Math.abs(skillTriggerPrecision - prevTrigger)
    );
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
      gapFocusedQuestions: input.gapFocusedQuestions,
      totalQuestions: input.totalQuestions,
      skillTriggerPrecision,
      skillMethodAdherence,
      skillBoundaryViolationRate,
      skillTransferSuccessRate,
      skillSetChangeRate,
    };
  }

  private loadSkills(): PersonaSkillLibrary | null {
    try {
      const dir = settings.getPersonaDir(this.persona.slug);
      return loadSkillLibrary(dir, this.persona.slug);
    } catch {
      return null;
    }
  }

  private skillHints(): string[] {
    if (!this.skillLibrary) return [];
    const coverage = computeCoverageByOrigin(this.skillLibrary);
    const gapOrigins = coverage
      .filter((item) => item.missing_slots > 0)
      .slice(0, 6)
      .map((item) => {
        const origin = this.skillLibrary?.origin_skills.find((s) => s.id === item.origin_id);
        return origin
          ? `[GAP:${item.missing_slots}] ${origin.name}: ${origin.how}`
          : `[GAP:${item.missing_slots}] ${item.origin_name}`;
      });
    const origins = this.skillLibrary.origin_skills.map((s) => `${s.name}: ${s.how}`).slice(0, 8);
    const distilled = this.skillLibrary.distilled_skills
      .map((s) => `${s.name}: ${s.central_thesis}; how=${s.how_steps.slice(0, 2).join(' -> ')}`)
      .slice(0, 8);
    return [...gapOrigins, ...origins, ...distilled];
  }

  private skillGapHints(): string[] {
    if (!this.skillLibrary) return [];
    return computeCoverageByOrigin(this.skillLibrary)
      .filter((item) => item.missing_slots > 0)
      .slice(0, 6)
      .map((item) => {
        const origin = this.skillLibrary?.origin_skills.find((s) => s.id === item.origin_id);
        const linked = this.skillLibrary?.distilled_skills.find((s) => s.source_origin_ids.includes(item.origin_id));
        const how = origin?.how ?? '';
        const boundaries = linked?.boundaries.slice(0, 1).join('; ') ?? '';
        return `${item.origin_name} (missing ${item.missing_slots}/1)${how ? ` -> ${how}` : ''}${boundaries ? ` | boundary: ${boundaries}` : ''}`;
      });
  }

  private skillGapPressure(): number {
    if (!this.skillLibrary) return 0;
    const coverage = computeCoverageByOrigin(this.skillLibrary);
    if (coverage.length === 0) return 0;
    const focused = coverage.slice(0, Math.min(4, coverage.length));
    const avgMissingRatio =
      focused.reduce((sum, item) => sum + item.missing_slots / 1, 0) / focused.length;
    return Math.max(0, Math.min(1, avgMissingRatio));
  }

  private countGapFocusedQuestions(questions: string[], gapHints: string[]): number {
    if (questions.length === 0 || gapHints.length === 0) return 0;
    const keys = gapHints
      .map((hint) => hint.split('(')[0].trim().toLowerCase())
      .filter(Boolean);
    let hit = 0;
    for (const q of questions) {
      const lower = q.toLowerCase();
      if (keys.some((k) => k && lower.includes(k))) hit++;
    }
    return hit;
  }

  private skillCoverageScore(): number {
    if (!this.skillLibrary || this.skillLibrary.origin_skills.length === 0) return 0;
    const coverage = computeCoverageByOrigin(this.skillLibrary);
    if (coverage.length === 0) return 0;
    return coverage.reduce((sum, item) => sum + item.coverage_score, 0) / coverage.length;
  }
}

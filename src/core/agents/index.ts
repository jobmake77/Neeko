import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { Soul } from '../models/soul.js';
import { resolveModel } from '../../config/model.js';
import { SoulRenderer } from '../soul/renderer.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { MemoryNode } from '../models/memory.js';
import { CALIBRATION_SET, EVALUATION_RUBRIC } from '../training/evaluation.js';
import { PersonaSkillLibrary } from '../skills/types.js';
import { selectTriggeredSkillsForQuery, TriggeredSkillMatch } from '../skills/library.js';
import {
  QuestionStrategy,
  RoundObservability,
  TargetDimension,
  TrainingQuestion,
} from '../training/types.js';

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; timeoutMs?: number; label: string }
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 1);
  const timeoutMs = options.timeoutMs ?? 45_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, options.label);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ─── Persona Agent ────────────────────────────────────────────────────────────
// Plays the role of the target person using Soul+Memory RAG

export class PersonaAgent {
  private renderer = new SoulRenderer();
  // Use cheaper model for persona conversations
  private model = resolveModel();

  constructor(
    private readonly soul: Soul,
    private readonly retriever: MemoryRetriever,
    private readonly collection: string,
    private readonly skillLibrary: PersonaSkillLibrary | null = null
  ) {}

  async respond(
    userMessage: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    options: {
      maxTokens?: number;
      timeoutMs?: number;
      retries?: number;
    } = {}
  ): Promise<string> {
    const result = await this.respondWithMeta(userMessage, conversationHistory, options);
    return result.text;
  }

  async respondWithMeta(
    userMessage: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    options: {
      maxTokens?: number;
      timeoutMs?: number;
      retries?: number;
    } = {}
  ): Promise<{ text: string; triggeredSkills: TriggeredSkillMatch[]; normalizedQuery: string }> {
    const skillSelection = selectTriggeredSkillsForQuery(this.skillLibrary, userMessage, 2);
    const query = skillSelection.cleanQuery;

    // RAG: retrieve relevant memories
    const memories = await this.retriever.retrieve(this.collection, query, {
      limit: 8,
      minConfidence: 0.35,
    });

    const memoryContext = this.retriever.formatContext(memories);
    const skillContext = skillSelection.context;
    const systemPrompt = this.renderer.render(this.soul) +
      (memoryContext ? `\n\n${memoryContext}` : '') +
      (skillContext ? `\n\n${skillContext}` : '');

    try {
      const { text } = await withRetry(
        () =>
          generateText({
            model: this.model,
            system: systemPrompt,
            messages: [
              ...conversationHistory,
              { role: 'user', content: query },
            ],
            maxTokens: options.maxTokens ?? 1024,
            temperature: 0.7,
          }),
        { label: 'persona respond', timeoutMs: options.timeoutMs ?? 45_000, retries: options.retries ?? 1 }
      );

      return {
        text,
        triggeredSkills: skillSelection.triggered,
        normalizedQuery: query,
      };
    } catch (error) {
      console.warn(`[PersonaAgent] fallback enabled: ${String(error)}`);
      return {
        text: this.fallbackResponse(query, memories),
        triggeredSkills: skillSelection.triggered,
        normalizedQuery: query,
      };
    }
  }

  private fallbackResponse(query: string, memories: MemoryNode[]): string {
    const expertise = this.soul.knowledge_domains.expert[0] || this.soul.knowledge_domains.familiar[0] || 'the topic';
    const belief = this.soul.values.core_beliefs[0]?.belief || '';
    const reasoning = this.soul.thinking_patterns.problem_solving_approach || 'I break problems into first principles and practical tradeoffs.';
    const memorySummary = memories.slice(0, 2).map((m) => m.summary).filter(Boolean).join(' ');
    const sentences = [
      `My instinct on ${expertise} is to stay concrete and focus on what actually compounds.`,
      belief ? `A principle I keep coming back to is ${belief}.` : reasoning,
      memorySummary || `For "${query}", I would start with the key constraint, choose the highest-leverage action, and then iterate quickly from feedback.`,
    ];
    return sentences.join(' ');
  }
}

// ─── Trainer Agent ────────────────────────────────────────────────────────────
// Generates diverse questions to drive the cultivation loop

const QuestionSetSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    strategy: z.enum(['blind_spot', 'stress_test', 'consistency', 'scenario']) as z.ZodType<QuestionStrategy>,
    target_dimension: z.enum([
      'language_style', 'values', 'thinking_patterns',
      'behavioral_traits', 'knowledge_domains', 'general',
    ]) as z.ZodType<TargetDimension>,
    expected_challenge_level: z.enum(['easy', 'medium', 'hard']),
  })),
});

export class TrainerAgent {
  private model = resolveModel();

  async generateQuestions(
    soul: Soul,
    round: number,
    previousQuestions: string[] = [],
    options: {
      strategyTargets?: Array<{ strategy: QuestionStrategy; count: number }>;
      lowConfidenceDimensions?: TargetDimension[];
      previousRound?: RoundObservability;
      questionsPerRound?: number;
      skillHints?: string[];
      skillGapHints?: string[];
    } = {}
  ): Promise<TrainingQuestion[]> {
    const strategyTargets = options.strategyTargets ?? [
      { strategy: 'consistency', count: 1 },
      { strategy: 'scenario', count: 2 },
      { strategy: 'stress_test', count: 1 },
      { strategy: 'blind_spot', count: 1 },
    ];
    const lowConfidence = options.lowConfidenceDimensions ?? this.lowConfidenceDimensions(soul);
    const questionCount = options.questionsPerRound ?? 5;
    const skillHints = options.skillHints ?? [];
    const skillGapHints = options.skillGapHints ?? [];
    const constraints = strategyTargets
      .map((s) => `${s.strategy}: ${s.count}`)
      .join(', ');

    try {
      const { object } = await withRetry(
        () =>
          generateObject({
            model: this.model,
            schema: QuestionSetSchema,
            prompt: `You are designing training questions to evaluate and improve a Persona Agent simulating "${soul.target_name}".

Round: ${round}
Dimensions with low confidence: ${lowConfidence.join(', ') || 'none'}
Previously used questions (avoid repeating): ${previousQuestions.slice(-10).join(' | ') || 'none'}
Previous round contradiction rate: ${options.previousRound?.contradictionRate.toFixed(2) ?? 'n/a'}
Previous round low-confidence coverage: ${options.previousRound?.lowConfidenceCoverage.toFixed(2) ?? 'n/a'}
Priority skill gaps (must prioritize if relevant): ${skillGapHints.slice(0, 8).join(' | ') || 'none'}
Skill hints (prefer covering these, if relevant): ${skillHints.slice(0, 12).join(' | ') || 'none'}

Use curriculum constraints:
- Required strategy mix: ${constraints}
- Total questions: ${questionCount}

Question strategy definitions:
1. **blind_spot**: Questions about topics they might avoid or lack expertise in (expose gaps)
2. **stress_test**: Challenging scenarios that test consistency under pressure
3. **consistency**: Questions that should have predictable answers based on known beliefs
4. **scenario**: Practical problem-solving in their domain of expertise

Return exactly ${questionCount} questions spanning different target dimensions, with strict strategy counts.`,
          }),
        { label: 'trainer generate questions', timeoutMs: 45_000, retries: 1 }
      );
      return object.questions;
    } catch (error) {
      console.warn(`[TrainerAgent] schema fallback enabled: ${String(error)}`);
      return this.fallbackQuestions(soul, strategyTargets, lowConfidence, questionCount, skillGapHints);
    }
  }

  private lowConfidenceDimensions(soul: Soul): TargetDimension[] {
    const dims: TargetDimension[] = [];
    if (soul.language_style.vocabulary_preferences.length < 5) dims.push('language_style');
    if (soul.values.core_beliefs.length < 3) dims.push('values');
    if (soul.thinking_patterns.reasoning_style.length < 2) dims.push('thinking_patterns');
    if (soul.behavioral_traits.signature_behaviors.length < 2) dims.push('behavioral_traits');
    if (soul.knowledge_domains.expert.length === 0) dims.push('knowledge_domains');
    return dims;
  }

  private fallbackQuestions(
    soul: Soul,
    strategyTargets: Array<{ strategy: QuestionStrategy; count: number }>,
    lowConfidence: TargetDimension[],
    questionCount: number,
    skillGapHints: string[]
  ): TrainingQuestion[] {
    const dimensions: TargetDimension[] = lowConfidence.length > 0
      ? lowConfidence
      : ['thinking_patterns', 'values', 'knowledge_domains', 'behavioral_traits', 'language_style'];
    const gaps = skillGapHints.length > 0 ? skillGapHints : ['核心方法论', '边界条件', '失败复盘'];
    const out: TrainingQuestion[] = [];
    for (const target of strategyTargets) {
      for (let i = 0; i < target.count; i++) {
        const dim = dimensions[(out.length + i) % dimensions.length] ?? 'general';
        const gap = gaps[(out.length + i) % gaps.length] ?? '关键能力';
        out.push({
          strategy: target.strategy,
          target_dimension: dim,
          expected_challenge_level: target.strategy === 'consistency' ? 'easy' : target.strategy === 'scenario' ? 'medium' : 'hard',
          question: `围绕${soul.target_name}在「${gap}」上的做法，请给出可执行步骤，并说明适用边界与反例。`,
        });
      }
    }
    return out.slice(0, questionCount);
  }
}

// ─── Evaluator Agent ─────────────────────────────────────────────────────────
// Independent judge — does NOT see the Soul, scores from user perspective

const EvaluationSchema = z.object({
  consistency_score: z.number().min(0).max(1),
  authenticity_score: z.number().min(0).max(1),
  depth_score: z.number().min(0).max(1),
  overall_score: z.number().min(0).max(1),
  verdict: z.enum(['write', 'reinforce', 'discard', 'flag_contradiction']),
  insights: z.array(z.string()),
  new_memory_candidates: z.array(z.object({
    summary: z.string(),
    category: z.enum(['belief', 'value', 'fact', 'opinion', 'behavior', 'knowledge', 'preference', 'experience']),
    soul_dimension: z.enum(['language_style', 'values', 'thinking_patterns', 'behavioral_traits', 'knowledge_domains', 'general']),
    confidence: z.number().min(0).max(1),
  })),
});

export type Evaluation = z.infer<typeof EvaluationSchema>;

export class EvaluatorAgent {
  // High quality model for evaluation — accuracy over cost
  private model = resolveModel();

  async evaluate(
    question: string,
    response: string,
    personaName: string,
    strategy: string,
    options: {
      calibrationEnabled?: boolean;
      dualReview?: boolean;
      disagreementThreshold?: number;
      timeoutMs?: number;
      retries?: number;
      maxResponseChars?: number;
    } = {}
  ): Promise<Evaluation> {
    const primary = await this.runSingleEvaluation(question, response, personaName, strategy, {
      calibrationEnabled: options.calibrationEnabled ?? true,
      reviewerRole: 'primary',
      timeoutMs: options.timeoutMs ?? 45_000,
      retries: options.retries ?? 1,
      maxResponseChars: options.maxResponseChars ?? 1200,
    });

    const dualReview = options.dualReview ?? false;
    if (!dualReview) return primary;

    const secondary = await this.runSingleEvaluation(question, response, personaName, strategy, {
      calibrationEnabled: options.calibrationEnabled ?? true,
      reviewerRole: 'secondary',
      timeoutMs: options.timeoutMs ?? 45_000,
      retries: options.retries ?? 1,
      maxResponseChars: options.maxResponseChars ?? 1200,
    });

    const threshold = options.disagreementThreshold ?? 0.2;
    const disagree =
      primary.verdict !== secondary.verdict ||
      Math.abs(primary.overall_score - secondary.overall_score) >= threshold;

    if (!disagree) return primary;

    return {
      consistency_score: (primary.consistency_score + secondary.consistency_score) / 2,
      authenticity_score: (primary.authenticity_score + secondary.authenticity_score) / 2,
      depth_score: (primary.depth_score + secondary.depth_score) / 2,
      overall_score: (primary.overall_score + secondary.overall_score) / 2,
      verdict: primary.overall_score >= secondary.overall_score ? primary.verdict : secondary.verdict,
      insights: Array.from(new Set([...primary.insights, ...secondary.insights])).slice(0, 8),
      new_memory_candidates: primary.new_memory_candidates.length >= secondary.new_memory_candidates.length
        ? primary.new_memory_candidates
        : secondary.new_memory_candidates,
    };
  }

  private async runSingleEvaluation(
    question: string,
    response: string,
    personaName: string,
    strategy: string,
    options: {
      calibrationEnabled: boolean;
      reviewerRole: 'primary' | 'secondary';
      timeoutMs: number;
      retries: number;
      maxResponseChars: number;
    }
  ): Promise<Evaluation> {
    const calibrationContext = options.calibrationEnabled
      ? CALIBRATION_SET.map((c, idx) =>
        `Example ${idx + 1}\nQ: ${c.question}\nA: ${c.response}\nExpected: consistency=${c.expected.consistency}, authenticity=${c.expected.authenticity}, depth=${c.expected.depth}, verdict=${c.expected.verdict}`
      ).join('\n\n')
      : 'Calibration examples disabled.';

    const responseSnippet = response.slice(0, options.maxResponseChars);

    try {
      const { object } = await withRetry(
        () =>
          generateObject({
            model: this.model,
            schema: EvaluationSchema,
            temperature: 0,
            prompt: `You are an independent quality evaluator for a persona simulation of "${personaName}".
You do NOT have access to their internal Soul configuration — evaluate purely based on response quality.
Reviewer role: ${options.reviewerRole}

${EVALUATION_RUBRIC}

Calibration examples:
${calibrationContext}

Question asked (strategy: ${strategy}):
"${question}"

Persona's response:
"${responseSnippet}"

Evaluate:
1. consistency_score: Does this feel consistent with prior statements about ${personaName}? (0=contradicts known info, 1=perfectly consistent)
2. authenticity_score: Does this sound like how ${personaName} genuinely speaks/thinks? (0=generic AI, 1=distinctly authentic)
3. depth_score: Is the response substantive and insightful vs shallow? (0=surface, 1=deep)
4. overall_score: Weighted average

Verdict:
- "write": New valuable information — create a new memory node
- "reinforce": Confirms existing knowledge — strengthen existing nodes
- "discard": Generic/unhelpful response — nothing to extract
- "flag_contradiction": Response contradicts known ${personaName} positions

Extract any new memory candidates (insights about their beliefs, style, knowledge).`,
          }),
        { label: 'evaluator score response', timeoutMs: options.timeoutMs, retries: options.retries }
      );
      return object;
    } catch (error) {
      console.warn(`[EvaluatorAgent] schema fallback enabled: ${String(error)}`);
      return this.fallbackEvaluation(question, response, strategy);
    }
  }

  private fallbackEvaluation(question: string, response: string, strategy: string): Evaluation {
    const responseLen = response.trim().length;
    const questionLen = question.trim().length;
    const depth = Math.max(0.2, Math.min(0.85, responseLen / Math.max(120, questionLen * 6)));
    const consistency = responseLen < 30 ? 0.25 : 0.55;
    const authenticity = response.includes('I ') || response.includes('我') ? 0.58 : 0.52;
    const overall = (consistency + authenticity + depth) / 3;
    const verdict: Evaluation['verdict'] = overall >= 0.62 ? 'write' : overall >= 0.48 ? 'reinforce' : 'discard';
    return {
      consistency_score: consistency,
      authenticity_score: authenticity,
      depth_score: depth,
      overall_score: overall,
      verdict,
      insights: [`fallback evaluation for strategy=${strategy}`],
      new_memory_candidates:
        verdict === 'write'
          ? [{
            summary: response.slice(0, 180),
            category: 'opinion',
            soul_dimension: 'general',
            confidence: Math.max(0.45, Math.min(0.75, overall)),
          }]
          : [],
    };
  }
}

// ─── Director Agent ───────────────────────────────────────────────────────────
// Orchestrates the full pipeline, makes final decisions on soul updates

const DirectorDecisionSchema = z.object({
  should_continue: z.boolean(),
  convergence_reason: z.string().optional(),
  soul_updates: z.object({
    problem_solving_approach: z.string().optional(),
    knowledge_gaps_identified: z.array(z.string()).optional(),
    new_blind_spots: z.array(z.string()).optional(),
  }),
  coverage_score: z.number().min(0).max(1),
  quality_summary: z.string(),
});

export type DirectorDecision = z.infer<typeof DirectorDecisionSchema>;

export class DirectorAgent {
  private model = resolveModel();

  async review(
    soul: Soul,
    roundSummary: {
      round: number;
      questions_asked: number;
      nodes_written: number;
      nodes_reinforced: number;
      avg_quality_score: number;
      evaluations: Evaluation[];
      observability?: RoundObservability;
    }
  ): Promise<DirectorDecision> {
    const heuristicCoverage = estimateCoverageScore(soul, roundSummary);
    try {
      const { object } = await withRetry(
        () =>
          generateObject({
            model: this.model,
            schema: DirectorDecisionSchema,
            temperature: 0,
            prompt: `You are the Director overseeing training of a Persona Agent for "${soul.target_name}".

Training Round ${roundSummary.round} Summary:
- Questions asked: ${roundSummary.questions_asked}
- New nodes written: ${roundSummary.nodes_written}
- Nodes reinforced: ${roundSummary.nodes_reinforced}
- Average quality score: ${(roundSummary.avg_quality_score * 100).toFixed(1)}%

Soul state:
- Version: ${soul.version}
- Overall confidence: ${(soul.overall_confidence * 100).toFixed(1)}%
- Coverage score: ${(soul.coverage_score * 100).toFixed(1)}%
- Chunks processed: ${soul.total_chunks_processed}
- Core beliefs count: ${soul.values.core_beliefs.length}
- Expert domains: ${soul.knowledge_domains.expert.join(', ')}

Verdict distribution this round:
- Write: ${roundSummary.evaluations.filter((e) => e.verdict === 'write').length}
- Reinforce: ${roundSummary.evaluations.filter((e) => e.verdict === 'reinforce').length}
- Discard: ${roundSummary.evaluations.filter((e) => e.verdict === 'discard').length}
- Contradictions: ${roundSummary.evaluations.filter((e) => e.verdict === 'flag_contradiction').length}
${roundSummary.observability ? `
Observability signals:
- Duplication rate: ${(roundSummary.observability.duplicationRate * 100).toFixed(1)}%
- Contradiction rate: ${(roundSummary.observability.contradictionRate * 100).toFixed(1)}%
- Low-confidence coverage: ${(roundSummary.observability.lowConfidenceCoverage * 100).toFixed(1)}%
- New high-value memories: ${roundSummary.observability.newHighValueMemories}
- Quarantined memories: ${roundSummary.observability.quarantinedMemories}
` : ''}

Decide whether to continue training, suggest soul updates, and estimate coverage.
Coverage score reflects how well we've explored ${soul.target_name}'s worldview (0-1).`,
          }),
        { label: 'director review round', timeoutMs: 30_000, retries: 0 }
      );
      return {
        ...object,
        coverage_score: stabilizeCoverageScore(soul.coverage_score, heuristicCoverage, object.coverage_score),
      };
    } catch (error) {
      console.warn(`[DirectorAgent] schema fallback enabled: ${String(error)}`);
      const contradictionRate = roundSummary.observability?.contradictionRate ?? 0;
      const shouldContinue = contradictionRate > 0.12 || roundSummary.avg_quality_score < 0.7;
      return {
        should_continue: shouldContinue,
        convergence_reason: shouldContinue ? undefined : 'fallback-director: quality and contradiction reached target',
        soul_updates: {
          knowledge_gaps_identified: contradictionRate > 0.12 ? ['consistency'] : [],
          new_blind_spots: [],
        },
        coverage_score: stabilizeCoverageScore(soul.coverage_score, heuristicCoverage),
        quality_summary: `fallback-director review; contradiction=${contradictionRate.toFixed(2)}`,
      };
    }
  }
}

function estimateCoverageScore(
  soul: Soul,
  roundSummary: {
    questions_asked: number;
    nodes_written: number;
    nodes_reinforced: number;
    avg_quality_score: number;
    observability?: RoundObservability;
  }
): number {
  const questionUtilization =
    (roundSummary.nodes_written + roundSummary.nodes_reinforced) / Math.max(1, roundSummary.questions_asked);
  const lowConfidenceCoverage = roundSummary.observability?.lowConfidenceCoverage ?? 0;
  const contradictionPenalty = roundSummary.observability?.contradictionRate ?? 0;
  const heuristic =
    soul.coverage_score * 0.35 +
    lowConfidenceCoverage * 0.3 +
    Math.min(1, questionUtilization) * 0.2 +
    roundSummary.avg_quality_score * 0.15 -
    contradictionPenalty * 0.2;
  return Math.min(1, Math.max(0, heuristic));
}

function stabilizeCoverageScore(
  previousCoverage: number,
  heuristicCoverage: number,
  modelCoverage?: number
): number {
  const blended = modelCoverage === undefined
    ? heuristicCoverage
    : (heuristicCoverage * 0.7) + (modelCoverage * 0.3);
  const maxDelta = 0.2;
  const lower = Math.max(0, previousCoverage - maxDelta);
  const upper = Math.min(1, previousCoverage + maxDelta);
  return Math.min(upper, Math.max(lower, blended));
}

export const __testables__ = {
  estimateCoverageScore,
  stabilizeCoverageScore,
};

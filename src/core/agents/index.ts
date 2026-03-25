import { generateText, generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { Soul } from '../models/soul.js';
import { MemoryNode } from '../models/memory.js';
import { SoulRenderer } from '../soul/renderer.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { MemoryStore } from '../memory/store.js';

// ─── Persona Agent ────────────────────────────────────────────────────────────
// Plays the role of the target person using Soul+Memory RAG

export class PersonaAgent {
  private renderer = new SoulRenderer();
  // Use cheaper model for persona conversations
  private model = anthropic('claude-haiku-4-5-20251001');

  constructor(
    private readonly soul: Soul,
    private readonly retriever: MemoryRetriever,
    private readonly collection: string
  ) {}

  async respond(
    userMessage: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<string> {
    // RAG: retrieve relevant memories
    const memories = await this.retriever.retrieve(this.collection, userMessage, {
      limit: 8,
      minConfidence: 0.35,
    });

    const memoryContext = this.retriever.formatContext(memories);
    const systemPrompt = this.renderer.render(this.soul) +
      (memoryContext ? `\n\n${memoryContext}` : '');

    const { text } = await generateText({
      model: this.model,
      system: systemPrompt,
      messages: [
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ],
      maxTokens: 1024,
      temperature: 0.7,
    });

    return text;
  }
}

// ─── Trainer Agent ────────────────────────────────────────────────────────────
// Generates diverse questions to drive the cultivation loop

const QuestionSetSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    strategy: z.enum(['blind_spot', 'stress_test', 'consistency', 'scenario']),
    target_dimension: z.enum([
      'language_style', 'values', 'thinking_patterns',
      'behavioral_traits', 'knowledge_domains', 'general',
    ]),
    expected_challenge_level: z.enum(['easy', 'medium', 'hard']),
  })),
});

export class TrainerAgent {
  private model = anthropic('claude-haiku-4-5-20251001');

  async generateQuestions(
    soul: Soul,
    round: number,
    previousQuestions: string[] = []
  ): Promise<Array<{
    question: string;
    strategy: string;
    target_dimension: string;
    expected_challenge_level: string;
  }>> {
    const { object } = await generateObject({
      model: this.model,
      schema: QuestionSetSchema,
      prompt: `You are designing training questions to evaluate and improve a Persona Agent simulating "${soul.target_name}".

Round: ${round}
Dimensions with low confidence: ${this.lowConfidenceDimensions(soul).join(', ') || 'none'}
Previously used questions (avoid repeating): ${previousQuestions.slice(-10).join(' | ') || 'none'}

Generate 5 diverse questions using these 4 strategies:
1. **blind_spot**: Questions about topics they might avoid or lack expertise in (expose gaps)
2. **stress_test**: Challenging scenarios that test consistency under pressure
3. **consistency**: Questions that should have predictable answers based on known beliefs
4. **scenario**: Practical problem-solving in their domain of expertise

Return exactly 5 questions spanning different strategies and target dimensions.`,
    });

    return object.questions;
  }

  private lowConfidenceDimensions(soul: Soul): string[] {
    const dims: string[] = [];
    if (soul.language_style.vocabulary_preferences.length < 5) dims.push('language_style');
    if (soul.values.core_beliefs.length < 3) dims.push('values');
    if (soul.thinking_patterns.reasoning_style.length < 2) dims.push('thinking_patterns');
    if (soul.behavioral_traits.signature_behaviors.length < 2) dims.push('behavioral_traits');
    if (soul.knowledge_domains.expert.length === 0) dims.push('knowledge_domains');
    return dims;
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
  private model = anthropic('claude-sonnet-4-6');

  async evaluate(
    question: string,
    response: string,
    personaName: string,
    strategy: string
  ): Promise<Evaluation> {
    const { object } = await generateObject({
      model: this.model,
      schema: EvaluationSchema,
      prompt: `You are an independent quality evaluator for a persona simulation of "${personaName}".
You do NOT have access to their internal Soul configuration — evaluate purely based on response quality.

Question asked (strategy: ${strategy}):
"${question}"

Persona's response:
"${response}"

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
    });

    return object;
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
  private model = anthropic('claude-sonnet-4-6');

  async review(
    soul: Soul,
    roundSummary: {
      round: number;
      questions_asked: number;
      nodes_written: number;
      nodes_reinforced: number;
      avg_quality_score: number;
      evaluations: Evaluation[];
    }
  ): Promise<DirectorDecision> {
    const { object } = await generateObject({
      model: this.model,
      schema: DirectorDecisionSchema,
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

Decide whether to continue training, suggest soul updates, and estimate coverage.
Coverage score reflects how well we've explored ${soul.target_name}'s worldview (0-1).`,
    });

    return object;
  }
}

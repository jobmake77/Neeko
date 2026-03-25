import { z } from 'zod';

// ─── Confidence-rated item ──────────────────────────────────────────────────

export const ConfidentItemSchema = z.object({
  value: z.string(),
  confidence: z.number().min(0).max(1),
  evidence_count: z.number().int().min(0),
  evidence_quotes: z.array(z.string()).optional(),
});
export type ConfidentItem = z.infer<typeof ConfidentItemSchema>;

// ─── Language Style ─────────────────────────────────────────────────────────

export const LanguageStyleSchema = z.object({
  vocabulary_preferences: z.array(ConfidentItemSchema),
  sentence_patterns: z.array(ConfidentItemSchema),
  formality_level: z.number().min(0).max(1), // 0=very casual, 1=very formal
  avg_sentence_length: z.enum(['short', 'medium', 'long']),
  punctuation_quirks: z.array(z.string()),
  frequent_phrases: z.array(z.string()),
  languages_used: z.array(z.string()),
});
export type LanguageStyle = z.infer<typeof LanguageStyleSchema>;

// ─── Values ─────────────────────────────────────────────────────────────────

export const ValueItemSchema = z.object({
  belief: z.string(),
  priority: z.number().min(1), // 1 = highest priority
  confidence: z.number().min(0).max(1),
  evidence_count: z.number().int().min(0),
  stance: z.enum(['strong', 'moderate', 'nuanced']),
});
export type ValueItem = z.infer<typeof ValueItemSchema>;

export const ValuesSchema = z.object({
  core_beliefs: z.array(ValueItemSchema),
  priorities: z.array(z.string()), // ordered list
  known_stances: z.record(z.string(), ConfidentItemSchema), // topic → stance
});
export type Values = z.infer<typeof ValuesSchema>;

// ─── Thinking Patterns ──────────────────────────────────────────────────────

export const ThinkingPatternsSchema = z.object({
  reasoning_style: z.array(ConfidentItemSchema),
  decision_frameworks: z.array(ConfidentItemSchema),
  cognitive_biases: z.array(ConfidentItemSchema),
  problem_solving_approach: z.string(),
  first_principles_tendency: z.number().min(0).max(1),
  analogy_usage: z.enum(['rare', 'occasional', 'frequent']),
});
export type ThinkingPatterns = z.infer<typeof ThinkingPatternsSchema>;

// ─── Behavioral Traits ──────────────────────────────────────────────────────

export const BehavioralTraitsSchema = z.object({
  social_patterns: z.array(ConfidentItemSchema),
  stress_responses: z.array(ConfidentItemSchema),
  signature_behaviors: z.array(z.string()),
  humor_style: z.enum(['none', 'dry', 'self-deprecating', 'witty', 'sarcastic', 'absurdist']),
  controversy_handling: z.enum(['avoids', 'engages-carefully', 'leans-in', 'provokes']),
});
export type BehavioralTraits = z.infer<typeof BehavioralTraitsSchema>;

// ─── Knowledge Domains ──────────────────────────────────────────────────────

export const KnowledgeDomainsSchema = z.object({
  expert: z.array(z.string()),   // deep expertise
  familiar: z.array(z.string()), // comfortable discussing
  blind_spots: z.array(z.string()), // notable gaps or avoidance areas
});
export type KnowledgeDomains = z.infer<typeof KnowledgeDomainsSchema>;

// ─── Soul ────────────────────────────────────────────────────────────────────

export const SoulSchema = z.object({
  // metadata
  version: z.number().int().min(1).default(1),
  target_name: z.string(),
  target_handle: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  data_sources: z.array(z.string()),
  total_chunks_processed: z.number().int().min(0),

  // five core dimensions
  language_style: LanguageStyleSchema,
  values: ValuesSchema,
  thinking_patterns: ThinkingPatternsSchema,
  behavioral_traits: BehavioralTraitsSchema,
  knowledge_domains: KnowledgeDomainsSchema,

  // quality
  overall_confidence: z.number().min(0).max(1),
  coverage_score: z.number().min(0).max(1),
  training_rounds_completed: z.number().int().min(0).default(0),
});

export type Soul = z.infer<typeof SoulSchema>;

export function createEmptySoul(targetName: string, targetHandle?: string): Soul {
  const now = new Date().toISOString();
  return {
    version: 1,
    target_name: targetName,
    target_handle: targetHandle,
    created_at: now,
    updated_at: now,
    data_sources: [],
    total_chunks_processed: 0,
    language_style: {
      vocabulary_preferences: [],
      sentence_patterns: [],
      formality_level: 0.5,
      avg_sentence_length: 'medium',
      punctuation_quirks: [],
      frequent_phrases: [],
      languages_used: [],
    },
    values: {
      core_beliefs: [],
      priorities: [],
      known_stances: {},
    },
    thinking_patterns: {
      reasoning_style: [],
      decision_frameworks: [],
      cognitive_biases: [],
      problem_solving_approach: '',
      first_principles_tendency: 0.5,
      analogy_usage: 'occasional',
    },
    behavioral_traits: {
      social_patterns: [],
      stress_responses: [],
      signature_behaviors: [],
      humor_style: 'none',
      controversy_handling: 'engages-carefully',
    },
    knowledge_domains: {
      expert: [],
      familiar: [],
      blind_spots: [],
    },
    overall_confidence: 0,
    coverage_score: 0,
    training_rounds_completed: 0,
  };
}

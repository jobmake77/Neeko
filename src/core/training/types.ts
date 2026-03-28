import { MemoryNode } from '../models/memory.js';

export type QuestionStrategy =
  | 'blind_spot'
  | 'stress_test'
  | 'consistency'
  | 'scenario';

export type TargetDimension =
  | 'language_style'
  | 'values'
  | 'thinking_patterns'
  | 'behavioral_traits'
  | 'knowledge_domains'
  | 'general';

export type TrainingProfile =
  | 'baseline'
  | 'a1'
  | 'a2'
  | 'a3'
  | 'a4'
  | 'full';

export interface TrainingQuestion {
  question: string;
  strategy: QuestionStrategy;
  target_dimension: TargetDimension;
  expected_challenge_level: 'easy' | 'medium' | 'hard';
}

export interface RoundObservability {
  round: number;
  scoreDistribution: {
    min: number;
    max: number;
    p50: number;
    p90: number;
  };
  lowConfidenceCoverage: number;
  contradictionRate: number;
  duplicationRate: number;
  newHighValueMemories: number;
  quarantinedMemories: number;
  memoryGrowthByType: {
    semantic: number;
    procedural: number;
    episodic: number;
    working: number;
  };
  gapFocusedQuestions: number;
  totalQuestions: number;
}

export interface MemoryCandidateForGovernance {
  summary: string;
  category: MemoryNode['category'];
  soul_dimension: MemoryNode['soul_dimension'];
  confidence: number;
}

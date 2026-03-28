import { Soul } from '../models/soul.js';
import {
  QuestionStrategy,
  RoundObservability,
  TargetDimension,
  TrainingProfile,
} from './types.js';

const STRATEGY_ORDER: QuestionStrategy[] = [
  'consistency',
  'scenario',
  'stress_test',
  'blind_spot',
];

const STRATEGY_BY_STAGE: Record<
  QuestionStrategy,
  Array<{ strategy: QuestionStrategy; weight: number }>
> = {
  consistency: [
    { strategy: 'consistency', weight: 0.55 },
    { strategy: 'scenario', weight: 0.25 },
    { strategy: 'stress_test', weight: 0.15 },
    { strategy: 'blind_spot', weight: 0.05 },
  ],
  scenario: [
    { strategy: 'consistency', weight: 0.2 },
    { strategy: 'scenario', weight: 0.5 },
    { strategy: 'stress_test', weight: 0.2 },
    { strategy: 'blind_spot', weight: 0.1 },
  ],
  stress_test: [
    { strategy: 'consistency', weight: 0.1 },
    { strategy: 'scenario', weight: 0.25 },
    { strategy: 'stress_test', weight: 0.5 },
    { strategy: 'blind_spot', weight: 0.15 },
  ],
  blind_spot: [
    { strategy: 'consistency', weight: 0.1 },
    { strategy: 'scenario', weight: 0.2 },
    { strategy: 'stress_test', weight: 0.2 },
    { strategy: 'blind_spot', weight: 0.5 },
  ],
};

export interface QuestionPlan {
  stage: QuestionStrategy;
  strategyTargets: Array<{ strategy: QuestionStrategy; count: number }>;
  lowConfidenceDimensions: TargetDimension[];
}

export class TrainingPolicy {
  buildQuestionPlan(
    soul: Soul,
    round: number,
    profile: TrainingProfile,
    questionsPerRound = 5,
    previousRound?: RoundObservability,
    skillGapPressure = 0
  ): QuestionPlan {
    const lowConfidenceDimensions = this.lowConfidenceDimensions(soul);
    const stage = this.resolveStage(round, profile, previousRound);
    const weights = STRATEGY_BY_STAGE[stage];

    const strategyTargets = this.allocateCounts(weights, questionsPerRound, profile, skillGapPressure);
    return { stage, strategyTargets, lowConfidenceDimensions };
  }

  private resolveStage(
    round: number,
    profile: TrainingProfile,
    previousRound?: RoundObservability
  ): QuestionStrategy {
    if (profile === 'baseline') return 'scenario';
    if (profile === 'a1' || profile === 'a2' || profile === 'a3' || profile === 'a4' || profile === 'full') {
      const idx = Math.floor((round - 1) / 2);
      const ordered = STRATEGY_ORDER[Math.min(idx, STRATEGY_ORDER.length - 1)];
      if (previousRound && previousRound.lowConfidenceCoverage < 0.6) {
        return ordered === 'blind_spot' ? 'blind_spot' : 'stress_test';
      }
      return ordered;
    }
    return 'scenario';
  }

  private allocateCounts(
    weights: Array<{ strategy: QuestionStrategy; weight: number }>,
    total: number,
    profile: TrainingProfile,
    skillGapPressure: number
  ): Array<{ strategy: QuestionStrategy; count: number }> {
    const base = weights.map((w) => ({
      strategy: w.strategy,
      count: Math.floor(w.weight * total),
    }));
    let assigned = base.reduce((sum, v) => sum + v.count, 0);
    let cursor = 0;
    while (assigned < total) {
      base[cursor % base.length].count++;
      cursor++;
      assigned++;
    }
    const advancedProfile =
      profile === 'a1' || profile === 'a2' || profile === 'a3' || profile === 'a4' || profile === 'full';
    if (advancedProfile && skillGapPressure >= 0.34 && total >= 4) {
      const target = base.find((b) => b.strategy === 'blind_spot') ?? base[0];
      const from = base
        .filter((b) => b.strategy !== 'blind_spot' && b.count > 1)
        .sort((a, b) => b.count - a.count)[0];
      if (from) {
        from.count -= 1;
        target.count += 1;
      }
    }
    if (advancedProfile && skillGapPressure >= 0.67 && total >= 5) {
      const target = base.find((b) => b.strategy === 'scenario') ?? base[0];
      const from = base
        .filter((b) => b.strategy !== 'scenario' && b.count > 1)
        .sort((a, b) => b.count - a.count)[0];
      if (from) {
        from.count -= 1;
        target.count += 1;
      }
    }
    return base.filter((b) => b.count > 0);
  }

  private lowConfidenceDimensions(soul: Soul): TargetDimension[] {
    const dims: TargetDimension[] = [];
    if (soul.language_style.vocabulary_preferences.length < 5) dims.push('language_style');
    if (soul.values.core_beliefs.length < 3) dims.push('values');
    if (soul.thinking_patterns.reasoning_style.length < 2) dims.push('thinking_patterns');
    if (soul.behavioral_traits.signature_behaviors.length < 2) dims.push('behavioral_traits');
    if (soul.knowledge_domains.expert.length === 0) dims.push('knowledge_domains');
    if (dims.length === 0) dims.push('general');
    return dims;
  }
}

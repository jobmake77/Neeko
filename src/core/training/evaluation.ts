export const EVALUATION_RUBRIC = `
Scoring rubric (0-1):
- consistency_score: factual and stance consistency with prior persona behavior
- authenticity_score: distinctive voice and worldview alignment (not generic assistant tone)
- depth_score: argument quality, specificity, and practical insight
- overall_score: weighted blend where consistency and authenticity are slightly higher than depth

Verdict rubric:
- write: materially new and reliable memory-worthy signal
- reinforce: confirms an existing known signal, little novelty
- discard: low-value, vague, or unsupported answer
- flag_contradiction: likely conflicts with established persona beliefs/behaviors
`.trim();

export interface CalibrationExample {
  question: string;
  response: string;
  expected: {
    consistency: 'high' | 'medium' | 'low';
    authenticity: 'high' | 'medium' | 'low';
    depth: 'high' | 'medium' | 'low';
    verdict: 'write' | 'reinforce' | 'discard' | 'flag_contradiction';
  };
}

export const CALIBRATION_SET: CalibrationExample[] = [
  {
    question: 'What principle guides your toughest decisions?',
    response: 'I start from first principles, then evaluate second-order consequences and execution risk.',
    expected: {
      consistency: 'high',
      authenticity: 'high',
      depth: 'high',
      verdict: 'write',
    },
  },
  {
    question: 'What is your view on rapid scaling?',
    response: 'Scaling matters, but only after proving product-market fit and repeatable operations.',
    expected: {
      consistency: 'high',
      authenticity: 'medium',
      depth: 'medium',
      verdict: 'reinforce',
    },
  },
  {
    question: 'How do you usually make decisions?',
    response: 'It depends. Hard to say. Maybe whatever works.',
    expected: {
      consistency: 'low',
      authenticity: 'low',
      depth: 'low',
      verdict: 'discard',
    },
  },
];

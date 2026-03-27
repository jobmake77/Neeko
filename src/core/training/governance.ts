import { MemoryNode } from '../models/memory.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { MemoryCandidateForGovernance } from './types.js';

export interface GovernanceDecision {
  action: 'write' | 'reinforce' | 'discard' | 'quarantine';
  reason: string;
  duplicateNodeId?: string;
  contradictionNodeId?: string;
  highValue: boolean;
}

export class MemoryGovernance {
  constructor(
    private readonly retriever: MemoryRetriever,
    private readonly options: {
      minWriteConfidence?: number;
      duplicateSimilarity?: number;
    } = {}
  ) {}

  async reviewCandidate(
    collection: string,
    candidate: MemoryCandidateForGovernance
  ): Promise<GovernanceDecision> {
    const minWriteConfidence = this.options.minWriteConfidence ?? 0.45;
    const duplicateSimilarity = this.options.duplicateSimilarity ?? 0.92;
    const highValue = candidate.confidence >= 0.7 && candidate.summary.length >= 40;

    if (candidate.confidence < minWriteConfidence) {
      return {
        action: 'discard',
        reason: `confidence ${candidate.confidence.toFixed(2)} below threshold`,
        highValue: false,
      };
    }

    const related = await this.retriever.retrieve(collection, candidate.summary, {
      limit: 5,
      minConfidence: 0.35,
    });

    const duplicate = this.findDuplicate(candidate, related, duplicateSimilarity);
    if (duplicate) {
      return {
        action: 'reinforce',
        reason: 'candidate duplicates an existing memory',
        duplicateNodeId: duplicate.id,
        highValue,
      };
    }

    const contradiction = this.findContradiction(candidate, related);
    if (contradiction) {
      return {
        action: 'quarantine',
        reason: 'candidate appears contradictory and requires director adjudication',
        contradictionNodeId: contradiction.id,
        highValue,
      };
    }

    return {
      action: 'write',
      reason: 'candidate passed governance checks',
      highValue,
    };
  }

  private findDuplicate(
    candidate: MemoryCandidateForGovernance,
    related: MemoryNode[],
    threshold: number
  ): MemoryNode | null {
    const normalized = normalize(candidate.summary);
    for (const node of related) {
      if (node.soul_dimension !== candidate.soul_dimension) continue;
      const score = sentenceSimilarity(normalized, normalize(node.summary));
      if (score >= threshold) return node;
    }
    return null;
  }

  private findContradiction(
    candidate: MemoryCandidateForGovernance,
    related: MemoryNode[]
  ): MemoryNode | null {
    const normalized = normalize(candidate.summary);
    for (const node of related) {
      if (node.soul_dimension !== candidate.soul_dimension) continue;
      const other = normalize(node.summary);
      const overlap = sentenceSimilarity(normalized, other);
      if (overlap < 0.6) continue;
      if (hasNegation(normalized) !== hasNegation(other)) return node;
    }
    return null;
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(a.split(' '));
  const sb = new Set(b.split(' '));
  let inter = 0;
  for (const token of sa) {
    if (sb.has(token)) inter++;
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function hasNegation(text: string): boolean {
  return /\b(no|not|never|cannot|can't|dont|don't|avoid|against|without)\b/.test(text);
}

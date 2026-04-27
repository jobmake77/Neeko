import {
  MemoryNode,
  MemoryProvenanceAssessment,
  MemoryProvenanceCue,
} from '../models/memory.js';
import { MemoryRetriever } from '../memory/retriever.js';
import {
  GovernanceProvenanceContext,
  MemoryCandidateForGovernance,
} from './types.js';

export interface GovernanceDecision {
  action: 'write' | 'reinforce' | 'discard' | 'quarantine';
  reason: string;
  duplicateNodeId?: string;
  contradictionNodeId?: string;
  highValue: boolean;
  provenance?: MemoryProvenanceAssessment;
}

export class MemoryGovernance {
  constructor(
    private readonly retriever: MemoryRetriever,
    private readonly options: {
      minWriteConfidence?: number;
      duplicateSimilarity?: number;
      provenanceContext?: GovernanceProvenanceContext;
    } = {}
  ) {}

  async reviewCandidate(
    collection: string,
    candidate: MemoryCandidateForGovernance
  ): Promise<GovernanceDecision> {
    const minWriteConfidence = this.options.minWriteConfidence ?? 0.45;
    const duplicateSimilarity = this.options.duplicateSimilarity ?? 0.92;
    const provenance = assessCandidateProvenance(candidate, this.options.provenanceContext);
    const highValue = candidate.confidence >= 0.7 && candidate.summary.length >= 40;

    if (candidate.confidence < minWriteConfidence) {
      return {
        action: 'discard',
        reason: `confidence ${candidate.confidence.toFixed(2)} below threshold`,
        highValue: false,
        provenance,
      };
    }

    if (provenance.status === 'blocked') {
      return {
        action: 'quarantine',
        reason: provenance.reasons.join('; ') || 'candidate failed provenance guardrails',
        highValue: false,
        provenance,
      };
    }

    if (provenance.status === 'weak' && isAutobiographicalClaim(candidate)) {
      return {
        action: 'quarantine',
        reason: provenance.reasons.join('; ') || 'candidate lacks enough provenance for a first-person memory write',
        highValue: false,
        provenance,
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
        provenance,
      };
    }

    const contradiction = this.findContradiction(candidate, related);
    if (contradiction) {
      return {
        action: 'quarantine',
        reason: 'candidate appears contradictory and requires director adjudication',
        contradictionNodeId: contradiction.id,
        highValue,
        provenance,
      };
    }

    return {
      action: 'write',
      reason: provenance.reasons[0] ?? 'candidate passed governance checks',
      highValue,
      provenance,
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

export function assessCandidateProvenance(
  candidate: MemoryCandidateForGovernance,
  context?: GovernanceProvenanceContext,
): MemoryProvenanceAssessment {
  const summary = candidate.summary.trim();
  if (!summary) {
    return {
      status: 'blocked',
      score: 0,
      matched_cues: [],
      missing_signals: ['empty_summary'],
      reasons: ['candidate summary is empty'],
    };
  }

  if (!hasUsableProvenanceContext(context)) {
    return {
      status: 'supported',
      score: 0.5,
      matched_cues: [],
      missing_signals: [],
      reasons: ['no persona-web provenance context loaded; falling back to standard governance'],
    };
  }

  const cueMatches = collectCueMatches(summary, context);
  const coverageScore = clamp01(context?.coverage_score ?? 0.5, 0.5);
  const autobiographical = isAutobiographicalClaim(candidate);
  const backgroundHeavy = hasBackgroundContextSignal(summary);
  const score = clamp01(
    (coverageScore * 0.45)
      + (Math.min(3, cueMatches.length) * 0.18)
      + (autobiographical ? 0.05 : 0)
      - (backgroundHeavy && cueMatches.length === 0 ? 0.15 : 0),
    0,
  );

  const missingSignals: string[] = [];
  const reasons: string[] = [];

  if (cueMatches.length === 0) {
    missingSignals.push('anchored_persona_web_cues');
    reasons.push('candidate has no overlap with current relation/context/identity hints');
  }

  if (backgroundHeavy) {
    reasons.push('candidate leans on background or third-party context');
  }

  if (autobiographical && cueMatches.length === 0) {
    reasons.push('first-person autobiographical write lacks anchored support');
  }

  if (autobiographical && backgroundHeavy && cueMatches.length === 0) {
    return {
      status: 'blocked',
      score,
      matched_cues: cueMatches,
      missing_signals: missingSignals,
      reasons: reasons.length > 0
        ? reasons
        : ['autobiographical claim appears to be derived from unsupported background context'],
    };
  }

  if (cueMatches.length >= 2 && coverageScore >= 0.5) {
    return {
      status: 'verified',
      score,
      matched_cues: cueMatches,
      missing_signals: missingSignals,
      reasons: ['candidate is anchored by multiple persona-web cues'],
    };
  }

  if (cueMatches.length >= 1) {
    return {
      status: 'supported',
      score,
      matched_cues: cueMatches,
      missing_signals: missingSignals,
      reasons: ['candidate is partially supported by persona-web context'],
    };
  }

  return {
    status: autobiographical ? 'weak' : 'supported',
    score,
    matched_cues: cueMatches,
    missing_signals: missingSignals,
    reasons: reasons.length > 0 ? reasons : ['candidate lacks enough provenance cues'],
  };
}

function collectCueMatches(
  summary: string,
  context?: GovernanceProvenanceContext,
): MemoryProvenanceCue[] {
  if (!context) return [];
  const matchBuckets: Array<{ kind: MemoryProvenanceCue['kind']; values: string[] }> = [
    { kind: 'context', values: context.context_hints ?? [] },
    { kind: 'relation', values: context.relationship_hints ?? [] },
    { kind: 'identity_arc', values: context.identity_hints ?? [] },
    { kind: 'entity', values: context.topics ?? [] },
    { kind: 'signal', values: context.signals ?? [] },
    { kind: 'source', values: context.guardrail_notes ?? [] },
  ];
  const matches: MemoryProvenanceCue[] = [];
  for (const bucket of matchBuckets) {
    for (const value of bucket.values) {
      const overlap = cueOverlap(summary, value);
      if (overlap < 0.22) continue;
      matches.push({
        kind: bucket.kind,
        value,
        confidence: clamp01(overlap, 0.5),
      });
    }
  }
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);
}

function hasUsableProvenanceContext(context?: GovernanceProvenanceContext): boolean {
  if (!context) return false;
  return [
    ...(context.topics ?? []),
    ...(context.signals ?? []),
    ...(context.relationship_hints ?? []),
    ...(context.context_hints ?? []),
    ...(context.identity_hints ?? []),
    ...(context.guardrail_notes ?? []),
  ].some((item) => Boolean(String(item).trim()));
}

function isAutobiographicalClaim(candidate: MemoryCandidateForGovernance): boolean {
  if (!['fact', 'experience', 'behavior', 'knowledge'].includes(candidate.category)) return false;
  return hasFirstPersonSignal(candidate.summary);
}

function hasFirstPersonSignal(text: string): boolean {
  return /\b(i|i'm|i’ve|i'd|my|mine|myself)\b/i.test(text)
    || /(^|[\s，。；、])我(的|是|在|做|会|用|更|曾|把|对|喜欢|认为|觉得|经历|参与|写|开发|维护)?/u.test(text);
}

function hasBackgroundContextSignal(text: string): boolean {
  return /\b(company|market|ticker|stock|economy|industry|framework|protocol|customer|founder|team|organization|org|product)\b/i.test(text)
    || /(公司|市场|股票|行业|赛道|经济|技术栈|框架|团队|组织|产品|项目背景|上下游|开源社区)/u.test(text);
}

function cueOverlap(summary: string, cue: string): number {
  const summaryTokens = tokenize(summary);
  const cueTokens = tokenize(cue);
  if (summaryTokens.length === 0 || cueTokens.length === 0) return 0;
  const summarySet = new Set(summaryTokens);
  const hitCount = cueTokens.filter((token) => summarySet.has(token)).length;
  if (hitCount === 0) return 0;
  return hitCount / cueTokens.length;
}

function tokenize(text: string): string[] {
  return Array.from(new Set(
    (text.toLowerCase().match(/[a-z0-9_+-]{2,}|[\u4e00-\u9fff]{2,}/gu) ?? [])
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  ));
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

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export const __governanceTestables = {
  assessCandidateProvenance,
  hasBackgroundContextSignal,
  hasFirstPersonSignal,
  isAutobiographicalClaim,
};

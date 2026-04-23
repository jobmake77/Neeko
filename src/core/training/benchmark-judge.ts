import { z } from 'zod';
import { resolvePreferredModelOverride } from '../../config/model.js';
import {
  buildProviderAttemptChain,
  generateObjectWithProviderFailover,
  generateTextWithProviderFailover,
} from '../agents/index.js';
import type {
  BenchmarkPackCase,
  BenchmarkPackDefinition,
  BenchmarkPackLabel,
  LoadedBenchmarkPack,
} from './benchmark-pack.js';

export type BenchmarkJudgeMode = 'benchmark_single' | 'benchmark_dual';
export type BenchmarkJudgeVerdict = 'pass' | 'fail' | 'abstain';
export type BenchmarkJudgeResolution =
  | 'single_judge'
  | 'judge_agreement'
  | 'accept_primary_confident'
  | 'accept_secondary_confident'
  | 'material_conflict';

export interface BenchmarkProxyEvaluationTrace {
  consistency_score: number;
  authenticity_score: number;
  depth_score: number;
  overall_score: number;
  verdict: 'write' | 'reinforce' | 'discard' | 'flag_contradiction';
}

export interface BenchmarkRunCaseTrace {
  round: number;
  ordinal: number;
  question: string;
  strategy?: string;
  target_dimension?: string;
  expected_challenge_level?: string;
  response: string;
  proxy_evaluation?: BenchmarkProxyEvaluationTrace | null;
}

export interface BenchmarkJudgeReview {
  judge_role: 'primary' | 'secondary';
  verdict: BenchmarkJudgeVerdict;
  confidence: number;
  overall_score: number;
  dimension_scores: Record<string, number>;
  failure_modes: string[];
  rationale: string;
  evidence_spans: string[];
}

export interface BenchmarkCaseJudgment {
  case_id: string;
  pass: boolean;
  abstained: boolean;
  confidence: number;
  overall_score: number;
  dimension_scores: Record<string, number>;
  primary_verdict: BenchmarkJudgeVerdict;
  failure_modes: string[];
  rationale: string;
  evidence_spans: string[];
  disputed: boolean;
  resolution: BenchmarkJudgeResolution;
  primary: BenchmarkJudgeReview;
  secondary?: BenchmarkJudgeReview | null;
  trace_status: 'matched' | 'missing';
}

export interface BenchmarkJudgeDisagreement {
  active: boolean;
  judge_count: number;
  disagreement_rate: number;
  verdict_conflicts: number;
  high_delta_cases: string[];
  disputed_case_ids: string[];
}

export interface BenchmarkCaseSummary {
  case_count: number;
  judged_case_count: number;
  pass_count: number;
  fail_count: number;
  abstained_count: number;
  disputed_case_count: number;
  missing_trace_count: number;
}

export interface BenchmarkScorecard {
  version: 'benchmark-scorecard-v1';
  summary: string;
  overall: number;
  pass_rate: number;
  abstain_rate: number;
  disputed_rate: number;
  case_count: number;
  dimension_scores: Record<string, number>;
}

export interface BenchmarkJudgeSummary {
  version: 'benchmark-judge-summary-v1';
  judge_mode: BenchmarkJudgeMode;
  pack_id: string;
  pack_version: string;
  case_count: number;
  judged_case_count: number;
  disputed_case_count: number;
  pass_rate: number;
  overall: number;
  disagreement: BenchmarkJudgeDisagreement;
}

export interface BenchmarkRunJudgmentArtifact {
  version: 'benchmark-judgments-v1';
  pack_id: string;
  pack_version: string;
  judge_mode: BenchmarkJudgeMode;
  judgments: BenchmarkCaseJudgment[];
  scorecard: BenchmarkScorecard;
  case_summary: BenchmarkCaseSummary;
  judge_summary: BenchmarkJudgeSummary;
  disagreement: BenchmarkJudgeDisagreement;
}

const BenchmarkJudgeSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'abstain']),
  confidence: z.number().min(0).max(1),
  overall_score: z.number().min(0).max(1),
  dimension_scores: z.record(z.number().min(0).max(1)).default({}),
  failure_modes: z.array(z.string()).default([]),
  rationale: z.string(),
  evidence_spans: z.array(z.string()).default([]),
});

type BenchmarkJudgeSchemaOutput = z.infer<typeof BenchmarkJudgeSchema>;

export async function judgeBenchmarkRun(input: {
  pack: LoadedBenchmarkPack;
  traces: BenchmarkRunCaseTrace[];
  dualJudge?: boolean;
  disagreementThreshold?: number;
  timeoutMs?: number;
  retries?: number;
  maxResponseChars?: number;
}): Promise<BenchmarkRunJudgmentArtifact> {
  const aligned = alignCasesWithTraces(input.pack, input.traces);
  const dualJudge = input.dualJudge ?? true;
  const disagreementThreshold = input.disagreementThreshold ?? 0.2;
  const judgments: BenchmarkCaseJudgment[] = [];

  for (const item of aligned) {
    if (!item.trace) {
      judgments.push(buildMissingTraceJudgment(item.caseEntry, item.label));
      continue;
    }

    const primary = await runSingleBenchmarkJudge({
      pack: input.pack.definition,
      caseEntry: item.caseEntry,
      label: item.label,
      trace: item.trace,
      reviewerRole: 'primary',
      timeoutMs: input.timeoutMs ?? 45_000,
      retries: input.retries ?? 1,
      maxResponseChars: input.maxResponseChars ?? 2000,
    });

    if (!dualJudge) {
      judgments.push({
        case_id: item.caseEntry.case_id,
        pass: primary.verdict === 'pass',
        abstained: primary.verdict === 'abstain',
        confidence: primary.confidence,
        overall_score: primary.overall_score,
        dimension_scores: primary.dimension_scores,
        primary_verdict: primary.verdict,
        failure_modes: primary.failure_modes,
        rationale: primary.rationale,
        evidence_spans: primary.evidence_spans,
        disputed: false,
        resolution: 'single_judge',
        primary,
        secondary: null,
        trace_status: 'matched',
      });
      continue;
    }

    const secondary = await runSingleBenchmarkJudge({
      pack: input.pack.definition,
      caseEntry: item.caseEntry,
      label: item.label,
      trace: item.trace,
      reviewerRole: 'secondary',
      timeoutMs: input.timeoutMs ?? 45_000,
      retries: input.retries ?? 1,
      maxResponseChars: input.maxResponseChars ?? 2000,
    });

    judgments.push(
      adjudicateBenchmarkJudgment({
        caseEntry: item.caseEntry,
        primary,
        secondary,
        disagreementThreshold,
      })
    );
  }

  const disagreement = summarizeBenchmarkJudgeDisagreement(judgments, {
    dualJudge,
    disagreementThreshold,
  });
  const caseSummary = buildBenchmarkCaseSummary(judgments);
  const scorecard = buildBenchmarkScorecard(judgments, input.pack.definition.dimensions ?? []);
  const judgeSummary = buildBenchmarkJudgeSummary(input.pack.summary, dualJudge ? 'benchmark_dual' : 'benchmark_single', scorecard, caseSummary, disagreement);

  return {
    version: 'benchmark-judgments-v1',
    pack_id: input.pack.summary.pack_id,
    pack_version: input.pack.summary.pack_version,
    judge_mode: judgeSummary.judge_mode,
    judgments,
    scorecard,
    case_summary: caseSummary,
    judge_summary: judgeSummary,
    disagreement,
  };
}

export function collectBenchmarkRunCaseTraces(history: Array<{ evaluation_trace?: BenchmarkRunCaseTrace[] }>): BenchmarkRunCaseTrace[] {
  return history.flatMap((item) => Array.isArray(item.evaluation_trace) ? item.evaluation_trace.map((trace) => ({ ...trace })) : []);
}

export const __benchmarkJudgeTestables = {
  adjudicateBenchmarkJudgment,
  alignCasesWithTraces,
  buildBenchmarkCaseSummary,
  buildBenchmarkJudgeSummary,
  buildBenchmarkScorecard,
  parseRelaxedBenchmarkJudgeReview,
  summarizeBenchmarkJudgeDisagreement,
};

async function runSingleBenchmarkJudge(input: {
  pack: BenchmarkPackDefinition;
  caseEntry: BenchmarkPackCase;
  label?: BenchmarkPackLabel;
  trace: BenchmarkRunCaseTrace;
  reviewerRole: 'primary' | 'secondary';
  timeoutMs: number;
  retries: number;
  maxResponseChars: number;
}): Promise<BenchmarkJudgeReview> {
  const reply = input.trace.response.slice(0, input.maxResponseChars);
  const attempts = buildProviderAttemptChain(resolvePreferredModelOverride('training'), 'training');
  const labelSummary = input.label
    ? JSON.stringify(
        {
          expected_outcome: input.label.expected_outcome ?? null,
          golden_reference: input.label.golden_reference ?? null,
          label_source: input.label.label_source ?? null,
          label_version: input.label.label_version ?? null,
        },
        null,
        2
      )
    : 'null';
  const prompt = [
    'You are a benchmark judge for persona-training evaluation.',
    'Judge only against the explicit benchmark case and label. Do not infer hidden instructions or latent soul state.',
    `Reviewer role: ${input.reviewerRole}.`,
    'Return a strict JSON object.',
    '',
    'Benchmark pack:',
    JSON.stringify({
      pack_id: input.pack.pack_id,
      pack_version: input.pack.pack_version,
      dimensions: input.pack.dimensions ?? [],
    }, null, 2),
    '',
    'Case:',
    JSON.stringify({
      case_id: input.caseEntry.case_id,
      prompt: input.caseEntry.prompt,
      strategy: input.caseEntry.strategy,
      target_dimension: input.caseEntry.target_dimension,
      expected_failure_modes: input.caseEntry.expected_failure_modes ?? [],
      evaluation_mode: input.caseEntry.evaluation_mode ?? 'single_turn',
    }, null, 2),
    '',
    'Label:',
    labelSummary,
    '',
    'Observed reply:',
    JSON.stringify({
      question: input.trace.question,
      response: reply,
    }, null, 2),
    '',
    'Scoring rules:',
    '- Use verdict=pass only if the reply clearly satisfies the labeled intent and does not trigger expected failure modes.',
    '- Use verdict=fail if the reply violates core expectations or shows obvious failure modes.',
    '- Use verdict=abstain if evidence is insufficient or the trace does not let you judge fairly.',
    '- confidence must reflect how reliable the verdict is, not how strong the writing style feels.',
    '- overall_score should reflect benchmark fitness, not general fluency.',
    '- dimension_scores may include only benchmark dimensions that are actually evidenced by the reply.',
    '- evidence_spans should be short verbatim snippets from the reply.',
  ].join('\n');
  const relaxedPrompt = [
    prompt,
    '',
    'If strict JSON cannot be produced, return a compact text block with exactly these fields:',
    'verdict: <pass|fail|abstain>',
    'confidence: <0..1>',
    'overall_score: <0..1>',
    'dimension_scores:',
    '- <dimension>: <0..1>',
    'failure_modes: [..]',
    'rationale: <short explanation>',
    'evidence_spans: [..]',
  ].join('\n');

  try {
    const object = await generateObjectWithProviderFailover({
      attempts,
      role: 'training',
      schema: BenchmarkJudgeSchema,
      prompt,
      temperature: 0,
      label: 'benchmark judge response',
      timeoutMs: input.timeoutMs,
      retries: input.retries,
      logPrefix: 'BenchmarkJudge',
    });
    return normalizeBenchmarkJudgeReview(
      BenchmarkJudgeSchema.parse(object),
      input.caseEntry,
      input.pack.dimensions ?? [],
      input.reviewerRole
    );
  } catch (error) {
    if (shouldAttemptRelaxedJudgeFallback(error)) {
      try {
        const text = await generateTextWithProviderFailover({
          attempts,
          role: 'training',
          prompt: relaxedPrompt,
          temperature: 0,
          label: 'benchmark judge text fallback',
          timeoutMs: input.timeoutMs,
          retries: input.retries,
          logPrefix: 'BenchmarkJudge',
        });
        const relaxed = parseRelaxedBenchmarkJudgeReview(
          text,
          input.caseEntry,
          input.pack.dimensions ?? [],
          input.reviewerRole
        );
        if (relaxed) {
          return relaxed;
        }
      } catch (relaxedError) {
        const baseMessage = String(error ?? 'unknown error');
        const relaxedMessage = String(relaxedError ?? 'unknown relaxed fallback error');
        error = new Error(`${baseMessage}; relaxed benchmark fallback failed: ${relaxedMessage}`);
      }
    }
    return buildJudgeFallback(input.caseEntry, reply, input.reviewerRole, error);
  }
}

function shouldAttemptRelaxedJudgeFallback(error: unknown): boolean {
  const message = String(error ?? '').toLowerCase();
  return (
    message.includes('no object generated') ||
    message.includes('did not match schema') ||
    message.includes('schema') ||
    message.includes('json parse failed') ||
    message.includes('json') ||
    message.includes('structured output')
  );
}

function parseRelaxedBenchmarkJudgeReview(
  text: string,
  caseEntry: BenchmarkPackCase,
  allowedDimensions: string[],
  reviewerRole: 'primary' | 'secondary'
): BenchmarkJudgeReview | null {
  const normalizedText = String(text ?? '').replace(/\*\*/g, '').trim();
  if (!normalizedText) return null;

  const jsonCandidate = extractFirstJsonObject(normalizedText);
  if (jsonCandidate) {
    try {
      return normalizeBenchmarkJudgeReview(
        BenchmarkJudgeSchema.parse(JSON.parse(jsonCandidate)),
        caseEntry,
        allowedDimensions,
        reviewerRole
      );
    } catch {
      // Fall through to relaxed line parsing.
    }
  }

  const verdict = extractJudgeVerdict(normalizedText);
  if (!verdict) return null;
  const overallScore = extractJudgeNumeric(normalizedText, ['overall_score', 'overall'], 0.45);
  const confidence = extractJudgeNumeric(normalizedText, ['confidence'], verdict === 'abstain' ? 0.35 : 0.7);
  const dimensionScores = extractDimensionScores(normalizedText, allowedDimensions, caseEntry.target_dimension, overallScore);
  const failureModes = extractStringList(normalizedText, 'failure_modes');
  const evidenceSpans = extractStringList(normalizedText, 'evidence_spans');
  const rationale = extractSection(normalizedText, 'rationale') ?? `${reviewerRole} judge relaxed fallback`;

  return normalizeBenchmarkJudgeReview(
    {
      verdict,
      confidence,
      overall_score: overallScore,
      dimension_scores: dimensionScores,
      failure_modes: failureModes,
      rationale,
      evidence_spans: evidenceSpans,
    },
    caseEntry,
    allowedDimensions,
    reviewerRole
  );
}

function extractFirstJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }
  return null;
}

function extractJudgeVerdict(text: string): BenchmarkJudgeVerdict | null {
  const match = text.match(/verdict[^a-z]*(pass|fail|abstain)\b/i) ?? text.match(/\b(pass|fail|abstain)\b/i);
  if (!match) return null;
  const verdict = match[1]?.toLowerCase();
  if (verdict === 'pass' || verdict === 'fail' || verdict === 'abstain') return verdict;
  return null;
}

function extractJudgeNumeric(text: string, keys: string[], fallback: number): number {
  for (const key of keys) {
    const pattern = new RegExp(`${key}[^0-9\\n-]*([0-9]*\\.?[0-9]+)`, 'i');
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) return clamp01(parsed);
  }
  return clamp01(fallback);
}

function extractDimensionScores(
  text: string,
  allowedDimensions: string[],
  targetDimension: string | undefined,
  overallScore: number
): Record<string, number> {
  const permitted = new Set(
    [...allowedDimensions, targetDimension].filter((value): value is string => Boolean(value))
  );
  const result: Record<string, number> = {};
  const section = extractSection(text, 'dimension_scores') ?? text;
  for (const line of section.split('\n')) {
    const match = line.match(/([a-z_][a-z0-9_]*)\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
    if (!match) continue;
    const key = match[1];
    if (permitted.size > 0 && !permitted.has(key)) continue;
    result[key] = clamp01(Number(match[2]));
  }
  if (Object.keys(result).length === 0 && targetDimension) {
    result[targetDimension] = clamp01(overallScore);
  }
  return result;
}

function extractStringList(text: string, field: string): string[] {
  const section = extractSection(text, field);
  if (!section) return [];
  const bracketMatch = section.match(/\[([\s\S]*?)\]/);
  if (bracketMatch) {
    try {
      const parsed = JSON.parse(`[${bracketMatch[1]}]`) as unknown[];
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 6);
    } catch {
      const quoted = [...bracketMatch[1].matchAll(/"([^"]+)"|'([^']+)'/g)]
        .map((match) => (match[1] ?? match[2] ?? '').trim())
        .filter(Boolean);
      if (quoted.length > 0) {
        return quoted.slice(0, 6);
      }
    }
  }
  return section
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function extractSection(text: string, field: string): string | null {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `${escapedField}\\s*[:=]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[A-Za-z_][A-Za-z0-9_]*|\\d+\\.)\\s*[:=]|$)`,
    'i'
  );
  const match = text.match(pattern);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function alignCasesWithTraces(pack: LoadedBenchmarkPack, traces: BenchmarkRunCaseTrace[]): Array<{
  caseEntry: BenchmarkPackCase;
  label?: BenchmarkPackLabel;
  trace?: BenchmarkRunCaseTrace;
}> {
  const traceByRoundOrdinal = new Map<string, BenchmarkRunCaseTrace>();
  const traceByPrompt = new Map<string, BenchmarkRunCaseTrace>();
  for (const trace of traces) {
    traceByRoundOrdinal.set(`${trace.round}:${trace.ordinal}`, trace);
    traceByPrompt.set(normalizePrompt(trace.question), trace);
  }
  const labelByCaseId = new Map(pack.labels.map((label) => [label.case_id, label]));

  return pack.cases.map((caseEntry) => ({
    caseEntry,
    label: labelByCaseId.get(caseEntry.case_id),
    trace:
      traceByRoundOrdinal.get(`${caseEntry.round ?? 1}:${caseEntry.ordinal ?? 1}`) ??
      traceByPrompt.get(normalizePrompt(caseEntry.prompt)),
  }));
}

function normalizeBenchmarkJudgeReview(
  raw: BenchmarkJudgeSchemaOutput,
  caseEntry: BenchmarkPackCase,
  allowedDimensions: string[],
  reviewerRole: 'primary' | 'secondary'
): BenchmarkJudgeReview {
  const permitted = new Set([
    ...allowedDimensions,
    caseEntry.target_dimension,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0));
  const normalizedDimensions = Object.fromEntries(
    Object.entries(raw.dimension_scores ?? {})
      .filter(([key]) => permitted.size === 0 || permitted.has(key))
      .map(([key, value]) => [key, clamp01(value)])
  );
  if (Object.keys(normalizedDimensions).length === 0 && caseEntry.target_dimension) {
    normalizedDimensions[caseEntry.target_dimension] = clamp01(raw.overall_score);
  }

  return {
    judge_role: reviewerRole,
    verdict: raw.verdict,
    confidence: clamp01(raw.confidence),
    overall_score: clamp01(raw.overall_score),
    dimension_scores: normalizedDimensions,
    failure_modes: uniqueStrings(raw.failure_modes),
    rationale: String(raw.rationale ?? '').trim() || `${reviewerRole} judge returned no rationale`,
    evidence_spans: uniqueStrings(raw.evidence_spans).slice(0, 4),
  };
}

function adjudicateBenchmarkJudgment(input: {
  caseEntry: BenchmarkPackCase;
  primary: BenchmarkJudgeReview;
  secondary: BenchmarkJudgeReview;
  disagreementThreshold: number;
}): BenchmarkCaseJudgment {
  const verdictConflict = input.primary.verdict !== input.secondary.verdict;
  const highDelta = Math.abs(input.primary.overall_score - input.secondary.overall_score) >= input.disagreementThreshold;

  if (!verdictConflict && !highDelta) {
    const selected = pickPreferredJudge(input.primary, input.secondary);
    return {
      case_id: input.caseEntry.case_id,
      pass: selected.verdict === 'pass',
      abstained: selected.verdict === 'abstain',
      confidence: selected.confidence,
      overall_score: selected.overall_score,
      dimension_scores: selected.dimension_scores,
      primary_verdict: selected.verdict,
      failure_modes: uniqueStrings([...input.primary.failure_modes, ...input.secondary.failure_modes]),
      rationale: selected.rationale,
      evidence_spans: uniqueStrings([...input.primary.evidence_spans, ...input.secondary.evidence_spans]).slice(0, 4),
      disputed: false,
      resolution: 'judge_agreement',
      primary: input.primary,
      secondary: input.secondary,
      trace_status: 'matched',
    };
  }

  if (input.primary.verdict === 'abstain' && input.secondary.verdict !== 'abstain' && input.secondary.confidence >= 0.65) {
    return buildDisputedJudgment(input.caseEntry.case_id, input.primary, input.secondary, false, 'accept_secondary_confident');
  }
  if (input.secondary.verdict === 'abstain' && input.primary.verdict !== 'abstain' && input.primary.confidence >= 0.65) {
    return buildDisputedJudgment(input.caseEntry.case_id, input.primary, input.secondary, false, 'accept_primary_confident');
  }

  return buildDisputedJudgment(input.caseEntry.case_id, input.primary, input.secondary, true, 'material_conflict');
}

function buildDisputedJudgment(
  caseId: string,
  primary: BenchmarkJudgeReview,
  secondary: BenchmarkJudgeReview,
  disputed: boolean,
  resolution: Exclude<BenchmarkJudgeResolution, 'single_judge' | 'judge_agreement'>
): BenchmarkCaseJudgment {
  const selected = pickPreferredJudge(primary, secondary);
  return {
    case_id: caseId,
    pass: selected.verdict === 'pass',
    abstained: selected.verdict === 'abstain',
    confidence: disputed ? clamp01(selected.confidence * 0.72) : selected.confidence,
    overall_score: selected.overall_score,
    dimension_scores: selected.dimension_scores,
    primary_verdict: selected.verdict,
    failure_modes: uniqueStrings([...primary.failure_modes, ...secondary.failure_modes]),
    rationale: `${selected.rationale}${disputed ? ' [disputed]' : ''}`,
    evidence_spans: uniqueStrings([...primary.evidence_spans, ...secondary.evidence_spans]).slice(0, 4),
    disputed,
    resolution,
    primary,
    secondary,
    trace_status: 'matched',
  };
}

function buildMissingTraceJudgment(caseEntry: BenchmarkPackCase, label?: BenchmarkPackLabel): BenchmarkCaseJudgment {
  const review: BenchmarkJudgeReview = {
    judge_role: 'primary',
    verdict: 'abstain',
    confidence: 0.05,
    overall_score: 0,
    dimension_scores: caseEntry.target_dimension ? { [caseEntry.target_dimension]: 0 } : {},
    failure_modes: ['missing_trace'],
    rationale: `Benchmark case trace missing for ${caseEntry.case_id}${label ? '' : ' (no label found)'}.`,
    evidence_spans: [],
  };
  return {
    case_id: caseEntry.case_id,
    pass: false,
    abstained: true,
    confidence: review.confidence,
    overall_score: review.overall_score,
    dimension_scores: review.dimension_scores,
    primary_verdict: review.verdict,
    failure_modes: review.failure_modes,
    rationale: review.rationale,
    evidence_spans: review.evidence_spans,
    disputed: false,
    resolution: 'single_judge',
    primary: review,
    secondary: null,
    trace_status: 'missing',
  };
}

function buildJudgeFallback(
  caseEntry: BenchmarkPackCase,
  response: string,
  reviewerRole: 'primary' | 'secondary',
  error: unknown
): BenchmarkJudgeReview {
  const trimmed = String(response ?? '').trim();
  const hasSignal = trimmed.length >= 80;
  return {
    judge_role: reviewerRole,
    verdict: hasSignal ? 'abstain' : 'fail',
    confidence: hasSignal ? 0.2 : 0.35,
    overall_score: hasSignal ? 0.4 : 0.15,
    dimension_scores: caseEntry.target_dimension
      ? { [caseEntry.target_dimension]: hasSignal ? 0.4 : 0.15 }
      : {},
    failure_modes: ['judge_fallback'],
    rationale: `Benchmark judge fallback (${reviewerRole}): ${String(error ?? 'unknown error').slice(0, 160)}`,
    evidence_spans: trimmed ? [trimmed.slice(0, 120)] : [],
  };
}

function pickPreferredJudge(primary: BenchmarkJudgeReview, secondary: BenchmarkJudgeReview): BenchmarkJudgeReview {
  if (secondary.confidence > primary.confidence) return secondary;
  if (secondary.confidence === primary.confidence && secondary.overall_score > primary.overall_score) return secondary;
  return primary;
}

function summarizeBenchmarkJudgeDisagreement(
  judgments: BenchmarkCaseJudgment[],
  options: { dualJudge: boolean; disagreementThreshold: number }
): BenchmarkJudgeDisagreement {
  const withSecondary = judgments.filter((item) => item.secondary);
  const verdictConflicts = withSecondary.filter((item) => item.primary.verdict !== item.secondary?.verdict).length;
  const highDeltaCases = withSecondary
    .filter((item) => Math.abs(item.primary.overall_score - (item.secondary?.overall_score ?? item.primary.overall_score)) >= options.disagreementThreshold)
    .map((item) => item.case_id);
  const disputedCaseIds = judgments.filter((item) => item.disputed).map((item) => item.case_id);

  return {
    active: options.dualJudge,
    judge_count: options.dualJudge ? 2 : 1,
    disagreement_rate: withSecondary.length === 0 ? 0 : disputedCaseIds.length / withSecondary.length,
    verdict_conflicts: verdictConflicts,
    high_delta_cases: highDeltaCases,
    disputed_case_ids: disputedCaseIds,
  };
}

function buildBenchmarkCaseSummary(judgments: BenchmarkCaseJudgment[]): BenchmarkCaseSummary {
  return {
    case_count: judgments.length,
    judged_case_count: judgments.filter((item) => item.trace_status === 'matched').length,
    pass_count: judgments.filter((item) => item.pass).length,
    fail_count: judgments.filter((item) => !item.pass && !item.abstained).length,
    abstained_count: judgments.filter((item) => item.abstained).length,
    disputed_case_count: judgments.filter((item) => item.disputed).length,
    missing_trace_count: judgments.filter((item) => item.trace_status === 'missing').length,
  };
}

function buildBenchmarkScorecard(judgments: BenchmarkCaseJudgment[], preferredDimensions: string[]): BenchmarkScorecard {
  const dimensionBuckets = new Map<string, number[]>();
  for (const dimension of preferredDimensions) {
    dimensionBuckets.set(dimension, []);
  }
  for (const judgment of judgments) {
    for (const [key, value] of Object.entries(judgment.dimension_scores)) {
      const bucket = dimensionBuckets.get(key) ?? [];
      bucket.push(clamp01(value));
      dimensionBuckets.set(key, bucket);
    }
  }

  const dimensionScores = Object.fromEntries(
    [...dimensionBuckets.entries()]
      .filter(([, values]) => values.length > 0)
      .map(([key, values]) => [key, average(values)])
  );
  const overall = judgments.length === 0 ? 0 : average(judgments.map((item) => item.overall_score));
  const passRate = judgments.length === 0 ? 0 : judgments.filter((item) => item.pass).length / judgments.length;
  const abstainRate = judgments.length === 0 ? 0 : judgments.filter((item) => item.abstained).length / judgments.length;
  const disputedRate = judgments.length === 0 ? 0 : judgments.filter((item) => item.disputed).length / judgments.length;

  return {
    version: 'benchmark-scorecard-v1',
    summary: 'P1 benchmark scorecard aggregated from case-level benchmark judge outputs.',
    overall,
    pass_rate: passRate,
    abstain_rate: abstainRate,
    disputed_rate: disputedRate,
    case_count: judgments.length,
    dimension_scores: dimensionScores,
  };
}

function buildBenchmarkJudgeSummary(
  pack: { pack_id: string; pack_version: string },
  judgeMode: BenchmarkJudgeMode,
  scorecard: BenchmarkScorecard,
  caseSummary: BenchmarkCaseSummary,
  disagreement: BenchmarkJudgeDisagreement
): BenchmarkJudgeSummary {
  return {
    version: 'benchmark-judge-summary-v1',
    judge_mode: judgeMode,
    pack_id: pack.pack_id,
    pack_version: pack.pack_version,
    case_count: caseSummary.case_count,
    judged_case_count: caseSummary.judged_case_count,
    disputed_case_count: caseSummary.disputed_case_count,
    pass_rate: scorecard.pass_rate,
    overall: scorecard.overall,
    disagreement,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizePrompt(value: string): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

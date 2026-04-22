import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import type { TrainingQuestion } from './types.js';
import type {
  BenchmarkCaseEntry,
  BenchmarkCaseManifest,
  BenchmarkContext,
  FrozenBenchmarkCaseManifest,
} from './evaluation-v2.js';

export type BenchmarkPackManifestVersion = 'benchmark-pack-registry-v1';
export type BenchmarkPackSuiteType = 'official_benchmark';
export type BenchmarkPackSuiteTier = 'official';
export type BenchmarkPackStatus = 'draft' | 'candidate' | 'official';
export type BenchmarkPackSourceKind = 'registry' | 'path';

export interface BenchmarkPackDefinition {
  pack_id: string;
  pack_version: string;
  manifest_version: BenchmarkPackManifestVersion;
  suite_type: BenchmarkPackSuiteType;
  suite_tier: BenchmarkPackSuiteTier;
  domain: string;
  description: string;
  owner?: string;
  status?: BenchmarkPackStatus;
  replayable?: boolean;
  default_replicas?: number;
  min_clean_replicas?: number;
  significance_method?: string;
  dimensions?: string[];
}

export interface BenchmarkPackCase {
  case_id: string;
  prompt: string;
  strategy: TrainingQuestion['strategy'];
  target_dimension: TrainingQuestion['target_dimension'];
  difficulty?: TrainingQuestion['expected_challenge_level'];
  expected_challenge_level?: TrainingQuestion['expected_challenge_level'];
  round?: number;
  ordinal?: number;
  tags?: string[];
  expected_failure_modes?: string[];
  evaluation_mode?: string;
}

export interface BenchmarkPackLabel {
  case_id: string;
  expected_outcome?: Record<string, unknown>;
  golden_reference?: Record<string, unknown>;
  label_source?: string;
  label_version?: string;
}

export interface BenchmarkPackSource {
  kind: BenchmarkPackSourceKind;
  input: string;
  resolved_directory: string;
  resolved_pack_path: string;
  resolved_cases_path: string;
  resolved_labels_path?: string;
}

export interface BenchmarkPackSummary {
  pack_id: string;
  pack_version: string;
  manifest_version: BenchmarkPackManifestVersion;
  suite_type: BenchmarkPackSuiteType;
  suite_tier: BenchmarkPackSuiteTier;
  status: BenchmarkPackStatus;
  replayable: boolean;
  case_count: number;
  label_count: number;
  source_kind: BenchmarkPackSourceKind;
  source_input: string;
  resolved_pack_path: string;
}

export interface LoadedBenchmarkPack {
  definition: BenchmarkPackDefinition;
  pack: BenchmarkPackDefinition;
  cases: BenchmarkPackCase[];
  labels: BenchmarkPackLabel[];
  frozen_manifest: FrozenBenchmarkCaseManifest;
  benchmark_context: BenchmarkContext;
  question_rounds: TrainingQuestion[][];
  source: BenchmarkPackSource;
  summary: BenchmarkPackSummary;
}

export function loadBenchmarkPack(
  spec:
    | string
    | {
      packIdOrPath?: string;
      pack?: string;
      idOrPath?: string;
      registryRoot?: string;
      repoRoot?: string;
    },
  options?: {
    repoRoot?: string;
  }
): LoadedBenchmarkPack {
  const normalized = normalizePackSpec(spec);
  const repoRoot = resolveRepositoryRoot(normalized.repoRoot ?? options?.repoRoot ?? process.cwd());
  const source = resolveBenchmarkPackSource(normalized.spec, normalized.registryRoot ?? repoRoot);
  const definition = parsePackDefinition(source.resolved_pack_path);
  const cases = parsePackCases(source.resolved_cases_path);
  const labels = parsePackLabels(source.resolved_labels_path, cases);
  const frozenManifest = buildPackFrozenManifest(definition, cases);
  const questionRounds = toPackQuestionRounds(cases, frozenManifest.manifest.manifest_id);
  const questionsPerRound = questionRounds.reduce((best, round) => Math.max(best, round.length), 0);

  const benchmarkContext: BenchmarkContext = {
    pack_id: definition.pack_id,
    pack_type: 'official',
    suite_type: 'official_benchmark',
    suite_tier: 'official',
    case_count: cases.length,
    rounds: questionRounds.length,
    questions_per_round: Math.max(1, questionsPerRound),
    case_distribution: {
      official_pack_cases: cases.length,
      labeled_cases: labels.length,
    },
    case_manifest: frozenManifest.manifest,
  };

  return {
    definition,
    pack: definition,
    cases,
    labels,
    frozen_manifest: frozenManifest,
    benchmark_context: benchmarkContext,
    question_rounds: questionRounds,
    source,
    summary: {
      pack_id: definition.pack_id,
      pack_version: definition.pack_version,
      manifest_version: definition.manifest_version,
      suite_type: definition.suite_type,
      suite_tier: definition.suite_tier,
      status: definition.status ?? 'draft',
      replayable: definition.replayable !== false,
      case_count: cases.length,
      label_count: labels.length,
      source_kind: source.kind,
      source_input: normalized.spec,
      resolved_pack_path: source.resolved_pack_path,
    },
  };
}

export function validateBenchmarkPack(
  pack: LoadedBenchmarkPack | { pack?: LoadedBenchmarkPack }
): LoadedBenchmarkPack {
  const normalized = isLoadedBenchmarkPack(pack) ? pack : pack?.pack;
  if (!normalized?.definition?.pack_id) {
    throw new Error('benchmark pack definition.pack_id is required');
  }
  if (!Array.isArray(normalized.cases) || normalized.cases.length === 0) {
    throw new Error(`benchmark pack "${normalized.definition.pack_id}" must contain at least one case`);
  }
  const caseIds = new Set(normalized.cases.map((item) => item.case_id));
  if (caseIds.size !== normalized.cases.length) {
    throw new Error(`benchmark pack "${normalized.definition.pack_id}" contains duplicate case ids`);
  }
  for (const label of normalized.labels) {
    if (!caseIds.has(label.case_id)) {
      throw new Error(
        `benchmark pack "${normalized.definition.pack_id}" contains label for unknown case_id "${label.case_id}"`
      );
    }
  }
  return normalized;
}

export const __benchmarkPackTestables = {
  resolveBenchmarkPackSource,
  parsePackDefinition,
  parsePackCases,
  parsePackLabels,
  toPackQuestionRounds,
};

function normalizePackSpec(
  spec:
    | string
    | {
      packIdOrPath?: string;
      pack?: string;
      idOrPath?: string;
      registryRoot?: string;
      repoRoot?: string;
    }
): { spec: string; registryRoot?: string; repoRoot?: string } {
  if (typeof spec === 'string') {
    return { spec };
  }
  const resolvedSpec = spec?.packIdOrPath ?? spec?.pack ?? spec?.idOrPath;
  if (!resolvedSpec || typeof resolvedSpec !== 'string') {
    throw new Error('official benchmark pack spec must not be empty');
  }
  return {
    spec: resolvedSpec,
    registryRoot: spec.registryRoot,
    repoRoot: spec.repoRoot,
  };
}

function isLoadedBenchmarkPack(value: unknown): value is LoadedBenchmarkPack {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'definition' in value &&
    'cases' in value &&
    'labels' in value
  );
}

function resolveBenchmarkPackSource(spec: string, repoRoot: string): BenchmarkPackSource {
  const trimmed = String(spec ?? '').trim();
  if (!trimmed) {
    throw new Error('official benchmark pack spec must not be empty');
  }

  const treatAsPath =
    isAbsolute(trimmed) ||
    trimmed.startsWith('.') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.endsWith('.json');
  const candidatePath = treatAsPath
    ? resolve(repoRoot, trimmed)
    : existsSync(join(repoRoot, trimmed))
      ? join(repoRoot, trimmed)
      : join(repoRoot, 'benchmarks', 'packs', trimmed);

  if (!existsSync(candidatePath)) {
    if (!treatAsPath) {
      throw new Error(`official benchmark pack "${trimmed}" not found at ${join(repoRoot, 'benchmarks', 'packs', trimmed)}`);
    }
    throw new Error(`official benchmark pack path not found: ${candidatePath}`);
  }

  const stats = statSync(candidatePath);
  const resolvedPackPath = stats.isDirectory() ? join(candidatePath, 'pack.json') : candidatePath;
  const resolvedDirectory = stats.isDirectory() ? candidatePath : dirname(candidatePath);
  const resolvedCasesPath = join(resolvedDirectory, 'cases.jsonl');
  const resolvedLabelsPath = join(resolvedDirectory, 'labels.jsonl');

  if (!existsSync(resolvedPackPath)) {
    throw new Error(`official benchmark pack.json not found: ${resolvedPackPath}`);
  }
  if (!existsSync(resolvedCasesPath)) {
    throw new Error(`official benchmark cases.jsonl not found: ${resolvedCasesPath}`);
  }

  return {
    kind: treatAsPath ? 'path' : 'registry',
    input: trimmed,
    resolved_directory: resolvedDirectory,
    resolved_pack_path: resolvedPackPath,
    resolved_cases_path: resolvedCasesPath,
    resolved_labels_path: existsSync(resolvedLabelsPath) ? resolvedLabelsPath : undefined,
  };
}

function resolveRepositoryRoot(startPath: string): string {
  let current = resolve(startPath);
  const visited = new Set<string>();

  while (!visited.has(current)) {
    visited.add(current);
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return resolve(startPath);
}

function parsePackDefinition(packPath: string): BenchmarkPackDefinition {
  const parsed = JSON.parse(readFileSync(packPath, 'utf-8')) as Record<string, unknown>;
  const pack_id = readRequiredString(parsed.pack_id, `${packPath}: pack_id`);
  const pack_version = readRequiredString(parsed.pack_version, `${packPath}: pack_version`);
  const manifest_version = readRequiredString(parsed.manifest_version, `${packPath}: manifest_version`);
  const suite_type = readRequiredString(parsed.suite_type, `${packPath}: suite_type`);
  const suite_tier = readRequiredString(parsed.suite_tier, `${packPath}: suite_tier`);
  const domain = readRequiredString(parsed.domain, `${packPath}: domain`);
  const description = readRequiredString(parsed.description, `${packPath}: description`);

  if (manifest_version !== 'benchmark-pack-registry-v1') {
    throw new Error(`${packPath}: unsupported manifest_version "${manifest_version}"`);
  }
  if (suite_type !== 'official_benchmark') {
    throw new Error(`${packPath}: suite_type must be "official_benchmark"`);
  }
  if (suite_tier !== 'official') {
    throw new Error(`${packPath}: suite_tier must be "official"`);
  }

  const status = parsed.status === undefined ? 'draft' : readRequiredString(parsed.status, `${packPath}: status`);
  if (status !== 'draft' && status !== 'candidate' && status !== 'official') {
    throw new Error(`${packPath}: unsupported status "${status}"`);
  }

  return {
    pack_id,
    pack_version,
    manifest_version: 'benchmark-pack-registry-v1',
    suite_type: 'official_benchmark',
    suite_tier: 'official',
    domain,
    description,
    owner: readOptionalString(parsed.owner),
    status,
    replayable: parsed.replayable === undefined ? true : readRequiredBoolean(parsed.replayable, `${packPath}: replayable`),
    default_replicas:
      parsed.default_replicas === undefined ? undefined : readPositiveInteger(parsed.default_replicas, `${packPath}: default_replicas`),
    min_clean_replicas:
      parsed.min_clean_replicas === undefined
        ? undefined
        : readPositiveInteger(parsed.min_clean_replicas, `${packPath}: min_clean_replicas`),
    significance_method: readOptionalString(parsed.significance_method),
    dimensions: readOptionalStringArray(parsed.dimensions, `${packPath}: dimensions`),
  };
}

function parsePackCases(casesPath: string): BenchmarkPackCase[] {
  const rows = parseJsonLines(casesPath);
  if (rows.length === 0) {
    throw new Error(`${casesPath}: expected at least one case`);
  }

  const seenIds = new Set<string>();
  const nextOrdinalByRound = new Map<number, number>();
  const occupiedOrdinals = new Set<string>();

  return rows.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${casesPath}:${index + 1}: case must be a JSON object`);
    }
    const record = raw as Record<string, unknown>;
    const case_id = readRequiredString(record.case_id, `${casesPath}:${index + 1}: case_id`);
    if (seenIds.has(case_id)) {
      throw new Error(`${casesPath}:${index + 1}: duplicate case_id "${case_id}"`);
    }
    seenIds.add(case_id);

    const round = record.round === undefined ? 1 : readPositiveInteger(record.round, `${casesPath}:${index + 1}: round`);
    const ordinal = record.ordinal === undefined
      ? nextOrdinalByRound.get(round) ?? 1
      : readPositiveInteger(record.ordinal, `${casesPath}:${index + 1}: ordinal`);
    nextOrdinalByRound.set(round, ordinal + 1);

    const ordinalKey = `${round}:${ordinal}`;
    if (occupiedOrdinals.has(ordinalKey)) {
      throw new Error(`${casesPath}:${index + 1}: duplicate round/ordinal "${ordinalKey}"`);
    }
    occupiedOrdinals.add(ordinalKey);

    const strategy = readRequiredString(record.strategy, `${casesPath}:${index + 1}: strategy`);
    const targetDimension = readRequiredString(record.target_dimension, `${casesPath}:${index + 1}: target_dimension`);
    const challengeLevel = record.expected_challenge_level ?? record.difficulty ?? 'medium';

    return {
      case_id,
      prompt: readRequiredString(record.prompt, `${casesPath}:${index + 1}: prompt`),
      strategy: asQuestionStrategy(strategy, `${casesPath}:${index + 1}`),
      target_dimension: asTargetDimension(targetDimension, `${casesPath}:${index + 1}`),
      difficulty: asChallengeLevel(challengeLevel, `${casesPath}:${index + 1}: difficulty`),
      expected_challenge_level: asChallengeLevel(challengeLevel, `${casesPath}:${index + 1}: expected_challenge_level`),
      round,
      ordinal,
      tags: readOptionalStringArray(record.tags, `${casesPath}:${index + 1}: tags`),
      expected_failure_modes: readOptionalStringArray(
        record.expected_failure_modes,
        `${casesPath}:${index + 1}: expected_failure_modes`
      ),
      evaluation_mode: readOptionalString(record.evaluation_mode),
    };
  });
}

function parsePackLabels(labelsPath: string | undefined, cases: BenchmarkPackCase[]): BenchmarkPackLabel[] {
  if (!labelsPath) return [];
  const rows = parseJsonLines(labelsPath);
  const knownCaseIds = new Set(cases.map((item) => item.case_id));
  const seenCaseIds = new Set<string>();

  return rows.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${labelsPath}:${index + 1}: label must be a JSON object`);
    }
    const record = raw as Record<string, unknown>;
    const case_id = readRequiredString(record.case_id, `${labelsPath}:${index + 1}: case_id`);
    if (!knownCaseIds.has(case_id)) {
      throw new Error(`${labelsPath}:${index + 1}: label references unknown case_id "${case_id}"`);
    }
    if (seenCaseIds.has(case_id)) {
      throw new Error(`${labelsPath}:${index + 1}: duplicate case_id "${case_id}"`);
    }
    seenCaseIds.add(case_id);

    return {
      case_id,
      expected_outcome:
        record.expected_outcome && typeof record.expected_outcome === 'object' && !Array.isArray(record.expected_outcome)
          ? (record.expected_outcome as Record<string, unknown>)
          : undefined,
      golden_reference:
        record.golden_reference && typeof record.golden_reference === 'object' && !Array.isArray(record.golden_reference)
          ? (record.golden_reference as Record<string, unknown>)
          : undefined,
      label_source: readOptionalString(record.label_source),
      label_version: readOptionalString(record.label_version),
    };
  });
}

function buildPackFrozenManifest(
  definition: BenchmarkPackDefinition,
  cases: BenchmarkPackCase[]
): FrozenBenchmarkCaseManifest {
  const manifestSeed = {
    pack_id: definition.pack_id,
    pack_version: definition.pack_version,
    cases: cases.map((item) => ({
      case_id: item.case_id,
      prompt: item.prompt,
      strategy: item.strategy,
      target_dimension: item.target_dimension,
      expected_challenge_level: item.expected_challenge_level,
      round: item.round ?? 1,
      ordinal: item.ordinal ?? 1,
    })),
  };
  const questionDigest = stableDigest(manifestSeed.cases);
  const packDigest = stableDigest(manifestSeed);
  const manifest: BenchmarkCaseManifest = {
    manifest_id: `official_benchmark:${definition.pack_id}:${packDigest}`,
    manifest_version: 'benchmark-case-manifest-v2',
    pack_version: definition.pack_version,
    recipe_version: 'training-question-recipe-v1',
    suite_label: `official_benchmark:${definition.pack_id}`,
    suite_tier: 'official',
    flavor: definition.pack_id,
    replayable: definition.replayable !== false,
    replay_mode: 'recipe_only',
    freeze_level: 'frozen_cases',
    case_manifest_hash: stableDigest({
      manifest_seed: manifestSeed,
      labels_expected: true,
    }),
    question_digest: questionDigest,
    case_count: cases.length,
    provider_fingerprint: `provider-static-${packDigest}`,
    runtime_fingerprint: `runtime-static-${packDigest}`,
    judge_fingerprint: `judge-static-${packDigest}`,
  };

  const manifestCases: BenchmarkCaseEntry[] = cases.map((item) => ({
    case_id: item.case_id,
    round: item.round ?? 1,
    ordinal: item.ordinal ?? 1,
    question: item.prompt,
    strategy: item.strategy,
    target_dimension: item.target_dimension,
    expected_challenge_level: item.expected_challenge_level ?? item.difficulty ?? 'medium',
  }));

  return {
    manifest,
    cases: manifestCases,
  };
}

function toPackQuestionRounds(
  cases: BenchmarkPackCase[],
  manifestId: string
): TrainingQuestion[][] {
  const grouped = new Map<number, Array<{ ordinal: number; question: TrainingQuestion }>>();
  for (const item of cases) {
    const round = item.round ?? 1;
    const ordinal = item.ordinal ?? 1;
    const entries = grouped.get(round) ?? [];
    entries.push({
      ordinal,
      question: {
        question: item.prompt,
        strategy: item.strategy,
        target_dimension: item.target_dimension,
        expected_challenge_level: item.expected_challenge_level ?? item.difficulty ?? 'medium',
      },
    });
    grouped.set(round, entries);
  }

  const rounds = [...grouped.keys()].sort((left, right) => left - right);
  for (let index = 0; index < rounds.length; index += 1) {
    if (rounds[index] !== index + 1) {
      throw new Error(`official benchmark pack "${manifestId}" must use contiguous round ids starting at 1`);
    }
  }

  return rounds.map((round) =>
    (grouped.get(round) ?? [])
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((item) => ({ ...item.question }))
  );
}

function parseJsonLines(path: string): unknown[] {
  const content = readFileSync(path, 'utf-8');
  return content
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((item) => item.line.length > 0)
    .map((item) => {
      try {
        return JSON.parse(item.line);
      } catch (error) {
        throw new Error(`${path}:${item.index + 1}: invalid JSONL entry (${String(error)})`);
      }
    });
}

function readRequiredString(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function readRequiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function readOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value.map((item, index) => readRequiredString(item, `${label}[${index}]`));
}

function asQuestionStrategy(value: string, label: string): TrainingQuestion['strategy'] {
  if (value === 'blind_spot' || value === 'stress_test' || value === 'consistency' || value === 'scenario') {
    return value;
  }
  throw new Error(`${label} has unsupported strategy "${value}"`);
}

function asTargetDimension(value: string, label: string): TrainingQuestion['target_dimension'] {
  if (
    value === 'language_style' ||
    value === 'values' ||
    value === 'thinking_patterns' ||
    value === 'behavioral_traits' ||
    value === 'knowledge_domains' ||
    value === 'general'
  ) {
    return value;
  }
  throw new Error(`${label} has unsupported target_dimension "${value}"`);
}

function asChallengeLevel(value: unknown, label: string): TrainingQuestion['expected_challenge_level'] {
  if (value === 'easy' || value === 'medium' || value === 'hard') {
    return value;
  }
  throw new Error(`${label} must be one of easy|medium|hard`);
}

function stableDigest(value: unknown): string {
  return createHash('sha1')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 12);
}

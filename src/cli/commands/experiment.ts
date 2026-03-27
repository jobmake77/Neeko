import chalk from 'chalk';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { Persona } from '../../core/models/persona.js';
import { Soul } from '../../core/models/soul.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop } from '../../core/training/loop.js';
import { TrainingProfile } from '../../core/training/types.js';

const PROFILES: TrainingProfile[] = ['baseline', 'a1', 'a2', 'a3', 'a4', 'full'];

export async function cmdExperiment(
  slug: string,
  options: {
    rounds?: string;
    outputDir?: string;
    gate?: boolean;
    maxQualityDrop?: string;
    maxContradictionRise?: string;
    maxDuplicationRise?: string;
  }
): Promise<void> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const soulPath = join(dir, 'soul.yaml');

  if (!existsSync(personaPath) || !existsSync(soulPath)) {
    console.error(chalk.red(`✗ Persona "${slug}" not found.`));
    process.exit(1);
  }

  const basePersona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const baseSoul = yaml.load(readFileSync(soulPath, 'utf-8')) as Soul;
  const rounds = Math.max(1, parseInt(options.rounds ?? '10', 10));
  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });

  console.log(chalk.bold.cyan(`\n✦ Training Experiment (${slug})\n`));
  console.log(chalk.dim(`Rounds per profile: ${rounds}`));
  console.log(chalk.dim(`Profiles: ${PROFILES.join(', ')}\n`));

  const stamp = Date.now().toString(36);
  const rows: Array<{
    profile: TrainingProfile;
    totalRounds: number;
    avgQuality: number;
    contradictionRate: number;
    duplicationRate: number;
    coverage: number;
  }> = [];
  const roundHistories: Record<string, Array<{
    round: number;
    avgQualityScore: number;
    contradictionRate: number;
    duplicationRate: number;
    nodesWritten: number;
    nodesReinforced: number;
  }>> = {};

  for (const profile of PROFILES) {
    const persona: Persona = {
      ...basePersona,
      id: crypto.randomUUID(),
      memory_collection: `${basePersona.memory_collection}_exp_${profile}_${stamp}`,
      training_rounds: 0,
      updated_at: new Date().toISOString(),
    };
    const soul: Soul = JSON.parse(JSON.stringify(baseSoul));
    soul.training_rounds_completed = 0;

    await store.ensureCollection(persona.memory_collection);

    const loop = new TrainingLoop(soul, persona, store);
    const result = await loop.run({ maxRounds: rounds, profile });
    const history = result.history;
    roundHistories[profile] = history.map((h) => ({
      round: h.round,
      avgQualityScore: h.avgQualityScore,
      contradictionRate: h.observability.contradictionRate,
      duplicationRate: h.observability.duplicationRate,
      nodesWritten: h.nodesWritten,
      nodesReinforced: h.nodesReinforced,
    }));
    const avgQuality = history.length === 0
      ? 0
      : history.reduce((sum, h) => sum + h.avgQualityScore, 0) / history.length;
    const contradictionRate = history.length === 0
      ? 0
      : history.reduce((sum, h) => sum + h.observability.contradictionRate, 0) / history.length;
    const duplicationRate = history.length === 0
      ? 0
      : history.reduce((sum, h) => sum + h.observability.duplicationRate, 0) / history.length;
    rows.push({
      profile,
      totalRounds: result.totalRounds,
      avgQuality,
      contradictionRate,
      duplicationRate,
      coverage: result.soul.coverage_score,
    });

    console.log(
      `${chalk.bold(profile.padEnd(8))} rounds=${String(result.totalRounds).padEnd(3)} ` +
      `quality=${(avgQuality * 100).toFixed(1).padStart(5)}% ` +
      `contra=${(contradictionRate * 100).toFixed(1).padStart(5)}% ` +
      `dup=${(duplicationRate * 100).toFixed(1).padStart(5)}% ` +
      `coverage=${(result.soul.coverage_score * 100).toFixed(1).padStart(5)}%`
    );
  }

  const best = [...rows].sort((a, b) => {
    const scoreA = a.avgQuality - a.contradictionRate * 0.2 - a.duplicationRate * 0.1;
    const scoreB = b.avgQuality - b.contradictionRate * 0.2 - b.duplicationRate * 0.1;
    return scoreB - scoreA;
  })[0];

  const outputDir = options.outputDir
    ? options.outputDir
    : join(settings.getPersonaDir(slug), 'experiments');
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outputDir, `experiment-${slug}-${timestamp}.json`);
  const csvPath = join(outputDir, `experiment-${slug}-${timestamp}.csv`);

  const gateResult = evaluateGate(rows, {
    enabled: options.gate === true,
    maxQualityDrop: parseFloat(options.maxQualityDrop ?? '0.02'),
    maxContradictionRise: parseFloat(options.maxContradictionRise ?? '0.03'),
    maxDuplicationRise: parseFloat(options.maxDuplicationRise ?? '0.05'),
  });

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    slug,
    rounds_per_profile: rounds,
    profiles: PROFILES,
    summary_rows: rows,
    best_profile: best.profile,
    round_histories: roundHistories,
    gate_result: gateResult,
  };
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  const csvLines = [
    'profile,total_rounds,avg_quality,avg_contradiction_rate,avg_duplication_rate,coverage',
    ...rows.map((r) =>
      [
        r.profile,
        r.totalRounds,
        r.avgQuality.toFixed(6),
        r.contradictionRate.toFixed(6),
        r.duplicationRate.toFixed(6),
        r.coverage.toFixed(6),
      ].join(',')
    ),
  ];
  writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');

  console.log(chalk.dim(`JSON report: ${jsonPath}`));
  console.log(chalk.dim(`CSV report:  ${csvPath}`));

  if (gateResult.enabled) {
    if (gateResult.passed) {
      console.log(chalk.green(`Quality gate: passed (${gateResult.reason})`));
    } else {
      console.log(chalk.red(`Quality gate: failed (${gateResult.reason})`));
      process.exitCode = 2;
    }
  }

  console.log(chalk.green(`\nRecommended default profile: ${best.profile}\n`));
}

function evaluateGate(
  rows: Array<{
    profile: TrainingProfile;
    avgQuality: number;
    contradictionRate: number;
    duplicationRate: number;
  }>,
  cfg: {
    enabled: boolean;
    maxQualityDrop: number;
    maxContradictionRise: number;
    maxDuplicationRise: number;
  }
): {
  enabled: boolean;
  passed: boolean;
  reason: string;
  deltas?: {
    quality_drop: number;
    contradiction_rise: number;
    duplication_rise: number;
  };
  thresholds?: {
    max_quality_drop: number;
    max_contradiction_rise: number;
    max_duplication_rise: number;
  };
} {
  if (!cfg.enabled) {
    return { enabled: false, passed: true, reason: 'gate disabled' };
  }

  const baseline = rows.find((r) => r.profile === 'baseline');
  const full = rows.find((r) => r.profile === 'full');
  if (!baseline || !full) {
    return { enabled: true, passed: false, reason: 'baseline/full rows missing' };
  }

  const qualityDrop = baseline.avgQuality - full.avgQuality;
  const contradictionRise = full.contradictionRate - baseline.contradictionRate;
  const duplicationRise = full.duplicationRate - baseline.duplicationRate;

  const qualityOk = qualityDrop <= cfg.maxQualityDrop;
  const contradictionOk = contradictionRise <= cfg.maxContradictionRise;
  const duplicationOk = duplicationRise <= cfg.maxDuplicationRise;
  const passed = qualityOk && contradictionOk && duplicationOk;

  const reason = passed
    ? 'full profile is within regression thresholds vs baseline'
    : [
      !qualityOk ? `quality drop ${qualityDrop.toFixed(4)} > ${cfg.maxQualityDrop.toFixed(4)}` : null,
      !contradictionOk ? `contradiction rise ${contradictionRise.toFixed(4)} > ${cfg.maxContradictionRise.toFixed(4)}` : null,
      !duplicationOk ? `duplication rise ${duplicationRise.toFixed(4)} > ${cfg.maxDuplicationRise.toFixed(4)}` : null,
    ].filter(Boolean).join('; ');

  return {
    enabled: true,
    passed,
    reason,
    deltas: {
      quality_drop: qualityDrop,
      contradiction_rise: contradictionRise,
      duplication_rise: duplicationRise,
    },
    thresholds: {
      max_quality_drop: cfg.maxQualityDrop,
      max_contradiction_rise: cfg.maxContradictionRise,
      max_duplication_rise: cfg.maxDuplicationRise,
    },
  };
}

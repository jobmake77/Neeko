import * as p from '@clack/prompts';
import { intro, outro, text, select, confirm, spinner } from '@clack/prompts';
import chalk from 'chalk';
import { createPersona } from '../../core/models/persona.js';
import { createEmptySoul } from '../../core/models/soul.js';
import { TwitterAdapter, checkOpenCli } from '../../core/pipeline/ingestion/twitter.js';
import { ArticleAdapter } from '../../core/pipeline/ingestion/article.js';
import { VideoAdapter } from '../../core/pipeline/ingestion/video.js';
import { DataCleaner, SemanticChunker } from '../../core/pipeline/cleaner.js';
import { SoulExtractor, SoulAggregator } from '../../core/soul/extractor.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop, TrainingProgress } from '../../core/training/loop.js';
import { DataSourceRecommender } from '../../core/recommender/sources.js';
import { settings } from '../../config/settings.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import yaml from 'js-yaml';
import { Soul } from '../../core/models/soul.js';
import { Persona } from '../../core/models/persona.js';
import { TrainingProfile } from '../../core/training/types.js';
import { buildTrainingRunReport, buildTrainingRunReportFromRounds, TrainingRoundSnapshot } from '../../core/training/report.js';
import { EvidenceBatch, TargetManifest } from '../../core/models/evidence.js';
import {
  resolveTrainingStrategy,
  selectSoulChunksForStrategy,
} from '../../core/training/strategy-resolver.js';
import {
  buildChatEvidenceBatchFromFile,
  buildStandaloneEvidenceBatch,
  buildVideoTranscriptEvidenceBatch,
  convertEvidenceItemsToDocuments,
  loadTargetManifest,
  writeEvidenceArtifacts,
} from '../../core/pipeline/evidence-layer.js';
import {
  buildSkillLibraryFromSources,
  loadSkillLibrary,
  saveSkillLibrary,
} from '../../core/skills/library.js';
import {
  InputRoutingStrategy,
  normalizeInputRoutingStrategy,
  routeEvidenceDocuments,
  writeInputRoutingReport,
  writeRawDocsCache,
} from '../../core/pipeline/evidence-routing.js';

function savePersona(persona: Persona, soul: Soul): void {
  const dir = settings.getPersonaDir(persona.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'persona.json'), JSON.stringify(persona, null, 2), 'utf-8');
  writeFileSync(join(dir, 'soul.yaml'), yaml.dump(soul), 'utf-8');
}

function saveTrainingReport(
  slug: string,
  profile: TrainingProfile,
  history: Awaited<ReturnType<TrainingLoop['run']>>['history'],
  skillMetrics?: { originSkillsAdded: number; distilledSkillsAdded: number; skillCoverageScore: number }
): void {
  const dir = settings.getPersonaDir(slug);
  mkdirSync(dir, { recursive: true });
  const report = buildTrainingRunReport(profile, history, skillMetrics);
  writeFileSync(join(dir, 'training-report.json'), JSON.stringify(report, null, 2), 'utf-8');
}

function saveTrainingReportFromRounds(
  slug: string,
  profile: TrainingProfile,
  rounds: TrainingRoundSnapshot[],
  skillMetrics?: { originSkillsAdded: number; distilledSkillsAdded: number; skillCoverageScore: number }
): void {
  const dir = settings.getPersonaDir(slug);
  mkdirSync(dir, { recursive: true });
  const report = buildTrainingRunReportFromRounds(profile, rounds, skillMetrics);
  writeFileSync(join(dir, 'training-report.json'), JSON.stringify(report, null, 2), 'utf-8');
}

export async function cmdCreate(
  target: string | undefined,
  options: {
    skill?: string;
    targetManifest?: string;
    chatPlatform?: string;
    yes?: boolean;
    rounds?: string;
    trainingProfile?: string;
    inputRouting?: string;
  }
): Promise<void> {
  intro(chalk.bold.cyan('✦ Neeko — 数字孪生工厂'));

  const nonInteractive = options.yes === true;

  // ── Determine mode ────────────────────────────────────────────────────────
  let mode: 'single' | 'fusion';
  let displayName: string;
  let handle: string | undefined;
  let sourceTargets: string[];
  let localSourcePath: string | undefined;
  let localSourceKind: 'chat' | 'video' | undefined;
  let targetManifest: TargetManifest | undefined;

  if (target) {
    // Single-person distill (Path A): nico create @elonmusk
    mode = 'single';
    const normalizedTarget = target.trim();
    if (isLocalFileTarget(normalizedTarget)) {
      localSourcePath = resolve(normalizedTarget);
      localSourceKind = detectLocalSourceKind(localSourcePath);
      if (!options.targetManifest) {
        throw new Error('Local chat/video inputs require --target-manifest <path>.');
      }
      targetManifest = loadTargetManifest(resolve(options.targetManifest));
      handle = undefined;
      displayName = targetManifest.target_name;
      sourceTargets = [localSourcePath];
    } else if (looksLikeUrl(normalizedTarget)) {
      handle = undefined;
      displayName = deriveDisplayNameFromSource(normalizedTarget);
      sourceTargets = [normalizedTarget];
    } else {
      handle = normalizedTarget.replace(/^@/, '');
      displayName = handle;
      sourceTargets = [handle];
    }
  } else if (options.skill) {
    // Capability fusion (Path B): nico create --skill "全栈工程师"
    mode = 'fusion';

    const spin = spinner();
    spin.start('Decomposing skill into dimensions and recommending data sources...');

    const recommender = new DataSourceRecommender();
    const recommendations = await recommender.recommend(options.skill);
    spin.stop('Recommendations ready');

    p.note(
      recommendations.dimensions
        .map((d) => {
          const sources = d.candidates
            .map((c) => `  ${chalk.cyan(c.platform)} ${c.handle_or_url} — ${c.reason}`)
            .join('\n');
          return `${chalk.bold(d.name)}: ${d.description}\n${sources}`;
        })
        .join('\n\n'),
      'Recommended Data Sources'
    );

    const proceed = await confirm({ message: 'Use these sources? (you can add/remove manually)' });
    if (p.isCancel(proceed) || !proceed) {
      outro('Cancelled.');
      return;
    }

    displayName = await text({
      message: 'Name for this composite agent',
      placeholder: options.skill,
      defaultValue: options.skill,
    }) as string;

    sourceTargets = recommendations.dimensions.flatMap((d) =>
      d.candidates.filter((c) => c.estimated_quality !== 'low').map((c) => c.handle_or_url)
    );
  } else {
    // Interactive mode
    const modeChoice = await select({
      message: 'Which creation mode?',
      options: [
        { value: 'single', label: 'Single-person distill (Path A) — model a specific person' },
        { value: 'fusion', label: 'Skill fusion (Path B) — combine multiple experts' },
      ],
    });
    if (p.isCancel(modeChoice)) { outro('Cancelled.'); return; }
    mode = modeChoice as 'single' | 'fusion';

    if (mode === 'single') {
      const h = await text({ message: 'Twitter/X handle (without @)', placeholder: 'elonmusk' });
      if (p.isCancel(h)) { outro('Cancelled.'); return; }
      handle = h as string;
      displayName = handle;
      sourceTargets = [handle];
    } else {
      const skill = await text({ message: 'Target skill or role', placeholder: '全栈工程师' });
      if (p.isCancel(skill)) { outro('Cancelled.'); return; }
      return cmdCreate(undefined, { skill: skill as string });
    }
  }

  // ── Create persona + soul ─────────────────────────────────────────────────
  const persona = createPersona(displayName, mode, sourceTargets,
    (s) => existsSync(settings.getPersonaDir(s))
  );
  const soul = createEmptySoul(displayName, handle ? `@${handle}` : undefined);
  console.log(chalk.dim(`Slug: ${persona.slug}`));
  savePersona(persona, soul);

  // ── Ingest data ───────────────────────────────────────────────────────────
  const spin = spinner();

  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });

  let qdrantAvailable = false;
  try {
    await store.ensureCollection(persona.memory_collection);
    qdrantAvailable = true;
  } catch {
    p.log.warn('Qdrant 不可达（跳过向量存储）。Soul 提炼和 Persona 文件仍会保存。\n启动 Qdrant：docker run -p 6333:6333 qdrant/qdrant');
  }

  // ── 检查 opencli 可用性 ────────────────────────────────────────────────────
  let canUseOpenCli = true;
  if (mode === 'single' && handle) {
    const version = checkOpenCli();
    canUseOpenCli = Boolean(version);
    if (!version) {
      p.note(
        '未检测到 opencli，请先安装：\n' +
        chalk.bold('npm install -g @jackwener/opencli') + '\n' +
        '安装后确保 Chrome 已登录 X.com，Neeko 将通过浏览器状态免 API 抓取推文。',
        '⚠ 缺少依赖'
      );
      if (!nonInteractive) {
        const proceed = await confirm({ message: '继续？（将跳过推文采集，仅创建空 Persona）' });
        if (p.isCancel(proceed) || !proceed) { outro('已取消。'); return; }
      } else {
        p.log.warn('opencli 未安装，跳过推文采集，仅创建空 Persona。');
      }
    } else {
      p.log.info(`opencli ${version} 已就绪，将通过浏览器免 API 抓取推文`);
    }
    if (!canUseOpenCli) {
      handle = undefined;
    }
  } else if (mode === 'single' && localSourcePath) {
    p.log.info(`单人蒸馏将使用本地${localSourceKind === 'chat' ? '聊天' : '视频'}素材进行提炼。`);
  } else if (mode === 'single') {
    p.log.info('单人蒸馏将使用外部素材链接进行提炼（跳过 Twitter 抓取）。');
  }

  let currentSoul = soul;
  let allDocs: Awaited<ReturnType<TwitterAdapter['fetch']>> = [];
  let evidenceBatch: EvidenceBatch | undefined;
  const inputRouting = resolveInputRoutingStrategy(options.inputRouting);
  const personaDir = settings.getPersonaDir(persona.slug);
  persona.status = 'ingesting';
  persona.updated_at = new Date().toISOString();
  savePersona(persona, currentSoul);
  if (mode === 'single' && localSourcePath && localSourceKind === 'chat') {
    spin.start(`正在解析聊天记录 ${localSourcePath}...`);
    evidenceBatch = await buildChatEvidenceBatchFromFile(localSourcePath, {
      manifest: targetManifest!,
      sourceType: normalizeChatPlatform(options.chatPlatform),
      sourceUrl: localSourcePath,
    });
    writeEvidenceArtifacts(personaDir, evidenceBatch, targetManifest);
    allDocs = convertEvidenceItemsToDocuments(evidenceBatch.items);
    spin.stop(`聊天证据就绪：${evidenceBatch.stats.target_windows} 个 target windows，${evidenceBatch.stats.sessions} 个 sessions`);
  } else if (mode === 'single' && localSourcePath && localSourceKind === 'video') {
    spin.start(`正在转写视频/音频 ${localSourcePath}...`);
    const adapter = new VideoAdapter(settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY);
    const sourceDocs = await adapter.fetch(localSourcePath);
    evidenceBatch = buildVideoTranscriptEvidenceBatch(sourceDocs, targetManifest!);
    writeEvidenceArtifacts(personaDir, evidenceBatch, targetManifest);
    allDocs = convertEvidenceItemsToDocuments(evidenceBatch.items, sourceDocs);
    spin.stop(`视频证据就绪：${evidenceBatch.items.length} 段 transcript evidence`);
  } else if (mode === 'single' && handle) {
    spin.start(`正在通过 opencli 抓取 @${handle} 的推文（复用 Chrome 登录状态）...`);
    const adapter = new TwitterAdapter();
    const docs = await adapter.fetch(handle, { limit: 200 });
    spin.stop(`抓取完成：${docs.length} 条推文`);
    evidenceBatch = buildStandaloneEvidenceBatch(docs, {
      manifest: {
        target_name: displayName,
        target_aliases: handle ? [handle, `@${handle}`] : [],
        self_aliases: [],
        known_other_aliases: [],
      },
      sourceLabel: 'twitter',
    });
    writeEvidenceArtifacts(personaDir, evidenceBatch);
    allDocs = convertEvidenceItemsToDocuments(evidenceBatch.items, docs);
  } else {
    spin.start('正在从推荐数据源获取内容...');
    const adapter = new ArticleAdapter();
    const collected: Awaited<ReturnType<ArticleAdapter['fetch']>> = [];
    for (const src of sourceTargets.slice(0, 5)) {
      if (src.startsWith('http')) {
        const docs = await adapter.fetch(src).catch(() => []);
        collected.push(...docs);
      }
    }
    evidenceBatch = buildStandaloneEvidenceBatch(collected, {
      manifest: {
        target_name: displayName,
        target_aliases: [displayName],
        self_aliases: [],
        known_other_aliases: [],
      },
      sourceLabel: 'article',
    });
    writeEvidenceArtifacts(personaDir, evidenceBatch);
    allDocs = convertEvidenceItemsToDocuments(evidenceBatch.items, collected);
    spin.stop(`获取完成：${allDocs.length} 篇内容`);
  }

  if (allDocs.length === 0) {
    p.note('No data fetched. Will proceed with empty data (you can add data manually).', 'Warning');
  }

  writeRawDocsCache(personaDir, allDocs);

  // ── Clean + chunk ─────────────────────────────────────────────────────────
  spin.start('Cleaning and chunking content...');
  const routed = routeEvidenceDocuments(allDocs, {
    strategy: inputRouting,
    targetSignals: [displayName, handle ? `@${handle}` : '', ...sourceTargets],
    cleaner: new DataCleaner(),
    chunker: new SemanticChunker(),
  });
  const strategyDecision = resolveTrainingStrategy({
    inputRoutingStrategy: inputRouting,
    observability: routed.observability,
    rawDocCount: allDocs.length,
  });
  const cleanDocs = routed.cleanDocs;
  const chunks = routed.chunks;
  const routedSoulChunks = routed.soulChunks.length > 0 ? routed.soulChunks : routed.chunks;
  const soulChunks = selectSoulChunksForStrategy(
    routedSoulChunks,
    routed.routedDocs.map((item) => ({ document_id: item.doc.id, score: item.score })),
    strategyDecision,
    Math.min(routedSoulChunks.length, 30)
  );
  writeInputRoutingReport(personaDir, {
    strategy: inputRouting,
    generated_at: new Date().toISOString(),
    observability: routed.observability,
    strategy_decision: strategyDecision,
    routed_docs: routed.routedDocs.map((item) => ({
      route: item.route,
      score: item.score,
      decision_reason: item.decision_reason,
      decision_flags: item.decision_flags,
    })),
  });
  spin.stop(
    `${chunks.length} semantic chunks ready` +
    (inputRouting === 'v2'
      ? ` (soul=${routed.observability.soul_docs}, memory=${routed.observability.memory_docs}, discard=${routed.observability.discard_docs}, segment=${strategyDecision.corpusSegment}, opt=${strategyDecision.optimizationMode})`
      : '')
  );

  // ── Soul extraction ───────────────────────────────────────────────────────
  persona.status = 'refining';
  persona.updated_at = new Date().toISOString();
  savePersona(persona, currentSoul);
  if (soulChunks.length > 0) {
    spin.start(`Extracting soul from ${soulChunks.length} chunks...`);
    const extractor = new SoulExtractor();
    const aggregator = new SoulAggregator();
    const extractions = await extractor.extractBatch(soulChunks, displayName, strategyDecision.extractionConcurrency, {
      cacheEnabled: strategyDecision.extractorCacheEnabled,
      cachePath: `/tmp/neeko-soul-cache-${persona.slug}.json`,
      timeoutMs: strategyDecision.extractionTimeoutMs,
      retries: strategyDecision.extractionRetries,
    });
    currentSoul = aggregator.aggregate(soul, extractions, soulChunks);
    spin.stop(`Soul v${currentSoul.version} — confidence ${(currentSoul.overall_confidence * 100).toFixed(0)}%`);
  }

  // ── Skill origin extraction + auto expansion ─────────────────────────────
  console.log('[SKILL_STAGE] skill_origin_extract');
  const previousSkills = loadSkillLibrary(personaDir, persona.slug);
  let skillLibrary = previousSkills;
  if (chunks.length > 0 || cleanDocs.length > 0) {
    spin.start('Extracting skill origins and building skill library...');
    skillLibrary = await buildSkillLibraryFromSources(
      persona,
      currentSoul,
      chunks.slice(0, 80),
      cleanDocs.slice(0, 80),
      previousSkills
    );
  } else {
    spin.start('Skipping skill extraction due to empty evidence set...');
  }
  console.log('[SKILL_STAGE] skill_expand');
  saveSkillLibrary(personaDir, skillLibrary);
  console.log('[SKILL_STAGE] skill_merge');
  spin.stop(
    chunks.length > 0 || cleanDocs.length > 0
      ? `Skill library updated — origins ${skillLibrary.origin_skills.length}, distilled ${skillLibrary.distilled_skills.length}`
      : 'Skill library unchanged — no evidence available'
  );

  // ── Ask about training ────────────────────────────────────────────────────
  const requestedRounds = parseInt(options.rounds ?? '0', 10);
  const profile = normalizeTrainingProfile(options.trainingProfile);
  let runTraining = requestedRounds > 0 && qdrantAvailable;

  if (qdrantAvailable && !nonInteractive && !runTraining) {
    const ans = await confirm({
      message: `Run cultivation loop now? (${chalk.cyan('~$2-5 estimated cost')})`,
      initialValue: false,
    });
    runTraining = !p.isCancel(ans) && !!ans;
  }

  if (!qdrantAvailable && requestedRounds > 0) {
    p.log.warn('跳过培养循环：Qdrant 不可达。');
  }

  if (runTraining) {
    persona.status = 'training';
    persona.updated_at = new Date().toISOString();
    savePersona(persona, currentSoul);
    let maxRounds = requestedRounds || 10;

    if (!nonInteractive && requestedRounds === 0) {
      const roundsAns = await select({
        message: 'Training rounds',
        options: [
          { value: '5', label: '5 rounds (quick, ~$1)' },
          { value: '10', label: '10 rounds (standard, ~$2-3)' },
          { value: '20', label: '20 rounds (thorough, ~$5)' },
        ],
      });
      if (!p.isCancel(roundsAns)) maxRounds = parseInt(roundsAns as string);
    }

    spin.start('Running cultivation loop...');
    spin.message(
      `Training strategy: preset=${strategyDecision.runtimePreset}, optimization=${strategyDecision.optimizationMode}, segment=${strategyDecision.corpusSegment}`
    );
    const loop = new TrainingLoop(currentSoul, persona, store);
    const contextPath = join(personaDir, 'training-context.json');
    const originSkillsAdded = skillLibrary.origin_skills.length;
    const distilledSkillsAdded = skillLibrary.distilled_skills.length;
    const covered = skillLibrary.origin_skills.filter(
      (o) => skillLibrary.distilled_skills.some((e) => e.source_origin_ids.includes(o.id))
    ).length;
    const skillCoverageScore =
      skillLibrary.origin_skills.length === 0 ? 0 : covered / skillLibrary.origin_skills.length;
    const skillMetrics = {
      originSkillsAdded,
      distilledSkillsAdded,
      skillCoverageScore,
    };
    const snapshots: TrainingRoundSnapshot[] = [];
    writeTrainingContext(contextPath, {
      state: 'running',
      slug: persona.slug,
      profile,
      requested_rounds: maxRounds,
      completed_rounds: 0,
      updated_at: new Date().toISOString(),
      report_path: join(personaDir, 'training-report.json'),
    });
    const result = await loop.run({
      maxRounds,
      profile,
      runtimePreset: strategyDecision.runtimePreset,
      evaluatorLayered: strategyDecision.evaluatorLayered,
      onProgress: (progress) => {
        spin.message(
          `Round ${progress.round}/${progress.maxRounds} — +${progress.nodesWritten} nodes, quality ${(progress.avgQualityScore * 100).toFixed(0)}%, ` +
          `dup ${(progress.observability.duplicationRate * 100).toFixed(0)}%, contra ${(progress.observability.contradictionRate * 100).toFixed(0)}%`
        );
        const snapshot = toRoundSnapshot(progress, 0);
        upsertRoundSnapshot(snapshots, snapshot);
        saveTrainingReportFromRounds(persona.slug, profile, snapshots, skillMetrics);
        persona.status = 'training';
        persona.training_rounds = snapshot.round;
        persona.last_trained_at = new Date().toISOString();
        persona.updated_at = new Date().toISOString();
        currentSoul.training_rounds_completed = snapshot.round;
        currentSoul.updated_at = new Date().toISOString();
        savePersona(persona, currentSoul);
        writeTrainingContext(contextPath, {
          state: 'running',
          slug: persona.slug,
          profile,
          requested_rounds: maxRounds,
          completed_rounds: snapshot.round,
          updated_at: new Date().toISOString(),
          report_path: join(personaDir, 'training-report.json'),
        });
      },
    }).catch((error) => {
      writeTrainingContext(contextPath, {
        state: 'interrupted',
        slug: persona.slug,
        profile,
        requested_rounds: maxRounds,
        completed_rounds: Math.max(0, ...snapshots.map((item) => item.round)),
        updated_at: new Date().toISOString(),
        report_path: join(personaDir, 'training-report.json'),
        last_error: String(error),
      });
      throw error;
    });
    currentSoul = result.soul;
    persona.training_rounds = result.totalRounds;
    persona.last_trained_at = new Date().toISOString();
    persona.updated_at = new Date().toISOString();
    saveTrainingReport(persona.slug, profile, result.history, {
      originSkillsAdded: skillMetrics.originSkillsAdded,
      distilledSkillsAdded: skillMetrics.distilledSkillsAdded,
      skillCoverageScore: skillMetrics.skillCoverageScore,
    });
    writeTrainingContext(contextPath, {
      state: 'completed',
      slug: persona.slug,
      profile,
      requested_rounds: maxRounds,
      completed_rounds: result.totalRounds,
      updated_at: new Date().toISOString(),
      report_path: join(personaDir, 'training-report.json'),
    });
    spin.stop(`Training complete — ${result.totalRounds} rounds, confidence ${(currentSoul.overall_confidence * 100).toFixed(0)}%`);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  persona.status = 'converged';
  persona.doc_count = allDocs.length;
  persona.updated_at = new Date().toISOString();
  savePersona(persona, currentSoul);

  outro(
    `${chalk.green('✓')} Persona ${chalk.bold(persona.name)} created!\n` +
    `  Slug: ${chalk.cyan(persona.slug)}\n` +
    `  Chat: ${chalk.bold(`nico chat ${persona.slug}`)}\n` +
    `  Export: ${chalk.bold(`nico export ${persona.slug} --to openclaw`)}`
  );
}

function resolveInputRoutingStrategy(raw?: string): InputRoutingStrategy {
  return normalizeInputRoutingStrategy(
    raw,
    normalizeInputRoutingStrategy(String(settings.get('defaultInputRoutingStrategy') ?? 'legacy'))
  );
}

function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function isLocalFileTarget(input: string): boolean {
  return existsSync(resolve(input));
}

function detectLocalSourceKind(filePath: string): 'chat' | 'video' {
  const ext = extname(filePath).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.mp3', '.m4a', '.wav', '.aac', '.webm'].includes(ext)) {
    return 'video';
  }
  return 'chat';
}

function normalizeChatPlatform(raw?: string): 'wechat' | 'feishu' {
  return String(raw ?? 'wechat').toLowerCase() === 'feishu' ? 'feishu' : 'wechat';
}

function deriveDisplayNameFromSource(source: string): string {
  try {
    const u = new URL(source);
    const lastSegment = u.pathname.split('/').filter(Boolean).pop();
    return (lastSegment && lastSegment.length >= 2 ? lastSegment : u.hostname).replace(/[^a-zA-Z0-9_-]/g, '-');
  } catch {
    return 'source-persona';
  }
}
function normalizeTrainingProfile(raw?: string): TrainingProfile {
  const fallback = String(settings.get('defaultTrainingProfile') ?? 'full').toLowerCase();
  const value = String(raw ?? fallback).toLowerCase();
  if (value === 'baseline' || value === 'a1' || value === 'a2' || value === 'a3' || value === 'a4' || value === 'full') {
    return value;
  }
  return 'full';
}

function toRoundSnapshot(progress: TrainingProgress, roundOffset: number): TrainingRoundSnapshot {
  return {
    round: roundOffset + progress.round,
    status: progress.status,
    avg_quality_score: progress.avgQualityScore,
    nodes_written: progress.nodesWritten,
    nodes_reinforced: progress.nodesReinforced,
    contradiction_rate: progress.observability.contradictionRate,
    duplication_rate: progress.observability.duplicationRate,
    low_confidence_coverage: progress.observability.lowConfidenceCoverage,
    new_high_value_memories: progress.observability.newHighValueMemories,
    quarantined_memories: progress.observability.quarantinedMemories,
    gap_focused_questions: progress.observability.gapFocusedQuestions,
    total_questions: progress.observability.totalQuestions,
    skill_trigger_precision: progress.observability.skillTriggerPrecision,
    skill_method_adherence: progress.observability.skillMethodAdherence,
    skill_boundary_violation_rate: progress.observability.skillBoundaryViolationRate,
    skill_transfer_success_rate: progress.observability.skillTransferSuccessRate,
    skill_set_change_rate: progress.observability.skillSetChangeRate,
    score_distribution: progress.observability.scoreDistribution,
  };
}

function upsertRoundSnapshot(rounds: TrainingRoundSnapshot[], next: TrainingRoundSnapshot): void {
  const idx = rounds.findIndex((item) => item.round === next.round);
  if (idx >= 0) {
    rounds[idx] = next;
    return;
  }
  rounds.push(next);
  rounds.sort((a, b) => a.round - b.round);
}

function writeTrainingContext(path: string, payload: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // best effort
  }
}

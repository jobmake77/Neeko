import * as p from '@clack/prompts';
import { intro, outro, text, select, confirm, spinner } from '@clack/prompts';
import chalk from 'chalk';
import { createPersona } from '../../core/models/persona.js';
import { createEmptySoul } from '../../core/models/soul.js';
import { TwitterAdapter, checkOpenCli } from '../../core/pipeline/ingestion/twitter.js';
import { ArticleAdapter } from '../../core/pipeline/ingestion/article.js';
import { DataCleaner, SemanticChunker } from '../../core/pipeline/cleaner.js';
import { SoulExtractor, SoulAggregator } from '../../core/soul/extractor.js';
import { MemoryStore } from '../../core/memory/store.js';
import { TrainingLoop } from '../../core/training/loop.js';
import { DataSourceRecommender } from '../../core/recommender/sources.js';
import { settings } from '../../config/settings.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { Soul } from '../../core/models/soul.js';
import { Persona } from '../../core/models/persona.js';
import { TrainingProfile } from '../../core/training/types.js';
import { buildTrainingRunReport } from '../../core/training/report.js';

function savePersona(persona: Persona, soul: Soul): void {
  const dir = settings.getPersonaDir(persona.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'persona.json'), JSON.stringify(persona, null, 2), 'utf-8');
  writeFileSync(join(dir, 'soul.yaml'), yaml.dump(soul), 'utf-8');
}

function saveTrainingReport(
  slug: string,
  profile: TrainingProfile,
  history: Awaited<ReturnType<TrainingLoop['run']>>['history']
): void {
  const dir = settings.getPersonaDir(slug);
  mkdirSync(dir, { recursive: true });
  const report = buildTrainingRunReport(profile, history);
  writeFileSync(join(dir, 'training-report.json'), JSON.stringify(report, null, 2), 'utf-8');
}

export async function cmdCreate(target: string | undefined, options: { skill?: string; yes?: boolean; rounds?: string; trainingProfile?: string }): Promise<void> {
  intro(chalk.bold.cyan('✦ Neeko — 数字孪生工厂'));

  const nonInteractive = options.yes === true;

  // ── Determine mode ────────────────────────────────────────────────────────
  let mode: 'single' | 'fusion';
  let displayName: string;
  let handle: string | undefined;
  let sourceTargets: string[];

  if (target) {
    // Single-person distill (Path A): nico create @elonmusk
    mode = 'single';
    handle = target.replace(/^@/, '');
    displayName = handle;
    sourceTargets = [handle];
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
  if (mode === 'single') {
    const version = checkOpenCli();
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
  }

  let currentSoul = soul;
  let allDocs: Awaited<ReturnType<TwitterAdapter['fetch']>> = [];
  persona.status = 'ingesting';
  persona.updated_at = new Date().toISOString();
  savePersona(persona, currentSoul);
  if (mode === 'single' && handle) {
    spin.start(`正在通过 opencli 抓取 @${handle} 的推文（复用 Chrome 登录状态）...`);
    const adapter = new TwitterAdapter();
    const docs = await adapter.fetch(handle, { limit: 200 });
    spin.stop(`抓取完成：${docs.length} 条推文`);
    allDocs = docs;
  } else {
    spin.start('正在从推荐数据源获取内容...');
    const adapter = new ArticleAdapter();
    for (const src of sourceTargets.slice(0, 5)) {
      if (src.startsWith('http')) {
        const docs = await adapter.fetch(src).catch(() => []);
        allDocs.push(...docs);
      }
    }
    spin.stop(`获取完成：${allDocs.length} 篇内容`);
  }

  if (allDocs.length === 0) {
    p.note('No data fetched. Will proceed with empty data (you can add data manually).', 'Warning');
  }

  // ── Clean + chunk ─────────────────────────────────────────────────────────
  spin.start('Cleaning and chunking content...');
  const cleaner = new DataCleaner();
  const chunker = new SemanticChunker();
  const cleanDocs = cleaner.clean(allDocs);
  const chunks = chunker.chunkAll(cleanDocs);
  spin.stop(`${chunks.length} semantic chunks ready`);

  // ── Soul extraction ───────────────────────────────────────────────────────
  persona.status = 'refining';
  persona.updated_at = new Date().toISOString();
  savePersona(persona, currentSoul);
  if (chunks.length > 0) {
    spin.start(`Extracting soul from ${chunks.length} chunks...`);
    const extractor = new SoulExtractor();
    const aggregator = new SoulAggregator();
    const batchSize = Math.min(chunks.length, 50); // cap for MVP
    const extractions = await extractor.extractBatch(chunks.slice(0, batchSize), displayName);
    currentSoul = aggregator.aggregate(soul, extractions, chunks.slice(0, batchSize));
    spin.stop(`Soul v${currentSoul.version} — confidence ${(currentSoul.overall_confidence * 100).toFixed(0)}%`);
  }

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
    const loop = new TrainingLoop(currentSoul, persona, store);
    const result = await loop.run({
      maxRounds,
      profile,
      onProgress: (progress) => {
        spin.message(
          `Round ${progress.round}/${progress.maxRounds} — +${progress.nodesWritten} nodes, quality ${(progress.avgQualityScore * 100).toFixed(0)}%, ` +
          `dup ${(progress.observability.duplicationRate * 100).toFixed(0)}%, contra ${(progress.observability.contradictionRate * 100).toFixed(0)}%`
        );
      },
    });
    currentSoul = result.soul;
    persona.training_rounds = result.totalRounds;
    persona.last_trained_at = new Date().toISOString();
    persona.updated_at = new Date().toISOString();
    saveTrainingReport(persona.slug, profile, result.history);
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

function normalizeTrainingProfile(raw?: string): TrainingProfile {
  const fallback = String(settings.get('defaultTrainingProfile') ?? 'full').toLowerCase();
  const value = String(raw ?? fallback).toLowerCase();
  if (value === 'baseline' || value === 'a1' || value === 'a2' || value === 'a3' || value === 'a4' || value === 'full') {
    return value;
  }
  return 'full';
}

import { Command } from 'commander';
import { settings } from '../config/settings.js';
import { cmdCreate } from './commands/create.js';
import { cmdChat } from './commands/chat.js';
import { cmdChatOnce } from './commands/chat-once.js';
import { cmdList } from './commands/list.js';
import { cmdExport } from './commands/export.js';
import { cmdConfig } from './commands/config.js';
import { cmdExperiment } from './commands/experiment.js';
import { cmdAbRegression } from './commands/ab-regression.js';
import { cmdTrain } from './commands/train.js';
import { cmdSkillsRefresh } from './commands/skills-refresh.js';
import { cmdDualPipeline } from './commands/dual-pipeline.js';
import { cmdWorkbenchServer } from './commands/workbench-server.js';
import { cmdWorkbenchSourceSync } from './commands/workbench-source-sync.js';
import { cmdWorkbenchCreatePersona } from './commands/workbench-create-persona.js';

// Apply saved API keys to environment on startup
const cfg = settings.getAll();
if (cfg.anthropicApiKey) process.env.ANTHROPIC_API_KEY = cfg.anthropicApiKey;
if (cfg.openaiApiKey)    process.env.OPENAI_API_KEY    = cfg.openaiApiKey;
if (cfg.kimiApiKey)      process.env.KIMI_API_KEY       = cfg.kimiApiKey;
if (cfg.geminiApiKey)    process.env.GOOGLE_GENERATIVE_AI_API_KEY = cfg.geminiApiKey;
if (cfg.deepseekApiKey)  process.env.DEEPSEEK_API_KEY  = cfg.deepseekApiKey;

const program = new Command();

program
  .name('nico')
  .description('Digital twin factory — distill real people into working AI agents')
  .version('0.1.0');

// ─── nico create ─────────────────────────────────────────────────────────────
program
  .command('create [target]')
  .description('Create a new persona agent (e.g. nico create @elonmusk)')
  .option('--skill <skill>', 'Create a composite agent by skill (Path B)')
  .option('--target-manifest <path>', 'Explicit target manifest for local chat/video inputs')
  .option('--chat-platform <platform>', 'Chat platform for local exports: wechat | feishu', 'wechat')
  .option('--slug <slug>', 'Internal fixed slug override (used by desktop rebuild flow)')
  .option('--yes', 'Skip all confirmation prompts (for non-interactive or client bridge use)')
  .option('--rounds <n>', 'Training rounds to run automatically (0 = skip training)', '0')
  .option('--training-profile <profile>', 'Training profile: baseline | a1 | a2 | a3 | a4 | full')
  .option('--input-routing <strategy>', 'Input routing strategy: legacy | v2 (current recommended gray path: v2 + off)')
  .option('--training-seed-mode <mode>', 'Gray training-seed hints: off | topics | signals (current recommended gray path: off)', 'off')
  .option('--kimi-stability-mode <mode>', 'Kimi 2-round governance: standard | tight_runtime | sparse_director | hybrid')
  .action(async (target?: string, options?: {
    skill?: string;
    targetManifest?: string;
    chatPlatform?: string;
    slug?: string;
    yes?: boolean;
    rounds?: string;
    trainingProfile?: string;
    inputRouting?: string;
    trainingSeedMode?: string;
    kimiStabilityMode?: string;
  }) => {
    await cmdCreate(target, options ?? {});
  });

// ─── nico chat ───────────────────────────────────────────────────────────────
program
  .command('chat <slug>')
  .description('Chat with a persona agent')
  .action(async (slug: string) => {
    await cmdChat(slug);
  });

// ─── nico chat-once (for desktop/client bridge) ──────────────────────────────
program
  .command('chat-once <slug>')
  .description('Single-shot chat reply (used by the desktop client bridge)')
  .requiredOption('--message <text>', 'User message')
  .option('--history <json>', 'Conversation history as JSON array', '[]')
  .action(async (slug: string, options: { message: string; history: string }) => {
    await cmdChatOnce(slug, options);
  });

// ─── nico list ───────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all persona agents')
  .action(() => {
    cmdList();
  });

// ─── nico export ─────────────────────────────────────────────────────────────
program
  .command('export <slug>')
  .description('Export a persona to a target format')
  .option('--to <format>', 'Export format (openclaw)', 'openclaw')
  .option('--output-dir <dir>', 'Output directory')
  .action(async (slug: string, options: { to?: string; outputDir?: string }) => {
    await cmdExport(slug, options);
  });

// ─── nico config ─────────────────────────────────────────────────────────────
program
  .command('config')
  .description('Configure API keys and settings')
  .option('--api-key <key>', 'Set Anthropic API key')
  .option('--openai-key <key>', 'Set OpenAI API key')
  .option('--deepseek-key <key>', 'Set DeepSeek API key')
  .option('--qdrant-url <url>', 'Set Qdrant URL')
  .option('--training-profile <profile>', 'Set default training profile: baseline | a1 | a2 | a3 | a4 | full')
  .option('--input-routing <strategy>', 'Set default input routing strategy: legacy | v2 (keep legacy as safe default; recommended gray line is v2 + off)')
  .option('--show', 'Show current configuration')
  .action(async (options: {
    apiKey?: string;
    openaiKey?: string;
    deepseekKey?: string;
    qdrantUrl?: string;
    trainingProfile?: string;
    inputRouting?: string;
    show?: boolean;
  }) => {
    await cmdConfig(options);
  });

// ─── nico experiment ────────────────────────────────────────────────────────
program
  .command('experiment <slug>')
  .description('Run A/B training profiles (baseline, a1-a4) for quality comparison')
  .option('--profiles <csv>', 'Profiles to run, comma-separated: baseline,a1,a2,a3,a4,full')
  .option('--rounds <n>', 'Rounds per profile', '10')
  .option('--questions-per-round <n>', 'Questions per round for experiment runs', '5')
  .option('--benchmark-manifest <path>', 'Replay against frozen benchmark_case_manifests from an experiment artifact')
  .option('--official-pack <pack-id-or-path>', 'Load a checked-in official benchmark pack by registry id or pack path')
  .option('--judge-mode <mode>', 'Benchmark judge mode: proxy | benchmark_single | benchmark_dual | both')
  .option('--replicas <n>', 'Repeat official benchmark execution under one replica group')
  .option('--significance', 'Emit benchmark significance summary when replica evidence is sufficient')
  .option('--output-dir <dir>', 'Write JSON/CSV reports to this directory')
  .option('--gate', 'Enable quality gate: compare full vs baseline and fail on regression')
  .option('--max-quality-drop <n>', 'Allowed quality drop for full vs baseline', '0.02')
  .option('--max-contradiction-rise <n>', 'Allowed contradiction rate rise for full vs baseline', '0.03')
  .option('--max-duplication-rise <n>', 'Allowed duplication rate rise for full vs baseline', '0.05')
  .option('--input-routing <strategy>', 'Input routing strategy for experiment preprocessing: legacy | v2 (recommended gray comparison base: v2)')
  .option('--training-seed-mode <mode>', 'Gray training-seed hints for profile runs: off | topics | signals (recommended gray comparison base: off)', 'off')
  .option('--skip-profile-sweep', 'Skip profile sweep and only run extra comparison tracks')
  .option('--compare-input-routing', 'Run extra full-profile legacy vs v2 input routing comparison')
  .option('--compare-training-seed', 'Run extra full-profile legacy/off vs v2/off/topics/signals comparison')
  .option('--compare-variants <csv>', 'Override comparison variants, e.g. legacy:off,v2:off,v2:signals')
  .option('--kimi-stability-mode <mode>', 'Kimi training governance: standard | tight_runtime | sparse_director | hybrid')
  .action(async (slug: string, options: {
    profiles?: string;
    rounds?: string;
    questionsPerRound?: string;
    benchmarkManifest?: string;
    officialPack?: string;
    judgeMode?: string;
    replicas?: string;
    significance?: boolean;
    outputDir?: string;
    gate?: boolean;
    maxQualityDrop?: string;
    maxContradictionRise?: string;
    maxDuplicationRise?: string;
    inputRouting?: string;
    trainingSeedMode?: string;
    skipProfileSweep?: boolean;
    compareInputRouting?: boolean;
    compareTrainingSeed?: boolean;
    compareVariants?: string;
    kimiStabilityMode?: string;
  }) => {
    await cmdExperiment(slug, options);
  });

// ─── nico ab-regression ─────────────────────────────────────────────────────
program
  .command('ab-regression <slug>')
  .description('Run A/B regression between two training profiles and output comparison report')
  .option('--rounds <n>', 'Rounds per group', '10')
  .option('--a <profile>', 'Group A profile (baseline | a1 | a2 | a3 | a4 | full)', 'baseline')
  .option('--b <profile>', 'Group B profile (baseline | a1 | a2 | a3 | a4 | full)', 'full')
  .option('--benchmark-manifest <path>', 'Replay groups against frozen benchmark_case_manifests from an experiment artifact')
  .option('--official-pack <pack-id-or-path>', 'Load a checked-in official benchmark pack by registry id or pack path')
  .option('--judge-mode <mode>', 'Benchmark judge mode: proxy | benchmark_single | benchmark_dual | both')
  .option('--replicas <n>', 'Repeat official benchmark execution under one replica group')
  .option('--significance', 'Emit benchmark significance summary when replica evidence is sufficient')
  .option('--output-dir <dir>', 'Write reports to this directory')
  .option('--format <fmt>', 'Output format: table | csv | json | md | all', 'all')
  .option('--gate', 'Enable quality gate: compare B vs A and fail on regression')
  .option('--max-quality-drop <n>', 'Allowed quality drop for B vs A', '0.02')
  .option('--max-contradiction-rise <n>', 'Allowed contradiction rise for B vs A', '0.03')
  .option('--max-duplication-rise <n>', 'Allowed duplication rise for B vs A', '0.05')
  .action(async (slug: string, options: {
    rounds?: string;
    a?: string;
    b?: string;
    benchmarkManifest?: string;
    officialPack?: string;
    judgeMode?: string;
    replicas?: string;
    significance?: boolean;
    outputDir?: string;
    format?: string;
    gate?: boolean;
    maxQualityDrop?: string;
    maxContradictionRise?: string;
    maxDuplicationRise?: string;
  }) => {
    await cmdAbRegression(slug, options);
  });

// ─── nico train ─────────────────────────────────────────────────────────────
program
  .command('train <slug>')
  .description('Continue cultivation for an existing persona')
  .option('--mode <mode>', 'Training mode: quick | full')
  .option('--rounds <n>', 'Training rounds (overrides mode)')
  .option('--track <track>', 'Track: persona_extract | work_execute | full_serial', 'full_serial')
  .option('--training-profile <profile>', 'Training profile: baseline | a1 | a2 | a3 | a4 | full')
  .option('--input-routing <strategy>', 'Input routing strategy placeholder: legacy | v2 (current recommended gray path: v2 + off)')
  .option('--training-seed-mode <mode>', 'Gray training-seed hints: off | topics | signals (current recommended gray path: off)', 'off')
  .option('--retries <n>', 'Retry count for transient model format errors', '2')
  .option('--from-checkpoint <id>', 'Resume from checkpoint id (or latest)')
  .option('--kimi-stability-mode <mode>', 'Kimi 2-round governance: standard | tight_runtime | sparse_director | hybrid')
  .option('--prep-documents-path <path>', 'Optional training prep documents path from workbench adapter')
  .option('--prep-evidence-path <path>', 'Optional training prep evidence-index path from workbench adapter')
  .option('--prep-artifact-id <id>', 'Optional training prep artifact id from workbench adapter')
  .option('--evidence-import-id <id>', 'Optional linked evidence import id from workbench adapter')
  .action(async (slug: string, options: {
    mode?: string;
    rounds?: string;
    track?: string;
    trainingProfile?: string;
    inputRouting?: string;
    trainingSeedMode?: string;
    retries?: string;
    fromCheckpoint?: string;
    kimiStabilityMode?: string;
    prepDocumentsPath?: string;
    prepEvidencePath?: string;
    prepArtifactId?: string;
    evidenceImportId?: string;
  }) => {
    await cmdTrain(slug, options);
  });

// ─── nico skills-refresh ────────────────────────────────────────────────────
program
  .command('skills-refresh <slug>')
  .description('Rebuild persona skill library from latest signals')
  .option('--mode <mode>', 'Refresh mode: quick | full', 'quick')
  .action(async (slug: string, options: { mode?: string }) => {
    await cmdSkillsRefresh(slug, options);
  });

// ─── nico dual-pipeline ─────────────────────────────────────────────────────
program
  .command('dual-pipeline')
  .description('Run fixed dual-account pipeline (turingou, HiTw93): train -> ab-regression serially')
  .option('--rounds <n>', 'Rounds for train and A/B', '1')
  .option('--mode <mode>', 'Train mode: quick | full', 'quick')
  .option('--training-profile <profile>', 'Training profile for train', 'full')
  .option('--output-dir <dir>', 'Output base directory for A/B reports')
  .option('--no-gate', 'Disable A/B quality gate')
  .action(async (options: {
    rounds?: string;
    mode?: 'quick' | 'full';
    trainingProfile?: string;
    outputDir?: string;
    gate?: boolean;
  }) => {
    await cmdDualPipeline(options);
  });

program
  .command('workbench-server')
  .description('Start the local structured API server for the desktop workbench')
  .option('--port <n>', 'Port for the local server', '4310')
  .action(async (options: { port?: string }) => {
    await cmdWorkbenchServer(options, process.argv[1]);
  });

program
  .command('workbench-source-sync <slug>')
  .description('Run source sync for a persona in a separate process')
  .option('--mode <mode>', 'Sync mode: incremental_sync | deep_fetch', 'deep_fetch')
  .action(async (slug: string, options: { mode?: string }) => {
    await cmdWorkbenchSourceSync(slug, options, process.argv[1]);
  });

program
  .command('workbench-create-persona <slug>')
  .description('Create or rebuild a persona from configured sources')
  .action(async (slug: string) => {
    await cmdWorkbenchCreatePersona(slug, process.argv[1]);
  });

program.parseAsync(process.argv)
  .then(() => {
    if (process.env.NEEKO_CLI_FORCE_EXIT === '1') {
      setTimeout(() => process.exit(process.exitCode ?? 0), 0);
    }
  })
  .catch((err: Error) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });

import { Command } from 'commander';
import { settings } from '../config/settings.js';
import { cmdCreate } from './commands/create.js';
import { cmdChat } from './commands/chat.js';
import { cmdList } from './commands/list.js';
import { cmdExport } from './commands/export.js';
import { cmdConfig } from './commands/config.js';

// Apply saved API keys to environment on startup
const anthropicKey = settings.get('anthropicApiKey');
if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;

const openaiKey = settings.get('openaiApiKey');
if (openaiKey) process.env.OPENAI_API_KEY = openaiKey;

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
  .action(async (target?: string, options?: { skill?: string }) => {
    await cmdCreate(target, options ?? {});
  });

// ─── nico chat ───────────────────────────────────────────────────────────────
program
  .command('chat <slug>')
  .description('Chat with a persona agent')
  .action(async (slug: string) => {
    await cmdChat(slug);
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
  .option('--qdrant-url <url>', 'Set Qdrant URL')
  .option('--show', 'Show current configuration')
  .action(async (options: {
    apiKey?: string;
    openaiKey?: string;
    qdrantUrl?: string;
    show?: boolean;
  }) => {
    await cmdConfig(options);
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

import * as p from '@clack/prompts';
import { intro, outro, text, password, confirm } from '@clack/prompts';
import chalk from 'chalk';
import { settings } from '../../config/settings.js';

export async function cmdConfig(options: {
  apiKey?: string;
  openaiKey?: string;
  qdrantUrl?: string;
  show?: boolean;
}): Promise<void> {
  if (options.show) {
    const all = settings.getAll();
    console.log(chalk.bold.cyan('\n✦ Nico Configuration\n'));
    for (const [key, value] of Object.entries(all)) {
      const display =
        typeof value === 'string' && (key.includes('Key') || key.includes('key'))
          ? value.slice(0, 8) + '...'
          : String(value ?? chalk.dim('not set'));
      console.log(`  ${key.padEnd(20)} ${display}`);
    }
    console.log();
    return;
  }

  // CLI flags mode
  if (options.apiKey) {
    settings.set('anthropicApiKey', options.apiKey);
    process.env.ANTHROPIC_API_KEY = options.apiKey;
    console.log(chalk.green('✓ Anthropic API key saved'));
  }
  if (options.openaiKey) {
    settings.set('openaiApiKey', options.openaiKey);
    process.env.OPENAI_API_KEY = options.openaiKey;
    console.log(chalk.green('✓ OpenAI API key saved'));
  }
  if (options.qdrantUrl) {
    settings.set('qdrantUrl', options.qdrantUrl);
    console.log(chalk.green(`✓ Qdrant URL saved: ${options.qdrantUrl}`));
  }

  // If no flags provided, run interactive config
  if (!options.apiKey && !options.openaiKey && !options.qdrantUrl && !options.show) {
    intro(chalk.bold.cyan('✦ Nico Configuration'));

    const anthropicKey = await password({
      message: 'Anthropic API Key (claude-sonnet-4-6)',
    });
    if (!p.isCancel(anthropicKey) && anthropicKey) {
      settings.set('anthropicApiKey', anthropicKey as string);
    }

    const openaiKey = await password({
      message: 'OpenAI API Key (embeddings + Whisper)',
    });
    if (!p.isCancel(openaiKey) && openaiKey) {
      settings.set('openaiApiKey', openaiKey as string);
    }

    const qdrant = await text({
      message: 'Qdrant URL',
      defaultValue: 'http://localhost:6333',
      placeholder: 'http://localhost:6333',
    });
    if (!p.isCancel(qdrant) && qdrant) {
      settings.set('qdrantUrl', qdrant as string);
    }

    outro(chalk.green('✓ Configuration saved'));
  }
}

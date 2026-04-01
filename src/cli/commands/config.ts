import * as p from '@clack/prompts';
import { intro, outro, text, password, select } from '@clack/prompts';
import chalk from 'chalk';
import { settings } from '../../config/settings.js';
import { TrainingProfile } from '../../core/training/types.js';
import { InputRoutingStrategy, normalizeInputRoutingStrategy } from '../../core/pipeline/evidence-routing.js';

export async function cmdConfig(options: {
  apiKey?: string;
  openaiKey?: string;
  deepseekKey?: string;
  qdrantUrl?: string;
  trainingProfile?: string;
  inputRouting?: string;
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
  if (options.deepseekKey) {
    settings.set('deepseekApiKey', options.deepseekKey);
    process.env.DEEPSEEK_API_KEY = options.deepseekKey;
    console.log(chalk.green('✓ DeepSeek API key saved'));
  }
  if (options.qdrantUrl) {
    settings.set('qdrantUrl', options.qdrantUrl);
    console.log(chalk.green(`✓ Qdrant URL saved: ${options.qdrantUrl}`));
  }
  if (options.trainingProfile) {
    const profile = normalizeTrainingProfile(options.trainingProfile);
    settings.set('defaultTrainingProfile', profile);
    console.log(chalk.green(`✓ Default training profile saved: ${profile}`));
  }
  if (options.inputRouting) {
    const strategy = normalizeInputRouting(options.inputRouting);
    settings.set('defaultInputRoutingStrategy', strategy);
    console.log(chalk.green(`✓ Default input routing saved: ${strategy}`));
  }

  // If no flags provided, run interactive config
  if (!options.apiKey && !options.openaiKey && !options.deepseekKey && !options.qdrantUrl && !options.trainingProfile && !options.inputRouting && !options.show) {
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

    const deepseekKey = await password({
      message: 'DeepSeek API Key (deepseek-chat)',
    });
    if (!p.isCancel(deepseekKey) && deepseekKey) {
      settings.set('deepseekApiKey', deepseekKey as string);
    }

    const qdrant = await text({
      message: 'Qdrant URL',
      defaultValue: 'http://localhost:6333',
      placeholder: 'http://localhost:6333',
    });
    if (!p.isCancel(qdrant) && qdrant) {
      settings.set('qdrantUrl', qdrant as string);
    }

    const trainingProfile = await select({
      message: 'Default training profile',
      options: [
        { value: 'full', label: 'full (recommended)' },
        { value: 'a4', label: 'a4' },
        { value: 'a3', label: 'a3' },
        { value: 'a2', label: 'a2' },
        { value: 'a1', label: 'a1' },
        { value: 'baseline', label: 'baseline' },
      ],
      initialValue: normalizeTrainingProfile(String(settings.get('defaultTrainingProfile') ?? 'full')),
    });
    if (!p.isCancel(trainingProfile)) {
      settings.set('defaultTrainingProfile', normalizeTrainingProfile(trainingProfile as string));
    }

    const inputRouting = await select({
      message: 'Default input routing',
      options: [
        { value: 'legacy', label: 'legacy (recommended default)' },
        { value: 'v2', label: 'v2 (evidence routing preview)' },
      ],
      initialValue: normalizeInputRouting(String(settings.get('defaultInputRoutingStrategy') ?? 'legacy')),
    });
    if (!p.isCancel(inputRouting)) {
      settings.set('defaultInputRoutingStrategy', normalizeInputRouting(inputRouting as string));
    }

    outro(chalk.green('✓ Configuration saved'));
  }
}

function normalizeTrainingProfile(raw: string): TrainingProfile {
  const value = raw.toLowerCase();
  if (value === 'baseline' || value === 'a1' || value === 'a2' || value === 'a3' || value === 'a4' || value === 'full') {
    return value;
  }
  return 'full';
}

function normalizeInputRouting(raw: string): InputRoutingStrategy {
  return normalizeInputRoutingStrategy(raw, 'legacy');
}

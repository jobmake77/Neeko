import chalk from 'chalk';
import { spinner } from '@clack/prompts';
import { settings } from '../../config/settings.js';
import { OpenClawExporter } from '../../exporters/openclaw.js';
import { Soul } from '../../core/models/soul.js';
import { Persona } from '../../core/models/persona.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

export async function cmdExport(
  slug: string,
  options: { to?: string; outputDir?: string }
): Promise<void> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const soulPath = join(dir, 'soul.yaml');

  if (!existsSync(personaPath) || !existsSync(soulPath)) {
    console.error(chalk.red(`✗ Persona "${slug}" not found.`));
    process.exit(1);
  }

  const persona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const soul = yaml.load(readFileSync(soulPath, 'utf-8')) as Soul;

  const format = options.to ?? 'openclaw';
  const outputDir = options.outputDir ?? join(process.cwd(), `nico-export-${slug}`);

  const spin = spinner();

  if (format === 'openclaw') {
    spin.start(`Exporting ${persona.name} to OpenClaw format...`);
    const exporter = new OpenClawExporter();
    exporter.export(soul, persona, outputDir);
    spin.stop(`Exported to: ${chalk.cyan(outputDir)}`);
    console.log(chalk.dim('\nFiles created:'));
    console.log(chalk.dim('  SOUL.md       — soul profile'));
    console.log(chalk.dim('  IDENTITY.md   — persona metadata'));
    console.log(chalk.dim('  MEMORY.md     — memory index'));
    console.log(chalk.dim('  soul.yaml     — raw soul data'));
    console.log(chalk.dim('  agent.json    — agent config'));
    console.log();
    console.log(`Import with: ${chalk.bold(`openclaw agents import ${outputDir}`)}`);
  } else {
    console.error(chalk.red(`Unknown export format: "${format}". Supported: openclaw`));
    process.exit(1);
  }
}

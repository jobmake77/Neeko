import chalk from 'chalk';
import { settings } from '../../config/settings.js';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Persona } from '../../core/models/persona.js';

export function cmdList(): void {
  const dataDir = join(settings.getDataDir(), 'personas');

  if (!existsSync(dataDir)) {
    console.log(chalk.dim('No personas yet. Create one with: nico create @handle'));
    return;
  }

  const slugs = readdirSync(dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (slugs.length === 0) {
    console.log(chalk.dim('No personas yet. Create one with: nico create @handle'));
    return;
  }

  console.log(chalk.bold.cyan('\n✦ Nico Personas\n'));

  for (const slug of slugs) {
    const personaPath = join(dataDir, slug, 'persona.json');
    if (!existsSync(personaPath)) continue;

    const persona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
    const statusColor =
      persona.status === 'converged' ? chalk.green
        : persona.status === 'training' ? chalk.yellow
        : chalk.dim;

    console.log(
      `  ${chalk.bold(persona.name.padEnd(20))} ` +
      `${statusColor(persona.status.padEnd(12))} ` +
      `${chalk.dim(`${persona.doc_count} docs | ${persona.memory_node_count} nodes | rounds: ${persona.training_rounds}`)}`
    );
  }
  console.log();
}

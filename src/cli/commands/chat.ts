import { intro, outro, isCancel } from '@clack/prompts';
import * as readline from 'readline';
import chalk from 'chalk';
import { settings } from '../../config/settings.js';
import { MemoryStore } from '../../core/memory/store.js';
import { MemoryRetriever } from '../../core/memory/retriever.js';
import { PersonaAgent } from '../../core/agents/index.js';
import { Soul } from '../../core/models/soul.js';
import { Persona } from '../../core/models/persona.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

function loadPersona(slug: string): { persona: Persona; soul: Soul } | null {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const soulPath = join(dir, 'soul.yaml');

  if (!existsSync(personaPath) || !existsSync(soulPath)) return null;

  const persona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const soul = yaml.load(readFileSync(soulPath, 'utf-8')) as Soul;
  return { persona, soul };
}

export async function cmdChat(slug: string): Promise<void> {
  const loaded = loadPersona(slug);
  if (!loaded) {
    console.error(chalk.red(`✗ Persona "${slug}" not found. Run: nico create @${slug}`));
    process.exit(1);
  }

  const { persona, soul } = loaded;

  intro(chalk.bold.cyan(`✦ Chatting with ${persona.name}`));
  console.log(chalk.dim(`Soul v${soul.version} | Confidence: ${(soul.overall_confidence * 100).toFixed(0)}% | Type "exit" to quit\n`));

  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });
  const retriever = new MemoryRetriever(store);
  const agent = new PersonaAgent(soul, retriever, persona.memory_collection);

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('You: '),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      outro(chalk.dim('Session ended.'));
      rl.close();
      return;
    }

    rl.pause();

    try {
      process.stdout.write(chalk.bold(`${persona.name}: `));
      const response = await agent.respond(input, history);
      console.log(response);
      console.log();

      history.push({ role: 'user', content: input });
      history.push({ role: 'assistant', content: response });

      // Keep last 10 turns in history
      if (history.length > 20) history.splice(0, 2);
    } catch (err) {
      console.error(chalk.red(`Error: ${String(err)}`));
    }

    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

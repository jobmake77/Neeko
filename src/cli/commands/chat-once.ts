import { settings } from '../../config/settings.js';
import { MemoryStore } from '../../core/memory/store.js';
import { MemoryRetriever } from '../../core/memory/retriever.js';
import { PersonaAgent } from '../../core/agents/index.js';
import { Soul } from '../../core/models/soul.js';
import { Persona } from '../../core/models/persona.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { loadSkillLibrary } from '../../core/skills/library.js';

/**
 * Single-shot chat for Web UI — reads --message and --history, prints reply to stdout, exits.
 */
export async function cmdChatOnce(
  slug: string,
  options: { message: string; history: string }
): Promise<void> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const soulPath = join(dir, 'soul.yaml');

  if (!existsSync(personaPath) || !existsSync(soulPath)) {
    process.stderr.write(`Persona "${slug}" not found.\n`);
    process.exit(1);
  }

  const persona = JSON.parse(readFileSync(personaPath, 'utf-8')) as Persona;
  const soul = yaml.load(readFileSync(soulPath, 'utf-8')) as Soul;

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = (() => {
    try { return JSON.parse(options.history); } catch { return []; }
  })();

  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });

  // Auto-heal legacy personas whose Qdrant collection was never initialized.
  try {
    await store.ensureCollection(persona.memory_collection);
  } catch {
    // Keep chat available even if Qdrant is temporarily unavailable.
  }

  const retriever = new MemoryRetriever(store);
  const skillLibrary = loadSkillLibrary(dir, slug);
  const agent = new PersonaAgent(soul, retriever, persona.memory_collection, skillLibrary);

  const reply = await agent.respond(options.message, history);
  process.stdout.write(reply);
}

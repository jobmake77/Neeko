import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { settings } from '../../config/settings.js';
import { Persona, PersonaSchema } from '../../core/models/persona.js';
import { Soul, SoulSchema } from '../../core/models/soul.js';
import { MemoryStore } from '../../core/memory/store.js';
import {
  loadSkillLibrary,
  refreshSkillLibraryFromSignals,
  saveSkillLibrary,
} from '../../core/skills/library.js';

export async function cmdSkillsRefresh(
  slug: string,
  options: { mode?: string } = {}
): Promise<void> {
  const dir = settings.getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  const soulPath = join(dir, 'soul.yaml');
  if (!existsSync(personaPath) || !existsSync(soulPath)) {
    throw new Error(`Persona "${slug}" not found.`);
  }

  const persona = PersonaSchema.parse(JSON.parse(readFileSync(personaPath, 'utf-8'))) as Persona;
  const soul = SoulSchema.parse(yaml.load(readFileSync(soulPath, 'utf-8'))) as Soul;

  const store = new MemoryStore({
    qdrantUrl: settings.get('qdrantUrl'),
    qdrantApiKey: settings.get('qdrantApiKey'),
    openaiApiKey: settings.get('openaiApiKey') ?? process.env.OPENAI_API_KEY,
  });

  console.log('[SKILL_STAGE] skill_origin_extract');
  const mode: 'quick' | 'full' = String(options.mode ?? 'quick').toLowerCase() === 'full' ? 'full' : 'quick';
  const signals = await buildMemorySignals(store, persona.memory_collection, soul, mode);
  const prev = loadSkillLibrary(dir, slug);
  const library = await refreshSkillLibraryFromSignals(persona, soul, signals, prev);
  console.log('[SKILL_STAGE] skill_expand');
  saveSkillLibrary(dir, library);
  console.log('[SKILL_STAGE] skill_merge');
  console.log(`skills refreshed: origins=${library.origin_skills.length}, distilled=${library.distilled_skills.length}`);
}

async function buildMemorySignals(
  store: MemoryStore,
  collection: string,
  soul: Soul,
  mode: 'quick' | 'full'
): Promise<string[]> {
  const queries = new Set<string>();
  const queryCap = mode === 'full' ? 10 : 6;
  for (const d of soul.knowledge_domains.expert.slice(0, queryCap)) queries.add(d);
  for (const b of soul.values.core_beliefs.slice(0, queryCap)) queries.add(b.belief);
  if (queries.size === 0) {
    queries.add(`${soul.target_name} approach`);
    queries.add(`${soul.target_name} strategy`);
  }

  const out: string[] = [];
  for (const q of queries) {
    try {
      const nodes = await store.search(collection, q, { limit: mode === 'full' ? 12 : 8, filter: { minConfidence: 0.45 } });
      for (const n of nodes) {
        out.push(`${n.summary}\n${n.original_text.slice(0, 280)}`);
      }
    } catch {
      // ignore
    }
  }
  return Array.from(new Set(out)).slice(0, mode === 'full' ? 180 : 120);
}

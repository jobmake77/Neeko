import { z } from 'zod';

// ─── Persona Metadata ────────────────────────────────────────────────────────

export const PersonaSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),                // display name (e.g. "Elon Musk")
  slug: z.string(),                // filesystem-safe slug (e.g. "elonmusk")
  handle: z.string().optional(),   // @handle on source platform

  // creation mode
  mode: z.enum(['single', 'fusion']),  // A: single-person distill | B: multi-person fusion
  source_targets: z.array(z.string()), // handles/names used for data collection

  // paths (relative to ~/.nico/personas/<slug>/)
  soul_path: z.string(),
  memory_collection: z.string(),   // Qdrant collection name

  // state
  status: z.enum([
    'created',      // just created, no data
    'ingesting',    // collecting data
    'refining',     // soul extraction in progress
    'training',     // cultivation loop running
    'converged',    // training complete
    'exported',     // exported to target format
  ]),
  training_rounds: z.number().int().min(0).default(0),
  last_trained_at: z.string().datetime().optional(),

  // stats
  memory_node_count: z.number().int().min(0).default(0),
  doc_count: z.number().int().min(0).default(0),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Persona = z.infer<typeof PersonaSchema>;

export function createPersona(
  name: string,
  mode: 'single' | 'fusion',
  sourceTargets: string[]
): Persona {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    slug,
    mode,
    source_targets: sourceTargets,
    soul_path: `soul.yaml`,
    memory_collection: `nico_${slug}`,
    status: 'created',
    training_rounds: 0,
    memory_node_count: 0,
    doc_count: 0,
    created_at: now,
    updated_at: now,
  };
}

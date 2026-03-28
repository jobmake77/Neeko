import { z } from 'zod';

export const SkillEvidenceSchema = z.object({
  quote: z.string(),
  source: z.string(),
});
export type SkillEvidence = z.infer<typeof SkillEvidenceSchema>;

export const OriginSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  why: z.string(),
  how: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(SkillEvidenceSchema),
});
export type OriginSkill = z.infer<typeof OriginSkillSchema>;

export const ExpandedSkillSchema = z.object({
  id: z.string(),
  origin_id: z.string(),
  name: z.string(),
  similarity: z.number().min(0).max(1),
  source_platform: z.string(),
  source_ref: z.string(),
  transferable_summary: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ExpandedSkill = z.infer<typeof ExpandedSkillSchema>;

export const SkillClusterSchema = z.object({
  origin_id: z.string(),
  expanded_ids: z.array(z.string()),
});
export type SkillCluster = z.infer<typeof SkillClusterSchema>;

export const PersonaSkillLibrarySchema = z.object({
  schema_version: z.literal(1),
  persona_slug: z.string(),
  version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  source_trace: z.array(z.string()),
  origin_skills: z.array(OriginSkillSchema),
  expanded_skills: z.array(ExpandedSkillSchema),
  clusters: z.array(SkillClusterSchema),
  pending_candidates: z.array(OriginSkillSchema).default([]),
});
export type PersonaSkillLibrary = z.infer<typeof PersonaSkillLibrarySchema>;

export function createEmptySkillLibrary(slug: string): PersonaSkillLibrary {
  return {
    schema_version: 1,
    persona_slug: slug,
    version: 1,
    updated_at: new Date().toISOString(),
    source_trace: [],
    origin_skills: [],
    expanded_skills: [],
    clusters: [],
    pending_candidates: [],
  };
}


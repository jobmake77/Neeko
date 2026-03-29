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

export const SkillEvidenceRefSchema = z.object({
  source: z.string(),
  source_platform: z.string(),
  snippet: z.string(),
  similarity: z.number().min(0).max(1),
});
export type SkillEvidenceRef = z.infer<typeof SkillEvidenceRefSchema>;

export const DistilledSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  central_thesis: z.string(),
  why: z.string(),
  how_steps: z.array(z.string()).min(1),
  boundaries: z.array(z.string()).min(1),
  trigger_signals: z.array(z.string()).min(1),
  anti_patterns: z.array(z.string()).default([]),
  evidence_refs: z.array(SkillEvidenceRefSchema),
  confidence: z.number().min(0).max(1),
  contradiction_risk: z.number().min(0).max(1),
  method_completeness: z.number().min(0).max(1),
  coverage_tags: z.array(z.string()),
  quality_score: z.number().min(0).max(1),
  source_origin_ids: z.array(z.string()),
  last_validated_at: z.string().datetime().nullable().default(null),
});
export type DistilledSkill = z.infer<typeof DistilledSkillSchema>;

export const CandidateSkillSchema = DistilledSkillSchema.extend({
  reject_reasons: z.array(z.string()).default([]),
});
export type CandidateSkill = z.infer<typeof CandidateSkillSchema>;

export const SkillClusterSchema = z.object({
  id: z.string(),
  thesis: z.string(),
  origin_ids: z.array(z.string()),
  distilled_skill_id: z.string().nullable().default(null),
});
export type SkillCluster = z.infer<typeof SkillClusterSchema>;

export const LegacyExpandedSkillSchema = z.object({
  id: z.string(),
  origin_id: z.string(),
  name: z.string(),
  similarity: z.number().min(0).max(1),
  source_platform: z.string(),
  source_ref: z.string(),
  transferable_summary: z.string(),
  confidence: z.number().min(0).max(1),
});
export type LegacyExpandedSkill = z.infer<typeof LegacyExpandedSkillSchema>;

export const PersonaSkillLibraryV2Schema = z.object({
  schema_version: z.literal(2),
  persona_slug: z.string(),
  version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  source_trace: z.array(z.string()),
  origin_skills: z.array(OriginSkillSchema),
  distilled_skills: z.array(DistilledSkillSchema),
  candidate_skill_pool: z.array(CandidateSkillSchema).default([]),
  clusters: z.array(SkillClusterSchema),
  // Kept for backward compatibility + migration trace only.
  expanded_skills: z.array(LegacyExpandedSkillSchema).default([]),
  pending_candidates: z.array(OriginSkillSchema).default([]),
});
export type PersonaSkillLibrary = z.infer<typeof PersonaSkillLibraryV2Schema>;

export function createEmptySkillLibrary(slug: string): PersonaSkillLibrary {
  return {
    schema_version: 2,
    persona_slug: slug,
    version: 1,
    updated_at: new Date().toISOString(),
    source_trace: [],
    origin_skills: [],
    distilled_skills: [],
    candidate_skill_pool: [],
    clusters: [],
    expanded_skills: [],
    pending_candidates: [],
  };
}

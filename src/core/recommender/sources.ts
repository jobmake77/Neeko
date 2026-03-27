import { generateObject } from 'ai';
import { resolveModel } from '../../config/model.js';
import { z } from 'zod';

const RecommendationSchema = z.object({
  dimensions: z.array(z.object({
    name: z.string(),
    description: z.string(),
    candidates: z.array(z.object({
      platform: z.enum(['twitter', 'github', 'youtube', 'blog', 'reddit', 'linkedin']),
      handle_or_url: z.string(),
      reason: z.string(),
      estimated_quality: z.enum(['high', 'medium', 'low']),
    })),
  })),
});

/**
 * DataSourceRecommender — for Path B (multi-person fusion).
 * Takes a target skill description, decomposes it into dimensions,
 * and recommends data sources per dimension.
 */
export class DataSourceRecommender {
  async recommend(targetSkill: string): Promise<z.infer<typeof RecommendationSchema>> {
    const { object } = await generateObject({
      model: resolveModel(),
      schema: RecommendationSchema,
      prompt: `You are helping build a composite AI agent with the skill: "${targetSkill}".

Decompose this skill into 3-6 sub-dimensions, then for each dimension recommend 2-4 real public figures
or sources whose public content best represents excellence in that dimension.

Guidelines:
- Prioritize people with significant public writing/speaking/tweets
- Include diverse perspectives (not just one echo chamber)
- Flag if a source is likely inactive (hasn't posted in 90+ days)
- Platforms: twitter (X), github, youtube, blog, reddit, linkedin

Target skill: ${targetSkill}`,
    });

    return object;
  }

  /**
   * Validates that a Twitter account is active (has posted in last 90 days).
   * Returns true if active, false if potentially dead/inactive.
   * Uses agent-reach if available, otherwise skips validation.
   */
  async validateActivity(platform: string, handle: string): Promise<boolean> {
    if (platform !== 'twitter') return true; // Only validate Twitter for now

    try {
      const { execSync } = await import('child_process');
      const cleanHandle = handle.replace(/^@/, '');
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const cmd = `agent-reach search --platform twitter --query "from:${cleanHandle}" --since ${since} --limit 1 --format json`;
      const output = execSync(cmd, { timeout: 30_000 }).toString();
      const items = JSON.parse(output);
      return Array.isArray(items) && items.length > 0;
    } catch {
      // If agent-reach is not available, assume active
      return true;
    }
  }
}

import { MemoryStore } from './store.js';
import { MemoryNode } from '../models/memory.js';

/**
 * MemoryRetriever — hybrid search combining semantic (vector) similarity
 * with BM25-style keyword boosting and time-decay weighting.
 */
export class MemoryRetriever {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Retrieve the top-k most relevant active memory nodes for a query.
   * Applies time-decay: recent memories score higher.
   */
  async retrieve(
    collection: string,
    query: string,
    options: {
      limit?: number;
      soulDimension?: MemoryNode['soul_dimension'];
      minConfidence?: number;
      includeArchived?: boolean;
    } = {}
  ): Promise<MemoryNode[]> {
    const { limit = 10, soulDimension, minConfidence = 0.3, includeArchived = false } = options;

    // Fetch more than needed so we can re-rank
    const candidates = await this.store.search(collection, query, {
      limit: limit * 3,
      filter: {
        status: includeArchived ? undefined : 'active',
        soulDimension,
        minConfidence,
      },
    });

    // Re-rank with time decay + reinforcement boost
    const scored = candidates.map((node) => ({
      node,
      score: this.score(node, query),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => s.node);
  }

  /**
   * Retrieve memories that might CONTRADICT the given statement.
   * Useful for consistency checking in the training loop.
   */
  async retrieveContradictions(
    collection: string,
    statement: string,
    limit = 5
  ): Promise<MemoryNode[]> {
    const candidates = await this.store.search(collection, statement, {
      limit: limit * 4,
      filter: { status: 'active' },
    });

    return candidates
      .filter((n) => n.relations.some((r) => r.relation_type === 'CONTRADICTS'))
      .slice(0, limit);
  }

  /**
   * Build a formatted context string from retrieved memories, suitable
   * for injection into a system prompt or conversation.
   */
  formatContext(nodes: MemoryNode[], maxChars = 3000): string {
    if (nodes.length === 0) return '';

    const lines: string[] = ['## Relevant Memory Context'];
    let chars = 0;

    for (const node of nodes) {
      const entry = `\n[${node.category}/${node.soul_dimension}] ${node.summary}`;
      if (chars + entry.length > maxChars) break;
      lines.push(entry);
      chars += entry.length;
    }

    return lines.join('\n');
  }

  private score(node: MemoryNode, _query: string): number {
    let score = node.confidence;

    // Reinforcement boost (log scale to prevent runaway)
    if (node.reinforcement_count > 0) {
      score += Math.log(1 + node.reinforcement_count) * 0.1;
    }

    // Time decay: memories from the last year score higher
    if (node.time_reference) {
      const ageMs = Date.now() - new Date(node.time_reference).getTime();
      const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365);
      score *= Math.exp(-0.3 * ageYears); // half-life ~2.3 years
    }

    return score;
  }
}

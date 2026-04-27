import { MemoryStore } from './store.js';
import { MemoryNode } from '../models/memory.js';

const PROJECT_QUERY_PATTERN = /(开源|项目|作品|仓库|repo|repository|github|gitlab|project|projects|library|tool|app|apps|product|products|side project|side projects|oss|open source)/i;
const PROJECT_EVIDENCE_PATTERN = /(开源|项目|作品|仓库|repo|repository|github|gitlab|project|projects|library|tool|app|apps|product|products|star|stars|swift|rust|website|blog|editor|编辑器|周刊|网站|博客)/i;
const PROJECT_FOCUSED_CATEGORIES = new Set<MemoryNode['category']>(['fact', 'knowledge', 'experience']);
const PROJECT_FOCUSED_DIMENSIONS = new Set<MemoryNode['soul_dimension']>(['knowledge_domains', 'general']);
const PROJECT_GENERIC_DIMENSIONS = new Set<MemoryNode['soul_dimension']>(['values', 'thinking_patterns']);
const RELATION_QUERY_PATTERN = /(合作|关系|团队|组织|公司|朋友|同事|导师|inspired|collaborat|team|company|organization|with whom|who works with)/i;
const RELATION_EVIDENCE_PATTERN = /(合作|团队|组织|公司|社区|朋友|同事|导师|collaborat|team|company|organization|community|friend|mentor)/i;
const RELATION_FOCUSED_CATEGORIES = new Set<MemoryNode['category']>(['fact', 'experience', 'knowledge']);
const RELATION_FOCUSED_DIMENSIONS = new Set<MemoryNode['soul_dimension']>(['general', 'behavioral_traits', 'knowledge_domains']);

function isProjectFactQuery(query: string): boolean {
  return PROJECT_QUERY_PATTERN.test(query);
}

function isRelationFactQuery(query: string): boolean {
  return RELATION_QUERY_PATTERN.test(query);
}

function extractLexicalTerms(query: string): string[] {
  const asciiTerms = (query.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])
    .filter((term) => !['what', 'have', 'with', 'about', 'open', 'source', 'project', 'projects'].includes(term));
  const cjkTerms = (query.match(/[\u4e00-\u9fff]{2,12}/g) ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !['你有什么', '可以给我', '讲解一下', '这个项目', '有哪些项目'].includes(term));
  return Array.from(new Set([...asciiTerms, ...cjkTerms]));
}

function computeLexicalOverlap(query: string, haystack: string): number {
  const terms = extractLexicalTerms(query);
  if (terms.length === 0) return 0;
  const normalizedHaystack = haystack.toLowerCase();
  const hits = terms.filter((term) => normalizedHaystack.includes(term.toLowerCase())).length;
  return hits / terms.length;
}

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
    const projectFactQuery = isProjectFactQuery(query);
    const relationFactQuery = isRelationFactQuery(query);

    // Fetch more than needed so we can re-rank
    let candidates: MemoryNode[] = [];
    try {
      candidates = await this.store.search(collection, query, {
        limit: limit * (projectFactQuery || relationFactQuery ? 8 : 3),
        filter: {
          status: includeArchived ? undefined : 'active',
          soulDimension,
          minConfidence,
        },
      });
      if (projectFactQuery) {
        const expanded = await this.store.search(collection, `${query} github 开源 项目 仓库 repo`, {
          limit: limit * 4,
          filter: {
            status: includeArchived ? undefined : 'active',
            soulDimension,
            minConfidence,
          },
        });
        const merged = new Map<string, MemoryNode>();
        for (const node of [...candidates, ...expanded]) {
          merged.set(node.id, node);
        }
        candidates = Array.from(merged.values());
      }
      if (relationFactQuery) {
        const expanded = await this.store.search(collection, `${query} 合作 团队 组织 company community collaborator`, {
          limit: limit * 4,
          filter: {
            status: includeArchived ? undefined : 'active',
            soulDimension,
            minConfidence,
          },
        });
        const merged = new Map<string, MemoryNode>();
        for (const node of [...candidates, ...expanded]) {
          merged.set(node.id, node);
        }
        candidates = Array.from(merged.values());
      }
    } catch (error) {
      const message = String(error);
      const missingCollection = message.includes('Not Found') || message.includes('404');
      if (!missingCollection) throw error;
      // Some legacy personas were created before vector collection bootstrap.
      // Degrade gracefully to Soul-only chat instead of hard-failing.
      return [];
    }

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
    let candidates: MemoryNode[] = [];
    try {
      candidates = await this.store.search(collection, statement, {
        limit: limit * 4,
        filter: { status: 'active' },
      });
    } catch (error) {
      const message = String(error);
      const missingCollection = message.includes('Not Found') || message.includes('404');
      if (!missingCollection) throw error;
      return [];
    }

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
    const query = _query;
    const projectFactQuery = isProjectFactQuery(query);
    const relationFactQuery = isRelationFactQuery(query);
    const searchableText = [
      node.summary,
      node.original_text,
      node.source_url ?? '',
      ...(node.semantic_tags ?? []),
    ].join(' ');

    // Reinforcement boost (log scale to prevent runaway)
    if (node.reinforcement_count > 0) {
      score += Math.log(1 + node.reinforcement_count) * 0.1;
    }

    score += computeLexicalOverlap(query, searchableText) * 0.3;

    if (projectFactQuery) {
      if (PROJECT_FOCUSED_CATEGORIES.has(node.category)) score += 0.22;
      if (PROJECT_FOCUSED_DIMENSIONS.has(node.soul_dimension)) score += 0.14;
      if (PROJECT_GENERIC_DIMENSIONS.has(node.soul_dimension)) score -= 0.12;
      if (PROJECT_EVIDENCE_PATTERN.test(searchableText)) score += 0.25;
    }

    if (relationFactQuery) {
      if (RELATION_FOCUSED_CATEGORIES.has(node.category)) score += 0.18;
      if (RELATION_FOCUSED_DIMENSIONS.has(node.soul_dimension)) score += 0.12;
      if (RELATION_EVIDENCE_PATTERN.test(searchableText)) score += 0.22;
      if (PROJECT_GENERIC_DIMENSIONS.has(node.soul_dimension)) score -= 0.08;
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

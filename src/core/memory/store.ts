import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { MemoryNode } from '../models/memory.js';

const VECTOR_SIZE = 1536; // text-embedding-3-small

interface QdrantPayload {
  id: string;
  persona_id: string;
  original_text: string;
  summary: string;
  category: string;
  soul_dimension: string;
  source_chunk_id: string;
  source_type: string;
  source_url?: string;
  time_reference?: string;
  confidence: number;
  reinforcement_count: number;
  semantic_tags: string[];
  status: string;
  superseded_by?: string;
  relations: string; // JSON stringified
  created_at: string;
  updated_at: string;
}

/**
 * MemoryStore — wraps Qdrant for vector storage of MemoryNodes.
 * Embeddings are generated via OpenAI text-embedding-3-small.
 */
export class MemoryStore {
  private qdrant: QdrantClient;
  private openai: OpenAI;
  private embeddingApiKey: string;
  private loggedLocalFallback = false;

  constructor(options: {
    qdrantUrl?: string;
    qdrantApiKey?: string;
    openaiApiKey?: string;
  } = {}) {
    this.qdrant = new QdrantClient({
      url: options.qdrantUrl ?? 'http://localhost:6333',
      apiKey: options.qdrantApiKey,
    });
    this.embeddingApiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '';

    // Always use official OpenAI endpoint for embeddings to avoid accidental
    // proxy/baseURL overrides from shell environment.
    this.openai = new OpenAI({
      apiKey: this.embeddingApiKey,
      baseURL: 'https://api.openai.com/v1',
    });
  }

  async ensureCollection(collectionName: string): Promise<void> {
    const collections = await this.qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === collectionName);
    if (!exists) {
      await this.qdrant.createCollection(collectionName, {
        vectors: {
          size: VECTOR_SIZE,
          distance: 'Cosine',
        },
        optimizers_config: {
          default_segment_number: 2,
        },
      });
    }
  }

  async upsert(collection: string, node: MemoryNode): Promise<void> {
    const text = `${node.summary}\n\n${node.original_text.slice(0, 1000)}`;
    const embedding = await this.embed(text);

    const payload: QdrantPayload = {
      id: node.id,
      persona_id: node.persona_id,
      original_text: node.original_text,
      summary: node.summary,
      category: node.category,
      soul_dimension: node.soul_dimension,
      source_chunk_id: node.source_chunk_id,
      source_type: node.source_type,
      source_url: node.source_url,
      time_reference: node.time_reference,
      confidence: node.confidence,
      reinforcement_count: node.reinforcement_count,
      semantic_tags: node.semantic_tags,
      status: node.status,
      superseded_by: node.superseded_by,
      relations: JSON.stringify(node.relations),
      created_at: node.created_at,
      updated_at: node.updated_at,
    };

    await this.qdrant.upsert(collection, {
      points: [
        {
          id: this.uuidToUint(node.id),
          vector: embedding,
          payload: payload as unknown as Record<string, unknown>,
        },
      ],
    });
  }

  async search(
    collection: string,
    query: string,
    options: {
      limit?: number;
      filter?: { soulDimension?: string; status?: string; minConfidence?: number };
    } = {}
  ): Promise<MemoryNode[]> {
    const { limit = 10, filter = {} } = options;
    const embedding = await this.embed(query);

    const must: Array<Record<string, unknown>> = [];
    if (filter.status) {
      must.push({ key: 'status', match: { value: filter.status } });
    }
    if (filter.soulDimension) {
      must.push({ key: 'soul_dimension', match: { value: filter.soulDimension } });
    }
    if (filter.minConfidence !== undefined) {
      must.push({ key: 'confidence', range: { gte: filter.minConfidence } });
    }

    const results = await this.qdrant.search(collection, {
      vector: embedding,
      limit,
      filter: must.length > 0 ? { must } : undefined,
      with_payload: true,
    });

    return results
      .map((r) => this.payloadToNode(r.payload as unknown as QdrantPayload))
      .filter((n): n is MemoryNode => n !== null);
  }

  async updateReinforcement(collection: string, nodeId: string, delta = 1): Promise<void> {
    // Qdrant doesn't support partial payload update for arrays natively
    // We'll just update the reinforcement_count field via set payload
    const numericId = this.uuidToUint(nodeId);
    await this.qdrant.setPayload(collection, {
      payload: { reinforcement_count: delta } as Record<string, unknown>,
      points: [numericId],
    });
  }

  async archiveNode(collection: string, nodeId: string, supersededBy?: string): Promise<void> {
    const numericId = this.uuidToUint(nodeId);
    const payload: Record<string, unknown> = { status: 'archived' };
    if (supersededBy) payload.superseded_by = supersededBy;
    await this.qdrant.setPayload(collection, { payload, points: [numericId] });
  }

  async count(collection: string, status = 'active'): Promise<number> {
    const result = await this.qdrant.count(collection, {
      filter: {
        must: [{ key: 'status', match: { value: status } }],
      },
    });
    return result.count;
  }

  private async embed(text: string): Promise<number[]> {
    if (!this.embeddingApiKey) {
      this.logLocalFallbackOnce('OPENAI_API_KEY 未配置');
      return this.localEmbed(text);
    }

    try {
      const res = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      });
      return res.data[0].embedding;
    } catch (error) {
      const message = String(error);
      const shouldFallback =
        message.includes('Incorrect API key provided') ||
        message.includes('invalid_api_key') ||
        message.includes('404 page not found') ||
        message.includes('ENOTFOUND') ||
        message.includes('ECONNREFUSED');

      if (!shouldFallback) throw error;
      this.logLocalFallbackOnce('OpenAI embedding 调用失败，切换为本地 embedding 回退');
      return this.localEmbed(text);
    }
  }

  private localEmbed(text: string): number[] {
    const vector = new Array<number>(VECTOR_SIZE).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2000);

    for (const token of tokens) {
      const h1 = fnv1a32(token);
      const h2 = fnv1a32(`${token}#salt`);
      const idx = h1 % VECTOR_SIZE;
      const sign = (h2 & 1) === 0 ? 1 : -1;
      vector[idx] += sign * (1 + (h2 % 7) / 10);
    }

    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    return vector.map((v) => v / norm);
  }

  private logLocalFallbackOnce(reason: string): void {
    if (this.loggedLocalFallback) return;
    this.loggedLocalFallback = true;
    console.warn(`[MemoryStore] ${reason}，使用本地 embedding（质量较低但可继续培养）`);
  }

  private uuidToUint(uuid: string): number {
    // Convert UUID to a stable unsigned 64-bit-range integer for Qdrant
    const hex = uuid.replace(/-/g, '');
    return parseInt(hex.slice(0, 12), 16) % 2 ** 52;
  }

  private payloadToNode(payload: QdrantPayload | null): MemoryNode | null {
    if (!payload) return null;
    try {
      return {
        id: payload.id,
        persona_id: payload.persona_id,
        original_text: payload.original_text,
        summary: payload.summary,
        category: payload.category as MemoryNode['category'],
        soul_dimension: payload.soul_dimension as MemoryNode['soul_dimension'],
        source_chunk_id: payload.source_chunk_id,
        source_type: payload.source_type as MemoryNode['source_type'],
        source_url: payload.source_url,
        time_reference: payload.time_reference,
        confidence: payload.confidence,
        reinforcement_count: payload.reinforcement_count,
        semantic_tags: payload.semantic_tags,
        status: payload.status as 'active' | 'archived',
        superseded_by: payload.superseded_by,
        relations: JSON.parse(payload.relations || '[]'),
        created_at: payload.created_at,
        updated_at: payload.updated_at,
      };
    } catch {
      return null;
    }
  }
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

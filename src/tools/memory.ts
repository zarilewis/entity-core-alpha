/**
 * Memory Tools
 *
 * MCP tools for creating and searching my memories.
 * All tools operate from my first-person perspective.
 */

import { z } from "zod";
import type { FileStore } from "../storage/mod.ts";
import type { GraphStore } from "../graph/mod.ts";
import type { MemoryEntry, Granularity } from "../types.ts";
import { getEmbedder } from "../embeddings/mod.ts";

/**
 * Schema for memory granularity.
 */
const GranularitySchema = z.enum(["daily", "weekly", "monthly", "yearly", "significant"]);

/**
 * Input schema for memory/create tool.
 */
export const MemoryCreateSchema = z.object({
  granularity: GranularitySchema,
  date: z.string().regex(/^\d{4}(-W\d{2}|(-\d{2})?(-\d{2})?)$/),
  content: z.string().min(1),
  chatIds: z.array(z.string()).optional().default([]),
  instanceId: z.string().min(1),
  participatingInstances: z.array(z.string()).optional(),
  slug: z.string().optional(),
});

/**
 * Input schema for memory/search tool.
 */
export const MemorySearchSchema = z.object({
  query: z.string().min(1),
  instanceId: z.string().min(1),
  queryEmbedding: z.array(z.number()).optional(),
  minScore: z.number().min(0).max(1).optional(),
  maxResults: z.number().min(1).max(50).optional(),
});

/**
 * Input schema for memory/list tool.
 */
export const MemoryListSchema = z.object({
  granularity: GranularitySchema.optional(),
  limit: z.number().min(1).max(100).optional(),
});

/**
 * Input schema for memory/read tool.
 */
export const MemoryReadSchema = z.object({
  granularity: GranularitySchema,
  date: z.string().regex(/^\d{4}(-W\d{2}|(-\d{2})?(-\d{2})?)$/),
});

/**
 * Input schema for memory/update tool.
 */
export const MemoryUpdateSchema = z.object({
  granularity: GranularitySchema,
  date: z.string().regex(/^\d{4}(-W\d{2}|(-\d{2})?(-\d{2})?)$/),
  content: z.string().min(1),
  editedBy: z.string().optional(),
  instanceId: z.string().optional(),
});

/**
 * Output type for memory/read tool.
 */
export interface MemoryReadOutput {
  success: boolean;
  memory?: MemoryEntry;
  message?: string;
}

/**
 * Output type for memory/update tool.
 */
export interface MemoryUpdateOutput {
  success: boolean;
  message: string;
  memoryId?: string;
}

/**
 * Input schema for memory/delete tool.
 */
export const MemoryDeleteSchema = z.object({
  granularity: GranularitySchema,
  date: z.string().min(1),
  instanceId: z.string().optional(),
  slug: z.string().optional(),
});

export interface MemoryDeleteOutput {
  success: boolean;
  message: string;
}

/**
 * Output type for memory/create tool.
 */
export interface MemoryCreateOutput {
  success: boolean;
  message: string;
  memoryId?: string;
}

/**
 * Output type for memory/search tool.
 */
export interface MemorySearchOutput {
  results: Array<{
    granularity: string;
    date: string;
    score: number;
    excerpt: string;
    sourceInstance: string;
    tier: string;
    ageDays: number;
    vectorScore: number;
    method: "vector" | "text";
  }>;
  searchMethod: "vector" | "text";
  vectorAvailable: boolean;
}

/**
 * Output type for memory/list tool.
 */
export interface MemoryListOutput {
  memories: Array<{
    granularity: string;
    date: string;
    preview: string;
  }>;
}

/**
 * Create the memory/create tool handler.
 */
export function createMemoryCreateHandler(store: FileStore) {
  return async (input: z.infer<typeof MemoryCreateSchema>): Promise<MemoryCreateOutput> => {
    const { granularity, date, content, chatIds, instanceId, participatingInstances, slug } = input;

    const memory: MemoryEntry = {
      id: `${granularity}-${date}`,
      granularity: granularity as Granularity,
      date,
      content,
      chatIds,
      sourceInstance: instanceId,
      participatingInstances: participatingInstances ?? [instanceId],
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slug: slug,
    };

    await store.writeMemory(memory);

    return {
      success: true,
      message: `I have recorded a ${granularity} memory for ${date}.`,
      memoryId: memory.id,
    };
  };
}

/**
 * Create the memory/search tool handler.
 *
 * Uses multi-signal ranking:
 *   finalScore = (vectorScore × 0.6) + (recencyScore × 0.15) + (graphBoost × 0.15) + (instanceBoost × 0.1)
 *
 * Falls back to text matching if vector search is unavailable.
 */
export function createMemorySearchHandler(store: FileStore, graphStore: GraphStore, config: {
  instanceBoost?: number;
  minScore?: number;
  maxResults?: number;
} = {}) {
  const { instanceBoost = 0.1, minScore = 0.3, maxResults = 10 } = config;

  // Scoring weights
  const VECTOR_WEIGHT = 0.6;
  const RECENCY_WEIGHT = 0.15;
  const GRAPH_WEIGHT = 0.15;
  const INSTANCE_WEIGHT = 0.1;
  // Recency decay rate: half-life ~69 days
  const RECENCY_DECAY_RATE = 0.01;

  return async (input: z.infer<typeof MemorySearchSchema>): Promise<MemorySearchOutput> => {
    const { query, instanceId } = input;
    const maxResultsActual = input.maxResults ?? maxResults;
    const minScoreActual = input.minScore ?? minScore;

    // Try vector search first
    const queryEmbedding = input.queryEmbedding ?? await getEmbedder().embed(query);
    if (queryEmbedding) {
      return await vectorSearch(
        queryEmbedding,
        query,
        instanceId,
        store,
        graphStore,
        maxResultsActual,
        minScoreActual,
        { VECTOR_WEIGHT, RECENCY_WEIGHT, GRAPH_WEIGHT, INSTANCE_WEIGHT, RECENCY_DECAY_RATE, instanceBoost },
      );
    }

    // Fall back to text matching
    return textSearch(query, instanceId, store, maxResultsActual, minScoreActual, instanceBoost);
  };
}

/**
 * Compute recency score based on memory age.
 * Uses inverse decay: recencyScore = 1 / (1 + age_days × decay_rate)
 * Half-life ~69 days with default decay_rate of 0.01.
 */
function computeRecencyScore(memoryDate: string, decayRate: number): number {
  try {
    const memoryTime = new Date(memoryDate).getTime();
    const now = Date.now();
    const ageDays = Math.max(0, (now - memoryTime) / (1000 * 60 * 60 * 24));
    return 1 / (1 + ageDays * decayRate);
  } catch {
    return 0.5; // Neutral score if date can't be parsed
  }
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Vector-based memory search with multi-signal ranking.
 *
 * Reads memory files from the FileStore, embeds their content, and scores
 * using vector similarity + recency + graph entity boost + instance affinity.
 */
async function vectorSearch(
  queryEmbedding: number[],
  query: string,
  instanceId: string,
  store: FileStore,
  graphStore: GraphStore,
  maxResults: number,
  minScore: number,
  weights: {
    VECTOR_WEIGHT: number;
    RECENCY_WEIGHT: number;
    GRAPH_WEIGHT: number;
    INSTANCE_WEIGHT: number;
    RECENCY_DECAY_RATE: number;
    instanceBoost: number;
  },
): Promise<MemorySearchOutput> {
  const results: MemorySearchOutput["results"] = [];

  // Step 1: Search graph for entity nodes related to the query (for graph boost signal)
  const entityResults = graphStore.searchNodes({
    queryEmbedding,
    minScore: 0.3,
    limit: 20,
  });
  const relevantEntityLabels = new Set<string>();
  for (const er of entityResults) {
    relevantEntityLabels.add(er.node.label.toLowerCase());
  }

  // Step 2: Load all memories and compute embeddings
  const embedder = getEmbedder();
  const granularities: Granularity[] = ["daily", "weekly", "monthly", "yearly", "significant"];

  const scored: Array<{
    memoryId: string;
    granularity: string;
    date: string;
    sourceInstance: string;
    content: string;
    vectorScore: number;
    recencyScore: number;
    graphBoost: number;
    instanceScore: number;
    finalScore: number;
  }> = [];

  for (const granularity of granularities) {
    const memories = await store.listMemories(granularity);

    for (const memory of memories) {
      // Embed memory content (truncate to avoid excessive computation)
      const content = memory.content.substring(0, 3000);
      const memoryEmbedding = await embedder.embed(content);
      if (!memoryEmbedding) continue;

      const vectorScore = cosineSimilarity(queryEmbedding, memoryEmbedding);

      // Skip if vector score is too low (early filter)
      if (vectorScore < minScore * 0.5) continue;

      // Recency score
      const recencyScore = computeRecencyScore(memory.date, weights.RECENCY_DECAY_RATE);

      // Graph boost: check if memory content mentions any high-scoring entity labels
      let graphBoost = 0;
      if (relevantEntityLabels.size > 0) {
        const lowerContent = content.toLowerCase();
        let matchCount = 0;
        for (const label of relevantEntityLabels) {
          if (lowerContent.includes(label)) {
            matchCount++;
          }
        }
        if (matchCount > 0) {
          // Normalize: more entity matches = higher boost, but diminishing returns
          graphBoost = Math.min(1, matchCount / Math.log(matchCount + 2));
        }
      }

      // Instance boost
      const instanceScore = memory.sourceInstance === instanceId ? weights.instanceBoost : 0;

      // Compute final score
      const finalScore = (vectorScore * weights.VECTOR_WEIGHT) +
        (recencyScore * weights.RECENCY_WEIGHT) +
        (graphBoost * weights.GRAPH_WEIGHT) +
        (instanceScore * weights.INSTANCE_WEIGHT);

      scored.push({
        memoryId: memory.id,
        granularity: memory.granularity,
        date: memory.date,
        sourceInstance: memory.sourceInstance,
        content: memory.content,
        vectorScore,
        recencyScore,
        graphBoost,
        instanceScore,
        finalScore,
      });
    }
  }

  // Step 3: Sort by final score
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Step 4: Build output with excerpts
  for (const item of scored) {
    if (results.length >= maxResults) break;
    if (item.finalScore < minScore) break; // Sorted, so we can stop early

    // Find the best excerpt: try to find a sentence containing query terms
    const excerpt = findBestExcerpt(item.content, query);

    results.push({
      granularity: item.granularity,
      date: item.date,
      score: Math.round(item.finalScore * 1000) / 1000,
      excerpt,
      sourceInstance: item.sourceInstance,
      tier: item.granularity,
      ageDays: Math.max(0, Math.round((Date.now() - new Date(item.date).getTime()) / (1000 * 60 * 60 * 24))),
      vectorScore: Math.round(item.vectorScore * 1000) / 1000,
      method: "vector",
    });
  }

  return { results, searchMethod: "vector", vectorAvailable: true };
}

/**
 * Find the best excerpt from memory content for a given query.
 * Tries to find a sentence containing query terms, falls back to first 200 chars.
 */
function findBestExcerpt(content: string, query: string): string {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (queryWords.length === 0) {
    return content.length > 200 ? content.slice(0, 200).trim() + "..." : content;
  }

  // Try to find a sentence that contains the most query words
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);

  let bestSentence = "";
  let bestMatchCount = 0;

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    let matchCount = 0;
    for (const word of queryWords) {
      if (lower.includes(word)) matchCount++;
    }
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestSentence = sentence.trim();
    }
  }

  if (bestMatchCount > 0 && bestSentence) {
    return bestSentence.length > 200
      ? bestSentence.slice(0, 200).trim() + "..."
      : bestSentence;
  }

  return content.length > 200 ? content.slice(0, 200).trim() + "..." : content;
}

/**
 * Text-based fallback memory search (original behavior).
 */
async function textSearch(
  query: string,
  instanceId: string,
  store: FileStore,
  maxResults: number,
  minScore: number,
  instanceBoost: number,
): Promise<MemorySearchOutput> {
  const results: MemorySearchOutput["results"] = [];
  const granularities: Granularity[] = ["daily", "weekly", "monthly", "yearly", "significant"];

  for (const granularity of granularities) {
    const memories = await store.listMemories(granularity);

    for (const memory of memories) {
      const lowerQuery = query.toLowerCase();
      const lowerContent = memory.content.toLowerCase();

      let score = 0;

      if (lowerContent.includes(lowerQuery)) {
        score = 0.7;
      } else {
        const queryWords = lowerQuery.split(/\s+/);
        const contentWords = lowerContent.split(/\s+/);
        const overlap = queryWords.filter((w: string) => contentWords.includes(w)).length;
        score = overlap / queryWords.length * 0.5;
      }

      if (memory.sourceInstance === instanceId) {
        score += instanceBoost;
      }

      if (score >= minScore) {
        const excerptStart = lowerContent.indexOf(lowerQuery.split(/\s+/)[0]);
        const excerpt = excerptStart >= 0
          ? memory.content.slice(Math.max(0, excerptStart - 50), excerptStart + 200)
          : memory.content.slice(0, 200);

        const ageDays = Math.max(0, Math.round(
          (Date.now() - new Date(memory.date).getTime()) / (1000 * 60 * 60 * 24)
        ));

        results.push({
          granularity: memory.granularity,
          date: memory.date,
          score: Math.min(score, 1),
          excerpt: excerpt.trim() + (memory.content.length > 200 ? "..." : ""),
          sourceInstance: memory.sourceInstance,
          tier: memory.granularity,
          ageDays,
          vectorScore: 0,
          method: "text",
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);

  return { results: results.slice(0, maxResults), searchMethod: "text", vectorAvailable: false };
}

/**
 * Create the memory/list tool handler.
 */
export function createMemoryListHandler(store: FileStore) {
  return async (input: z.infer<typeof MemoryListSchema>): Promise<MemoryListOutput> => {
    const { granularity, limit = 20 } = input;
    const memories: MemoryListOutput["memories"] = [];

    const granularities: Granularity[] = granularity
      ? [granularity as Granularity]
      : ["daily", "weekly", "monthly", "yearly", "significant"];

    for (const g of granularities) {
      const list = await store.listMemories(g);

      for (const memory of list) {
        memories.push({
          granularity: memory.granularity,
          date: memory.date,
          preview: memory.content.slice(0, 100) + (memory.content.length > 100 ? "..." : ""),
        });
      }
    }

    // Sort by date (newest first) and limit
    memories.sort((a, b) => b.date.localeCompare(a.date));

    return { memories: memories.slice(0, limit) };
  };
}

/**
 * Create the memory/read tool handler.
 */
export function createMemoryReadHandler(store: FileStore) {
  return async (input: z.infer<typeof MemoryReadSchema>): Promise<MemoryReadOutput> => {
    const { granularity, date } = input;

    const memory = await store.readMemory(granularity, date);

    if (!memory) {
      return {
        success: false,
        message: `No memory found for ${granularity}/${date}.`,
      };
    }

    return {
      success: true,
      memory,
    };
  };
}

/**
 * Create the memory/update tool handler.
 *
 * Explicitly overwrites a memory (no append merge).
 * Sets editedBy field for future conflict resolution awareness.
 */
export function createMemoryUpdateHandler(store: FileStore) {
  return async (input: z.infer<typeof MemoryUpdateSchema>): Promise<MemoryUpdateOutput> => {
    const { granularity, date, content, editedBy, instanceId } = input;

    // Read existing memory to preserve metadata.
    // When instanceId is not provided, search across all instance variants
    // (e.g. for daily memories with instance-scoped filenames).
    const existing = instanceId
      ? await store.readMemory(granularity, date, instanceId)
      : await store.findMemoryByDate(granularity, date);

    const memory: MemoryEntry = {
      id: `${granularity}-${date}`,
      granularity: granularity as Granularity,
      date,
      content,
      chatIds: existing?.chatIds ?? [],
      sourceInstance: existing?.sourceInstance ?? editedBy ?? instanceId ?? "",
      participatingInstances: existing?.participatingInstances,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.writeMemory(memory);

    return {
      success: true,
      message: `I have updated the ${granularity} memory for ${date}.`,
      memoryId: memory.id,
    };
  };
}

/**
 * Tool definitions for MCP registration.
 */
/**
 * Create the memory/delete tool handler.
 */
export function createMemoryDeleteHandler(store: FileStore) {
  return async (input: z.infer<typeof MemoryDeleteSchema>): Promise<MemoryDeleteOutput> => {
    const { granularity, date, instanceId, slug } = input;

    const deleted = await store.deleteMemory(
      granularity as Granularity,
      date,
      instanceId,
      slug,
    );

    return {
      success: deleted,
      message: deleted
        ? `Deleted ${granularity} memory: ${date}`
        : `Memory not found: ${granularity}/${date}`,
    };
  };
}

export const memoryTools = {
  "memory/create": {
    description:
      "Create a new memory entry. I use this to record things worth remembering from our conversations. Tag each bullet point with the chat ID and instance: [chat:ID] [via:instanceId].",
    inputSchema: MemoryCreateSchema,
  },
  "memory/search": {
    description:
      "Search my memories for relevant content. Uses vector similarity with multi-signal ranking (semantic relevance, recency, graph context, and instance affinity). Falls back to text matching if embeddings are unavailable.",
    inputSchema: MemorySearchSchema,
  },
  "memory/list": {
    description:
      "List my memories, optionally filtered by granularity. Use this to see what I've been remembering.",
    inputSchema: MemoryListSchema,
  },
  "memory/read": {
    description:
      "Read a single memory entry by granularity and date. Returns the full content and metadata.",
    inputSchema: MemoryReadSchema,
  },
  "memory/update": {
    description:
      "Overwrite a memory entry. Use this to correct inaccuracies in my recorded memories. Unlike memory/create, this replaces content entirely (no append merge). Tracks who made the edit via editedBy.",
    inputSchema: MemoryUpdateSchema,
  },
  "memory/delete": {
    description:
      "Permanently delete a memory entry. I use this to remove memories that are no longer relevant or were created in error.",
    inputSchema: MemoryDeleteSchema,
  },
};

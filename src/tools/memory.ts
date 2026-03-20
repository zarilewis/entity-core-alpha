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
    const { granularity, date, content, chatIds, instanceId, participatingInstances } = input;

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
    if (queryEmbedding && graphStore.isVectorSearchAvailable()) {
      return vectorSearch(
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
 * Vector-based memory search with multi-signal ranking.
 */
function vectorSearch(
  queryEmbedding: number[],
  _query: string,
  instanceId: string,
  _store: FileStore,
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
): MemorySearchOutput {
  const results: MemorySearchOutput["results"] = [];

  // Step 1: Vector search for memory_ref nodes (over-fetch 3× for post-filtering)
  const memoryRefResults = graphStore.searchNodes({
    queryEmbedding,
    type: "memory_ref",
    minScore: minScore * 0.5, // Lower threshold for candidates — final scoring applies minScore
    limit: maxResults * 3,
  });

  // Step 2: Also search for entity nodes to compute graph boost
  const entityResults = graphStore.searchNodes({
    queryEmbedding,
    minScore: 0.3,
    limit: 20,
  });
  // Build a map of high-scoring entity node IDs for quick lookup
  const relevantEntityIds = new Map<string, number>();
  for (const er of entityResults) {
    if (er.node.type !== "memory_ref") {
      relevantEntityIds.set(er.node.id, er.score);
    }
  }

  // Step 3: Score each memory_ref result with multi-signal ranking
  const scored: Array<{
    memoryId: string;
    granularity: string;
    date: string;
    sourceInstance: string;
    description: string;
    vectorScore: number;
    recencyScore: number;
    graphBoost: number;
    instanceScore: number;
    finalScore: number;
  }> = [];

  for (const result of memoryRefResults) {
    const node = result.node;
    const vectorScore = result.score;
    const memoryId = node.sourceMemoryId;
    if (!memoryId) continue;

    // Parse memory ID to get granularity and date
    // Format: "granularity-date" (e.g., "daily-2026-03-19", "weekly-2026-W12")
    const dashIndex = memoryId.indexOf("-");
    if (dashIndex === -1) continue;
    const granularity = memoryId.slice(0, dashIndex) as Granularity;
    const date = memoryId.slice(dashIndex + 1);

    // Recency score
    const recencyScore = computeRecencyScore(date, weights.RECENCY_DECAY_RATE);

    // Graph boost: check how many of this memory's linked entities match the query
    let graphBoost = 0;
    try {
      const linkedNodes = graphStore.getNodesForMemory(memoryId);
      if (linkedNodes.length > 0 && relevantEntityIds.size > 0) {
        let matchScore = 0;
        for (const linkedNode of linkedNodes) {
          const entityScore = relevantEntityIds.get(linkedNode.id);
          if (entityScore !== undefined) {
            matchScore += entityScore;
          }
        }
        // Normalize by log(linkedNodes.length + 1) to avoid false positives from heavily-linked memories
        if (matchScore > 0) {
          graphBoost = Math.min(1, matchScore / Math.log(linkedNodes.length + 1));
        }
      }
    } catch {
      // Graph lookup failure is non-fatal
    }

    // Instance boost
    const instanceScore = node.sourceInstance === instanceId ? weights.instanceBoost : 0;

    // Compute final score
    const finalScore = (vectorScore * weights.VECTOR_WEIGHT) +
      (recencyScore * weights.RECENCY_WEIGHT) +
      (graphBoost * weights.GRAPH_WEIGHT) +
      (instanceScore * weights.INSTANCE_WEIGHT);

    scored.push({
      memoryId,
      granularity,
      date,
      sourceInstance: node.sourceInstance,
      description: node.description ?? "",
      vectorScore,
      recencyScore,
      graphBoost,
      instanceScore,
      finalScore,
    });
  }

  // Step 4: Sort by final score
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Step 5: Build output with excerpts (use memory_ref description as excerpt)
  for (const item of scored) {
    if (results.length >= maxResults) break;
    if (item.finalScore < minScore) break; // Sorted, so we can stop early

    const excerpt = item.description.length > 200
      ? item.description.slice(0, 200).trim() + "..."
      : item.description;

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
 * Tool definitions for MCP registration.
 */
export const memoryTools = {
  "memory/create": {
    description:
      "Create a new memory entry. I use this to record things worth remembering from our conversations.",
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
};

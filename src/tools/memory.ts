/**
 * Memory Tools
 *
 * MCP tools for creating and searching my memories.
 * All tools operate from my first-person perspective.
 */

import { z } from "zod";
import type { FileStore } from "../storage/mod.ts";
import type { MemoryEntry, Granularity } from "../types.ts";

/**
 * Schema for memory granularity.
 */
const GranularitySchema = z.enum(["daily", "weekly", "monthly", "yearly", "significant"]);

/**
 * Input schema for memory/create tool.
 */
export const MemoryCreateSchema = z.object({
  granularity: GranularitySchema,
  date: z.string().regex(/^\d{4}(-\d{2})?(-\d{2})?$/),
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
  }>;
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
 * TODO: Implement actual RAG search with embeddings.
 */
export function createMemorySearchHandler(store: FileStore, config: {
  instanceBoost?: number;
  minScore?: number;
  maxResults?: number;
} = {}) {
  const { instanceBoost = 0.1, minScore = 0.3, maxResults = 10 } = config;

  return async (input: z.infer<typeof MemorySearchSchema>): Promise<MemorySearchOutput> => {
    const { query, instanceId } = input;
    const results: MemorySearchOutput["results"] = [];

    // TODO: Replace with actual RAG search
    // For now, do simple text matching
    const granularities: Granularity[] = ["daily", "weekly", "monthly", "yearly", "significant"];

    for (const granularity of granularities) {
      const memories = await store.listMemories(granularity);

      for (const memory of memories) {
        // Simple text similarity (case-insensitive substring match)
        const lowerQuery = query.toLowerCase();
        const lowerContent = memory.content.toLowerCase();

        let score = 0;

        // Check for exact phrase match
        if (lowerContent.includes(lowerQuery)) {
          score = 0.7;
        } else {
          // Check for word overlap
          const queryWords = lowerQuery.split(/\s+/);
          const contentWords = lowerContent.split(/\s+/);
          const overlap = queryWords.filter((w: string) => contentWords.includes(w)).length;
          score = overlap / queryWords.length * 0.5;
        }

        // Apply instance boost
        if (memory.sourceInstance === instanceId) {
          score += instanceBoost;
        }

        if (score >= (input.minScore ?? minScore)) {
          // Create excerpt
          const excerptStart = lowerContent.indexOf(lowerQuery.split(/\s+/)[0]);
          const excerpt = excerptStart >= 0
            ? memory.content.slice(Math.max(0, excerptStart - 50), excerptStart + 200)
            : memory.content.slice(0, 200);

          results.push({
            granularity: memory.granularity,
            date: memory.date,
            score: Math.min(score, 1),
            excerpt: excerpt.trim() + (memory.content.length > 200 ? "..." : ""),
            sourceInstance: memory.sourceInstance,
          });
        }
      }
    }

    // Sort by score and limit results
    results.sort((a, b) => b.score - a.score);
    const limited = results.slice(0, input.maxResults ?? maxResults);

    return { results: limited };
  };
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
      "Search my memories for relevant content. Results are ranked by relevance, with extra weight for memories from the same embodiment.",
    inputSchema: MemorySearchSchema,
  },
  "memory/list": {
    description:
      "List my memories, optionally filtered by granularity. Use this to see what I've been remembering.",
    inputSchema: MemoryListSchema,
  },
};

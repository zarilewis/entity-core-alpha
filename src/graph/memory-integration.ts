/**
 * Memory Integration
 *
 * Auto-extracts entities and relationships from memory content
 * and links them to my knowledge graph.
 */

import type { GraphStore } from "./store.ts";
import type { MemoryEntry } from "../types.ts";
import { createLLMClient } from "../llm/mod.ts";
import { getEmbedder } from "../embeddings/mod.ts";

/**
 * Result of extracting entities from a memory into the graph.
 */
export interface ExtractionResult {
  nodesCreated: number;
  edgesCreated: number;
  memoryNodeId: string | null;
}

/**
 * Extract entities and relationships from a memory and create graph nodes/edges.
 *
 * This is designed to be called in the background (fire-and-forget) after a
 * memory is written, so it never blocks the memory_create response.
 */
export async function extractMemoryToGraph(
  memory: MemoryEntry,
  graphStore: GraphStore,
  instanceId: string,
): Promise<ExtractionResult> {
  const empty: ExtractionResult = { nodesCreated: 0, edgesCreated: 0, memoryNodeId: null };

  // Skip short/trivial content
  if (memory.content.trim().length < 100) {
    return empty;
  }

  // Create LLM client — returns null if no API key configured
  const llm = createLLMClient();
  if (!llm) {
    return empty;
  }

  // Ensure graph store is initialized
  await graphStore.initialize();

  // Build extraction prompt (adapted from scripts/extract-memories-to-graph.ts)
  const dateContext = ` from ${memory.date}`;
  const prompt = `I analyze my memory${dateContext} and identify entities and relationships worth remembering in my knowledge graph.

I extract:
- **Entities**: People, topics, events, preferences, places, goals, concepts that matter to me
- **Relationships**: How these entities connect to each other and to the user

CRITICAL - First-Person Perspective:
- This graph stores how I see the world, not how someone observes me
- When referring to myself, ALWAYS use label "me" (type: "self")
- When referring to the user, use label "user" (or their actual name if mentioned)

Guidelines:
- Use consistent, simple entity labels (e.g., "user" not "the user")
- ALWAYS create a "me" entity if I mention myself, my feelings, or my experiences
- ALWAYS create or reference the "user" entity when the user is mentioned
- Include confidence scores (0.0-1.0) based on how clearly the entity/relationship is expressed
- Focus on what matters for long-term understanding
- Skip generic or trivial mentions
- Entity types: self, person, topic, event, preference, place, goal, health, boundary, tradition, insight (or any appropriate type)
- Relationship types: use natural language that best describes the connection. Examples: loves, dislikes, respects, proud_of, worried_about, nostalgic_for, works_at, lives_in, studies, values, believes_in, skilled_at, interested_in, family_of, friend_of, close_to, reminds_of, mentioned_in, caused, led_to, part_of, associated_with (or any descriptive type)

Memory content:
${memory.content.substring(0, 3000)}

I respond in JSON format only (no markdown):
{
  "entities": [
    {"type": "self|person|topic|event|preference|place|goal|...", "label": "...", "description": "...", "confidence": 0.8}
  ],
  "relationships": [
    {"fromLabel": "...", "toLabel": "...", "type": "loves|works_at|values|close_to|...", "evidence": "...", "confidence": 0.7}
  ]
}`;

  let extraction: {
    entities: Array<{ type: string; label: string; description?: string; confidence: number }>;
    relationships: Array<{ fromLabel: string; toLabel: string; type: string; evidence?: string; confidence: number }>;
  };

  try {
    extraction = await llm.completeJSON<{
      entities: Array<{ type: string; label: string; description?: string; confidence: number }>;
      relationships: Array<{ fromLabel: string; toLabel: string; type: string; evidence?: string; confidence: number }>;
    }>(prompt, { temperature: 0.3 });
  } catch (error) {
    console.error(`[Graph] LLM extraction failed for ${memory.id}:`, error instanceof Error ? error.message : error);
    return empty;
  }

  const entities = extraction.entities || [];
  const relationships = extraction.relationships || [];

  if (entities.length === 0 && relationships.length === 0) {
    return empty;
  }

  // Use a transaction to atomically create all nodes and edges
  return graphStore.transaction(() => {
    let nodesCreated = 0;
    let edgesCreated = 0;
    let memoryNodeId: string | null = null;

    // Map entity labels to node IDs for edge creation
    const labelToId = new Map<string, string>();

    // Create or dedup entity nodes
    for (const entity of entities) {
      const labelLower = entity.label.toLowerCase();
      if (labelToId.has(labelLower)) continue;

      const existing = graphStore.findNodeByLabel(entity.label, entity.type);
      if (existing) {
        labelToId.set(labelLower, existing.id);
        continue;
      }

      const node = graphStore.createNode({
        type: entity.type,
        label: entity.label,
        description: entity.description,
        sourceInstance: instanceId,
        confidence: entity.confidence,
        properties: {},
      });

      labelToId.set(labelLower, node.id);
      nodesCreated++;
    }

    // Create relationship edges
    for (const rel of relationships) {
      const fromId = labelToId.get(rel.fromLabel.toLowerCase());
      const toId = labelToId.get(rel.toLabel.toLowerCase());

      // Also check if the referenced nodes exist in the graph already
      const resolvedFrom = fromId ?? graphStore.findNodeByLabel(rel.fromLabel)?.id;
      const resolvedTo = toId ?? graphStore.findNodeByLabel(rel.toLabel)?.id;

      if (!resolvedFrom || !resolvedTo) continue;

      try {
        graphStore.createEdge({
          fromId: resolvedFrom,
          toId: resolvedTo,
          type: rel.type,
          sourceInstance: instanceId,
          weight: rel.confidence,
          evidence: rel.evidence,
        });
        edgesCreated++;
      } catch {
        // Edge might already exist
      }
    }

    // Create a memory_ref node and link to extracted entities
    if (nodesCreated > 0 || edgesCreated > 0) {
      try {
        const preview = memory.content.slice(0, 50).replace(/\n/g, " ").trim();
        const memoryNode = graphStore.createNode({
          type: "memory_ref",
          label: `${memory.granularity} memory (${memory.date}): ${preview}...`,
          description: memory.content.slice(0, 2000),
          properties: {
            granularity: memory.granularity,
            date: memory.date,
            chatIds: memory.chatIds,
          },
          sourceInstance: instanceId,
          confidence: 1.0,
          sourceMemoryId: memory.id,
        });

        memoryNodeId = memoryNode.id;

        // Embed the memory content for vector search (fire-and-forget)
        const embedder = getEmbedder();
        embedder.embed(memory.content).then((embedding) => {
          if (embedding) {
            graphStore.updateNodeEmbedding(memoryNode.id, embedding);
          }
        }).catch(() => {
          // Embedding failure is non-fatal — memory still exists, just not vector-searchable
        });

        // Create "mentions" edges from memory_ref to each entity
        for (const [, nodeId] of labelToId) {
          try {
            graphStore.createEdge({
              fromId: memoryNodeId,
              toId: nodeId,
              type: "mentions",
              weight: 1.0,
              sourceInstance: instanceId,
            });
          } catch {
            // Edge might already exist
          }
        }
      } catch (error) {
        console.error(
          `[Graph] Failed to create memory_ref node for ${memory.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return { nodesCreated, edgesCreated, memoryNodeId };
  });
}

/**
 * Memory Integration handles connecting memories to the graph.
 *
 * The actual extraction of entities from memory content is designed
 * to be done by the entity itself (via LLM reasoning) using the
 * graph tools. This class provides helper methods for:
 * - Looking up existing nodes by label
 * - Creating memory_ref nodes for new memories
 * - Linking memories to existing nodes
 */
export class MemoryIntegration {
  constructor(private store: GraphStore) {}

  /**
   * Create a memory_ref node for a new memory.
   * This creates a node that represents the memory itself in the graph.
   */
  createMemoryNode(
    memory: MemoryEntry,
    instanceId: string
  ): { nodeId: string } | null {
    try {
      // Create a memory_ref node
      const node = this.store.createNode({
        type: "memory_ref",
        label: this.getMemoryLabel(memory),
        description: memory.content.slice(0, 2000),
        properties: {
          granularity: memory.granularity,
          date: memory.date,
          chatIds: memory.chatIds,
        },
        sourceInstance: instanceId,
        confidence: 1.0, // Memories are factual records
        sourceMemoryId: memory.id,
      });

      // Embed the memory content for vector search (fire-and-forget)
      const embedder = getEmbedder();
      embedder.embed(memory.content).then((embedding) => {
        if (embedding) {
          this.store.updateNodeEmbedding(node.id, embedding);
        }
      }).catch(() => {
        // Embedding failure is non-fatal
      });

      return { nodeId: node.id };
    } catch (error) {
      console.error(
        `[MemoryIntegration] Failed to create memory node: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * Generate a human-readable label for a memory.
   */
  private getMemoryLabel(memory: MemoryEntry): string {
    const dateStr = memory.date;
    const preview = memory.content.slice(0, 50).replace(/\n/g, " ").trim();
    return `${memory.granularity} memory (${dateStr}): ${preview}...`;
  }

  /**
   * Find an existing node by label (case-insensitive).
   */
  findNodeByLabel(label: string, type?: string): { id: string; label: string } | null {
    const node = this.store.findNodeByLabel(label, type);
    return node ? { id: node.id, label: node.label } : null;
  }

  /**
   * Find or create a node by label.
   * If the node exists, returns it. Otherwise creates a new one.
   */
  findOrCreateNode(
    input: {
      type: string;
      label: string;
      description?: string;
      properties?: Record<string, unknown>;
      confidence?: number;
    },
    instanceId: string
  ): { id: string; label: string; isNew: boolean } {
    // Try to find existing node
    const existing = this.findNodeByLabel(input.label, input.type);
    if (existing) {
      return { ...existing, isNew: false };
    }

    // Create new node
    const node = this.store.createNode({
      ...input,
      sourceInstance: instanceId,
    });

    return { id: node.id, label: node.label, isNew: true };
  }

  /**
   * Create an edge between two nodes, looking them up by label.
   * If either node doesn't exist, it will NOT be created automatically.
   */
  createEdgeByLabels(
    input: {
      fromLabel: string;
      toLabel: string;
      type: string;
      customType?: string;
      properties?: Record<string, unknown>;
      weight?: number;
      evidence?: string;
    },
    instanceId: string
  ): { edgeId: string } | null {
    const fromNode = this.findNodeByLabel(input.fromLabel);
    const toNode = this.findNodeByLabel(input.toLabel);

    if (!fromNode || !toNode) {
      return null;
    }

    try {
      const edge = this.store.createEdge({
        fromId: fromNode.id,
        toId: toNode.id,
        type: input.type,
        properties: input.properties,
        weight: input.weight,
        evidence: input.evidence,
        sourceInstance: instanceId,
      });

      return { edgeId: edge.id };
    } catch {
      return null;
    }
  }

  /**
   * Link a memory to multiple nodes.
   * Creates "mentions" edges from the memory_ref node to each specified node.
   */
  linkMemoryToEntities(
    memoryNodeId: string,
    entityNodeIds: string[],
    instanceId: string
  ): number {
    let linkedCount = 0;

    for (const entityId of entityNodeIds) {
      try {
        this.store.createEdge({
          fromId: memoryNodeId,
          toId: entityId,
          type: "mentions",
          weight: 1.0,
          sourceInstance: instanceId,
        });
        linkedCount++;
      } catch {
        // Edge might already exist or node might not exist
      }
    }

    return linkedCount;
  }

  /**
   * Get all entities mentioned in a memory.
   */
  getMemoryEntities(memoryId: string): Array<{ id: string; type: string; label: string }> {
    const nodes = this.store.getNodesForMemory(memoryId);
    return nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
    }));
  }

  /**
   * Get all memories that mention a specific entity.
   */
  getEntityMemories(nodeId: string): string[] {
    return this.store.getMemoriesForNode(nodeId);
  }

}

/**
 * Create a memory integration instance.
 */
export function createMemoryIntegration(store: GraphStore): MemoryIntegration {
  return new MemoryIntegration(store);
}

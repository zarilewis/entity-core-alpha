/**
 * Memory Integration
 *
 * Auto-extracts entities and relationships from memory content
 * and links them to my knowledge graph.
 *
 * Note: The actual entity extraction is designed to be done by the LLM
 * (the entity itself) using the graph tools. This module provides
 * helper utilities for the integration.
 */

import type { GraphStore } from "./store.ts";
import type { MemoryEntry } from "../types.ts";

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
        description: memory.content.slice(0, 500),
        properties: {
          granularity: memory.granularity,
          date: memory.date,
          chatIds: memory.chatIds,
        },
        sourceInstance: instanceId,
        confidence: 1.0, // Memories are factual records
        sourceMemoryId: memory.id,
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
        customType: input.customType,
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

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
 * Result of extracting entities from a memory.
 */
export interface ExtractionResult {
  /** Nodes that were identified */
  nodes: Array<{
    type: string;
    label: string;
    description?: string;
    properties?: Record<string, unknown>;
    confidence?: number;
  }>;
  /** Edges that were identified */
  edges: Array<{
    fromLabel: string;
    toLabel: string;
    type: string;
    customType?: string;
    properties?: Record<string, unknown>;
    weight?: number;
    evidence?: string;
  }>;
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
  async createMemoryNode(
    memory: MemoryEntry,
    instanceId: string
  ): Promise<{ nodeId: string } | null> {
    try {
      // Create a memory_ref node
      const node = await this.store.createNode({
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
    // Use text search to find matching nodes
    const results = this.store.listNodes({ type, limit: 100 });

    const normalizedLabel = label.toLowerCase().trim();
    const match = results.find(
      (n) => n.label.toLowerCase().trim() === normalizedLabel
    );

    return match ? { id: match.id, label: match.label } : null;
  }

  /**
   * Find or create a node by label.
   * If the node exists, returns it. Otherwise creates a new one.
   */
  async findOrCreateNode(
    input: {
      type: string;
      label: string;
      description?: string;
      properties?: Record<string, unknown>;
      confidence?: number;
    },
    instanceId: string
  ): Promise<{ id: string; label: string; isNew: boolean }> {
    // Try to find existing node
    const existing = this.findNodeByLabel(input.label, input.type);
    if (existing) {
      return { ...existing, isNew: false };
    }

    // Create new node
    const node = await this.store.createNode({
      ...input,
      sourceInstance: instanceId,
    });

    return { id: node.id, label: node.label, isNew: true };
  }

  /**
   * Create an edge between two nodes, looking them up by label.
   * If either node doesn't exist, it will NOT be created automatically.
   */
  async createEdgeByLabels(
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
  ): Promise<{ edgeId: string } | null> {
    const fromNode = this.findNodeByLabel(input.fromLabel);
    const toNode = this.findNodeByLabel(input.toLabel);

    if (!fromNode || !toNode) {
      return null;
    }

    try {
      const edge = await this.store.createEdge({
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
  async linkMemoryToEntities(
    memoryNodeId: string,
    entityNodeIds: string[],
    instanceId: string
  ): Promise<number> {
    let linkedCount = 0;

    for (const entityId of entityNodeIds) {
      try {
        await this.store.createEdge({
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

  /**
   * Process a batch of extractions from a memory.
   * This is a convenience method that handles the common pattern of:
   * 1. Creating/finding nodes
   * 2. Creating edges between them
   * 3. Linking to the memory
   */
  async processExtractions(
    memory: MemoryEntry,
    extraction: ExtractionResult,
    instanceId: string
  ): Promise<{
    memoryNodeId: string | null;
    nodesCreated: number;
    edgesCreated: number;
    nodesFound: number;
  }> {
    const result = {
      memoryNodeId: null as string | null,
      nodesCreated: 0,
      edgesCreated: 0,
      nodesFound: 0,
    };

    // Create memory_ref node
    const memoryNode = await this.createMemoryNode(memory, instanceId);
    if (memoryNode) {
      result.memoryNodeId = memoryNode.nodeId;

      // Track created nodes
      const nodeMap = new Map<string, string>();

      // Process nodes
      for (const nodeInput of extraction.nodes) {
        const node = await this.findOrCreateNode(
          {
            type: nodeInput.type,
            label: nodeInput.label,
            description: nodeInput.description,
            properties: nodeInput.properties,
            confidence: nodeInput.confidence,
          },
          instanceId
        );

        nodeMap.set(node.label.toLowerCase(), node.id);
        if (node.isNew) {
          result.nodesCreated++;
        } else {
          result.nodesFound++;
        }

        // Link memory to this node
        if (memoryNode.nodeId) {
          this.store.linkMemoryToNodes(memory.id, [node.id]);
        }
      }

      // Process edges
      for (const edgeInput of extraction.edges) {
        const fromId = nodeMap.get(edgeInput.fromLabel.toLowerCase());
        const toId = nodeMap.get(edgeInput.toLabel.toLowerCase());

        if (fromId && toId) {
          try {
            await this.store.createEdge({
              fromId,
              toId,
              type: edgeInput.type,
              customType: edgeInput.customType,
              properties: edgeInput.properties,
              weight: edgeInput.weight,
              evidence: edgeInput.evidence,
              sourceInstance: instanceId,
            });
            result.edgesCreated++;
          } catch {
            // Edge might already exist
          }
        }
      }
    }

    return result;
  }
}

/**
 * Create a memory integration instance.
 */
export function createMemoryIntegration(store: GraphStore): MemoryIntegration {
  return new MemoryIntegration(store);
}

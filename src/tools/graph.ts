/**
 * Graph Tools
 *
 * MCP tools for managing my knowledge graph.
 * All tools operate from my first-person perspective.
 */

import { z } from "zod";
import type { GraphStore } from "../graph/store.ts";
import type { Perspective } from "../graph/types.ts";

// ========================================
// SCHEMAS
// ========================================

const PerspectiveSchema = z.enum(["user", "entity", "shared"]);

// Node schemas
export const GraphNodeCreateSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  perspective: PerspectiveSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  instanceId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  sourceMemoryId: z.string().optional(),
  firstLearnedAt: z.string().optional(),
  embedding: z.array(z.number()).optional(),
});

export const GraphNodeGetSchema = z.object({
  id: z.string().min(1),
});

export const GraphNodeUpdateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  perspective: PerspectiveSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  lastConfirmedAt: z.string().optional(),
  instanceId: z.string().min(1),
  embedding: z.array(z.number()).optional(),
});

export const GraphNodeDeleteSchema = z.object({
  id: z.string().min(1),
  permanent: z.boolean().optional(),
});

export const GraphNodeSearchSchema = z.object({
  query: z.string().min(1).optional(),
  queryEmbedding: z.array(z.number()).optional(),
  type: z.string().optional(),
  perspective: PerspectiveSchema.optional(),
  minScore: z.number().min(0).max(1).optional(),
  limit: z.number().min(1).max(100).optional(),
});

export const GraphNodeListSchema = z.object({
  type: z.string().optional(),
  perspective: PerspectiveSchema.optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().min(1).max(500).optional(),
  offset: z.number().min(0).optional(),
});

// Edge schemas
export const GraphEdgeCreateSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  type: z.string().min(1),
  customType: z.string().optional(),
  perspective: PerspectiveSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  weight: z.number().min(0).max(1).optional(),
  evidence: z.string().optional(),
  occurredAt: z.string().optional(),
  validUntil: z.string().optional(),
  instanceId: z.string().min(1),
});

export const GraphEdgeGetSchema = z.object({
  id: z.string().min(1).optional(),
  fromId: z.string().min(1).optional(),
  toId: z.string().min(1).optional(),
  type: z.string().optional(),
  perspective: PerspectiveSchema.optional(),
  includeDeleted: z.boolean().optional(),
  onlyValid: z.boolean().optional(),
});

export const GraphEdgeUpdateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1).optional(),
  customType: z.string().optional(),
  perspective: PerspectiveSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  weight: z.number().min(0).max(1).optional(),
  evidence: z.string().optional(),
  validUntil: z.string().optional(),
  lastConfirmedAt: z.string().optional(),
  instanceId: z.string().min(1),
});

export const GraphEdgeDeleteSchema = z.object({
  id: z.string().min(1),
});

// Traversal schemas
export const GraphTraverseSchema = z.object({
  startNodeId: z.string().min(1),
  direction: z.enum(["out", "in", "both"]).optional(),
  maxDepth: z.number().min(1).max(5).optional(),
  edgeTypes: z.array(z.string()).optional(),
  limit: z.number().min(1).max(200).optional(),
});

export const GraphSubgraphSchema = z.object({
  nodeId: z.string().min(1),
  depth: z.number().min(1).max(3).optional(),
});

// Memory linking schemas
export const GraphConnectMemorySchema = z.object({
  memoryId: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(1),
});

export const GraphGetMemoryNodesSchema = z.object({
  memoryId: z.string().min(1),
});

// Insights schemas
export const GraphInsightsSchema = z.object({});

export const GraphStatsSchema = z.object({});

// ========================================
// OUTPUT TYPES
// ========================================

export interface GraphNodeCreateOutput {
  success: boolean;
  message: string;
  node?: {
    id: string;
    type: string;
    label: string;
    description: string;
    perspective: Perspective;
    properties: Record<string, unknown>;
    confidence: number;
    createdAt: string;
  };
}

export interface GraphNodeGetOutput {
  success: boolean;
  node?: {
    id: string;
    type: string;
    label: string;
    description: string;
    perspective: Perspective;
    properties: Record<string, unknown>;
    sourceInstance: string;
    confidence: number;
    sourceMemoryId?: string;
    createdAt: string;
    updatedAt: string;
    firstLearnedAt?: string;
    lastConfirmedAt?: string;
    version: number;
  };
}

export interface GraphNodeUpdateOutput {
  success: boolean;
  message: string;
  node?: {
    id: string;
    type: string;
    label: string;
    description: string;
    perspective: Perspective;
    properties: Record<string, unknown>;
    confidence: number;
    updatedAt: string;
    version: number;
  };
}

export interface GraphNodeDeleteOutput {
  success: boolean;
  message: string;
}

export interface GraphNodeSearchOutput {
  results: Array<{
    node: {
      id: string;
      type: string;
      label: string;
      description: string;
      perspective: Perspective;
      confidence: number;
    };
    score: number;
  }>;
  vectorSearchUsed: boolean;
}

export interface GraphNodeListOutput {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    description: string;
    perspective: Perspective;
    confidence: number;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}

export interface GraphEdgeCreateOutput {
  success: boolean;
  message: string;
  edge?: {
    id: string;
    fromId: string;
    toId: string;
    type: string;
    customType?: string;
    perspective: Perspective;
    weight: number;
    createdAt: string;
  };
}

export interface GraphEdgeGetOutput {
  edges: Array<{
    id: string;
    fromId: string;
    toId: string;
    type: string;
    customType?: string;
    perspective: Perspective;
    weight: number;
    evidence?: string;
    occurredAt?: string;
    validUntil?: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface GraphEdgeUpdateOutput {
  success: boolean;
  message: string;
  edge?: {
    id: string;
    fromId: string;
    toId: string;
    type: string;
    customType?: string;
    perspective: Perspective;
    weight: number;
    updatedAt: string;
    version: number;
  };
}

export interface GraphEdgeDeleteOutput {
  success: boolean;
  message: string;
}

export interface GraphTraverseOutput {
  startNode: {
    id: string;
    type: string;
    label: string;
  };
  results: Array<{
    node: {
      id: string;
      type: string;
      label: string;
      description: string;
      perspective: Perspective;
    };
    path: string[];
    depth: number;
  }>;
}

export interface GraphSubgraphOutput {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    description: string;
    perspective: Perspective;
    confidence: number;
  }>;
  edges: Array<{
    id: string;
    fromId: string;
    toId: string;
    type: string;
    customType?: string;
    perspective: Perspective;
    weight: number;
  }>;
}

export interface GraphConnectMemoryOutput {
  success: boolean;
  message: string;
  linkedCount: number;
}

export interface GraphGetMemoryNodesOutput {
  memoryId: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    description: string;
    perspective: Perspective;
  }>;
}

export interface GraphInsightsOutput {
  insights: Array<{
    type: string;
    description: string;
    nodeIds: string[];
    edgeIds: string[];
    confidence: number;
  }>;
}

export interface GraphStatsOutput {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  nodesByPerspective: Record<Perspective, number>;
  oldestNode?: string;
  newestNode?: string;
  vectorSearchAvailable: boolean;
}

// ========================================
// HANDLERS
// ========================================

/**
 * Create the graph_node_create tool handler.
 */
export function createGraphNodeCreateHandler(store: GraphStore) {
  return async (input: z.infer<typeof GraphNodeCreateSchema>): Promise<GraphNodeCreateOutput> => {
    try {
      const node = await store.createNode({
        type: input.type,
        label: input.label,
        description: input.description,
        perspective: input.perspective,
        properties: input.properties,
        sourceInstance: input.instanceId,
        confidence: input.confidence,
        sourceMemoryId: input.sourceMemoryId,
        firstLearnedAt: input.firstLearnedAt,
      });

      // Store embedding if provided
      if (input.embedding) {
        await store.updateNodeEmbedding(node.id, input.embedding);
      }

      return {
        success: true,
        message: `I have created a new ${node.type} node: "${node.label}"`,
        node: {
          id: node.id,
          type: node.type,
          label: node.label,
          description: node.description,
          perspective: node.perspective,
          properties: node.properties,
          confidence: node.confidence,
          createdAt: node.createdAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create node: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

/**
 * Create the graph_node_get tool handler.
 */
export function createGraphNodeGetHandler(
  store: GraphStore
): (input: z.infer<typeof GraphNodeGetSchema>) => Promise<GraphNodeGetOutput> {
  return (input: z.infer<typeof GraphNodeGetSchema>): Promise<GraphNodeGetOutput> => {
    const node = store.getNode(input.id);
    if (!node) {
      return Promise.resolve({ success: false });
    }
    return Promise.resolve({
      success: true,
      node: {
        id: node.id,
        type: node.type,
        label: node.label,
        description: node.description,
        perspective: node.perspective,
        properties: node.properties,
        sourceInstance: node.sourceInstance,
        confidence: node.confidence,
        sourceMemoryId: node.sourceMemoryId,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        firstLearnedAt: node.firstLearnedAt,
        lastConfirmedAt: node.lastConfirmedAt,
        version: node.version,
      },
    });
  };
}

/**
 * Create the graph_node_update tool handler.
 */
export function createGraphNodeUpdateHandler(store: GraphStore) {
  return async (input: z.infer<typeof GraphNodeUpdateSchema>): Promise<GraphNodeUpdateOutput> => {
    try {
      const node = await store.updateNode(input.id, {
        label: input.label,
        description: input.description,
        perspective: input.perspective,
        properties: input.properties,
        confidence: input.confidence,
        lastConfirmedAt: input.lastConfirmedAt,
        sourceInstance: input.instanceId,
      });

      if (!node) {
        return {
          success: false,
          message: `Node not found: ${input.id}`,
        };
      }

      // Update embedding if provided
      if (input.embedding) {
        await store.updateNodeEmbedding(node.id, input.embedding);
      }

      return {
        success: true,
        message: `I have updated the node "${node.label}"`,
        node: {
          id: node.id,
          type: node.type,
          label: node.label,
          description: node.description,
          perspective: node.perspective,
          properties: node.properties,
          confidence: node.confidence,
          updatedAt: node.updatedAt,
          version: node.version,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update node: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

/**
 * Create the graph_node_delete tool handler.
 */
export function createGraphNodeDeleteHandler(
  store: GraphStore
): (input: z.infer<typeof GraphNodeDeleteSchema>) => Promise<GraphNodeDeleteOutput> {
  return (input: z.infer<typeof GraphNodeDeleteSchema>): Promise<GraphNodeDeleteOutput> => {
    const node = store.getNode(input.id);
    if (!node) {
      return Promise.resolve({
        success: false,
        message: `Node not found: ${input.id}`,
      });
    }

    const deleted = input.permanent
      ? store.permanentlyDeleteNode(input.id)
      : store.deleteNode(input.id);

    return Promise.resolve({
      success: deleted,
      message: deleted
        ? `I have ${input.permanent ? "permanently " : ""}deleted the node "${node.label}"`
        : `Failed to delete node: ${input.id}`,
    });
  };
}

/**
 * Create the graph_node_search tool handler.
 */
export function createGraphNodeSearchHandler(store: GraphStore) {
  return async (input: z.infer<typeof GraphNodeSearchSchema>): Promise<GraphNodeSearchOutput> => {
    const results = await store.searchNodes({
      query: input.query,
      queryEmbedding: input.queryEmbedding,
      type: input.type,
      perspective: input.perspective,
      minScore: input.minScore,
      limit: input.limit,
    });

    return {
      results: results.map((r) => ({
        node: {
          id: r.node.id,
          type: r.node.type,
          label: r.node.label,
          description: r.node.description,
          perspective: r.node.perspective,
          confidence: r.node.confidence,
        },
        score: r.score,
      })),
      vectorSearchUsed: store.isVectorSearchAvailable() && !!input.queryEmbedding,
    };
  };
}

/**
 * Create the graph_node_list tool handler.
 */
export function createGraphNodeListHandler(
  store: GraphStore
): (input: z.infer<typeof GraphNodeListSchema>) => Promise<GraphNodeListOutput> {
  return (input: z.infer<typeof GraphNodeListSchema>): Promise<GraphNodeListOutput> => {
    const nodes = store.listNodes({
      type: input.type,
      perspective: input.perspective,
      includeDeleted: input.includeDeleted,
      limit: input.limit,
      offset: input.offset,
    });

    // Get total count
    const stats = store.getStats();
    const total = input.type
      ? (stats.nodesByType[input.type] ?? 0)
      : stats.totalNodes;

    return Promise.resolve({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description,
        perspective: n.perspective,
        confidence: n.confidence,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      total,
    });
  };
}

/**
 * Create the graph_edge_create tool handler.
 */
export function createGraphEdgeCreateHandler(
  store: GraphStore
): (input: z.infer<typeof GraphEdgeCreateSchema>) => Promise<GraphEdgeCreateOutput> {
  return async (input: z.infer<typeof GraphEdgeCreateSchema>): Promise<GraphEdgeCreateOutput> => {
    try {
      const edge = await store.createEdge({
        fromId: input.fromId,
        toId: input.toId,
        type: input.type,
        customType: input.customType,
        perspective: input.perspective,
        properties: input.properties,
        weight: input.weight,
        evidence: input.evidence,
        occurredAt: input.occurredAt,
        validUntil: input.validUntil,
        sourceInstance: input.instanceId,
      });

      const fromNode = store.getNode(input.fromId);
      const toNode = store.getNode(input.toId);

      return {
        success: true,
        message: `I have created a "${edge.type}" relationship from "${fromNode?.label ?? input.fromId}" to "${toNode?.label ?? input.toId}"`,
        edge: {
          id: edge.id,
          fromId: edge.fromId,
          toId: edge.toId,
          type: edge.type,
          customType: edge.customType,
          perspective: edge.perspective,
          weight: edge.weight,
          createdAt: edge.createdAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create edge: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

/**
 * Create the graph_edge_get tool handler.
 */
export function createGraphEdgeGetHandler(
  store: GraphStore
): (input: z.infer<typeof GraphEdgeGetSchema>) => Promise<GraphEdgeGetOutput> {
  return (input: z.infer<typeof GraphEdgeGetSchema>): Promise<GraphEdgeGetOutput> => {
    if (input.id) {
      const edge = store.getEdge(input.id);
      if (!edge) {
        return Promise.resolve({ edges: [] });
      }
      return Promise.resolve({
        edges: [{
          id: edge.id,
          fromId: edge.fromId,
          toId: edge.toId,
          type: edge.type,
          customType: edge.customType,
          perspective: edge.perspective,
          weight: edge.weight,
          evidence: edge.evidence,
          occurredAt: edge.occurredAt,
          validUntil: edge.validUntil,
          createdAt: edge.createdAt,
          updatedAt: edge.updatedAt,
        }],
      });
    }

    const edges = store.getEdges({
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      perspective: input.perspective,
      includeDeleted: input.includeDeleted,
      onlyValid: input.onlyValid,
    });

    return Promise.resolve({
      edges: edges.map((e) => ({
        id: e.id,
        fromId: e.fromId,
        toId: e.toId,
        type: e.type,
        customType: e.customType,
        perspective: e.perspective,
        weight: e.weight,
        evidence: e.evidence,
        occurredAt: e.occurredAt,
        validUntil: e.validUntil,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    });
  };
}

/**
 * Create the graph_edge_update tool handler.
 */
export function createGraphEdgeUpdateHandler(
  store: GraphStore
): (input: z.infer<typeof GraphEdgeUpdateSchema>) => Promise<GraphEdgeUpdateOutput> {
  return async (input: z.infer<typeof GraphEdgeUpdateSchema>): Promise<GraphEdgeUpdateOutput> => {
    try {
      const edge = await store.updateEdge(input.id, {
        type: input.type,
        customType: input.customType,
        perspective: input.perspective,
        properties: input.properties,
        weight: input.weight,
        evidence: input.evidence,
        validUntil: input.validUntil,
        lastConfirmedAt: input.lastConfirmedAt,
        sourceInstance: input.instanceId,
      });

      if (!edge) {
        return {
          success: false,
          message: `Edge not found: ${input.id}`,
        };
      }

      return {
        success: true,
        message: `I have updated the "${edge.type}" relationship`,
        edge: {
          id: edge.id,
          fromId: edge.fromId,
          toId: edge.toId,
          type: edge.type,
          customType: edge.customType,
          perspective: edge.perspective,
          weight: edge.weight,
          updatedAt: edge.updatedAt,
          version: edge.version,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update edge: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

/**
 * Create the graph_edge_delete tool handler.
 */
export function createGraphEdgeDeleteHandler(
  store: GraphStore
): (input: z.infer<typeof GraphEdgeDeleteSchema>) => Promise<GraphEdgeDeleteOutput> {
  return (input: z.infer<typeof GraphEdgeDeleteSchema>): Promise<GraphEdgeDeleteOutput> => {
    const edge = store.getEdge(input.id);
    if (!edge) {
      return Promise.resolve({
        success: false,
        message: `Edge not found: ${input.id}`,
      });
    }

    const deleted = store.deleteEdge(input.id);
    return Promise.resolve({
      success: deleted,
      message: deleted
        ? `I have deleted the "${edge.type}" relationship`
        : `Failed to delete edge: ${input.id}`,
    });
  };
}

/**
 * Create the graph_traverse tool handler.
 */
export function createGraphTraverseHandler(
  store: GraphStore
): (input: z.infer<typeof GraphTraverseSchema>) => Promise<GraphTraverseOutput> {
  return (input: z.infer<typeof GraphTraverseSchema>): Promise<GraphTraverseOutput> => {
    const startNode = store.getNode(input.startNodeId);
    if (!startNode) {
      return Promise.resolve({
        startNode: { id: input.startNodeId, type: "unknown", label: "Unknown" },
        results: [],
      });
    }

    const results = store.traverse({
      startNodeId: input.startNodeId,
      direction: input.direction,
      maxDepth: input.maxDepth,
      edgeTypes: input.edgeTypes,
      limit: input.limit,
    });

    return Promise.resolve({
      startNode: {
        id: startNode.id,
        type: startNode.type,
        label: startNode.label,
      },
      results: results.map((r) => ({
        node: {
          id: r.node.id,
          type: r.node.type,
          label: r.node.label,
          description: r.node.description,
          perspective: r.node.perspective,
        },
        path: r.path,
        depth: r.depth,
      })),
    });
  };
}

/**
 * Create the graph_subgraph tool handler.
 */
export function createGraphSubgraphHandler(
  store: GraphStore
): (input: z.infer<typeof GraphSubgraphSchema>) => Promise<GraphSubgraphOutput> {
  return (input: z.infer<typeof GraphSubgraphSchema>): Promise<GraphSubgraphOutput> => {
    const subgraph = store.getSubgraph(input.nodeId, input.depth);

    return Promise.resolve({
      nodes: subgraph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description,
        perspective: n.perspective,
        confidence: n.confidence,
      })),
      edges: subgraph.edges.map((e) => ({
        id: e.id,
        fromId: e.fromId,
        toId: e.toId,
        type: e.type,
        customType: e.customType,
        perspective: e.perspective,
        weight: e.weight,
      })),
    });
  };
}

/**
 * Create the graph_connect_memory tool handler.
 */
export function createGraphConnectMemoryHandler(
  store: GraphStore
): (input: z.infer<typeof GraphConnectMemorySchema>) => Promise<GraphConnectMemoryOutput> {
  return (input: z.infer<typeof GraphConnectMemorySchema>): Promise<GraphConnectMemoryOutput> => {
    store.linkMemoryToNodes(input.memoryId, input.nodeIds);
    return Promise.resolve({
      success: true,
      message: `I have linked memory ${input.memoryId} to ${input.nodeIds.length} node(s)`,
      linkedCount: input.nodeIds.length,
    });
  };
}

/**
 * Create the graph_get_memory_nodes tool handler.
 */
export function createGraphGetMemoryNodesHandler(
  store: GraphStore
): (input: z.infer<typeof GraphGetMemoryNodesSchema>) => Promise<GraphGetMemoryNodesOutput> {
  return (input: z.infer<typeof GraphGetMemoryNodesSchema>): Promise<GraphGetMemoryNodesOutput> => {
    const nodes = store.getNodesForMemory(input.memoryId);
    return Promise.resolve({
      memoryId: input.memoryId,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description,
        perspective: n.perspective,
      })),
    });
  };
}

/**
 * Create the graph_insights tool handler.
 */
export function createGraphInsightsHandler(
  store: GraphStore
): (_input: z.infer<typeof GraphInsightsSchema>) => Promise<GraphInsightsOutput> {
  return (_input: z.infer<typeof GraphInsightsSchema>): Promise<GraphInsightsOutput> => {
    const insights = store.discoverInsights();
    return Promise.resolve({
      insights: insights.map((i) => ({
        type: i.type,
        description: i.description,
        nodeIds: i.nodeIds,
        edgeIds: i.edgeIds,
        confidence: i.confidence,
      })),
    });
  };
}

/**
 * Create the graph_stats tool handler.
 */
export function createGraphStatsHandler(
  store: GraphStore
): (_input: z.infer<typeof GraphStatsSchema>) => Promise<GraphStatsOutput> {
  return (_input: z.infer<typeof GraphStatsSchema>): Promise<GraphStatsOutput> => {
    const stats = store.getStats();
    return Promise.resolve({
      ...stats,
      vectorSearchAvailable: store.isVectorSearchAvailable(),
    });
  };
}

// ========================================
// TOOL DEFINITIONS
// ========================================

export const graphTools = {
  "graph/node_create": {
    description:
      "Create a new node in my knowledge graph. I use this to remember people, emotions, events, preferences, and how things connect.",
    inputSchema: GraphNodeCreateSchema,
  },
  "graph/node_get": {
    description:
      "Get a specific node from my knowledge graph by its ID.",
    inputSchema: GraphNodeGetSchema,
  },
  "graph/node_update": {
    description:
      "Update a node in my knowledge graph. I use this to refine or add to what I know.",
    inputSchema: GraphNodeUpdateSchema,
  },
  "graph/node_delete": {
    description:
      "Delete a node from my knowledge graph. I use this when something is no longer relevant or was created in error.",
    inputSchema: GraphNodeDeleteSchema,
  },
  "graph/node_search": {
    description:
      "Search my knowledge graph for relevant nodes. Uses semantic search with pre-computed embeddings for best results.",
    inputSchema: GraphNodeSearchSchema,
  },
  "graph/node_list": {
    description:
      "List nodes in my knowledge graph, optionally filtered by type or perspective.",
    inputSchema: GraphNodeListSchema,
  },
  "graph/edge_create": {
    description:
      "Create a relationship between two nodes. I use this to connect things like 'user feels anxious about work' or 'meditation helps with stress'.",
    inputSchema: GraphEdgeCreateSchema,
  },
  "graph/edge_get": {
    description:
      "Get edges (relationships) from my knowledge graph. Can filter by ID, source/target nodes, or type.",
    inputSchema: GraphEdgeGetSchema,
  },
  "graph/edge_update": {
    description:
      "Update a relationship in my knowledge graph. I use this to change weights, add evidence, or mark relationships as ended.",
    inputSchema: GraphEdgeUpdateSchema,
  },
  "graph/edge_delete": {
    description:
      "Delete a relationship from my knowledge graph.",
    inputSchema: GraphEdgeDeleteSchema,
  },
  "graph/traverse": {
    description:
      "Traverse my knowledge graph starting from a node. I use this to find related concepts and understand connections.",
    inputSchema: GraphTraverseSchema,
  },
  "graph/subgraph": {
    description:
      "Extract a subgraph centered on a node. I use this to get the full context around a concept.",
    inputSchema: GraphSubgraphSchema,
  },
  "graph/connect_memory": {
    description:
      "Link a memory to nodes in my knowledge graph. I use this to track which memories mention which concepts.",
    inputSchema: GraphConnectMemorySchema,
  },
  "graph/get_memory_nodes": {
    description:
      "Get all nodes linked to a specific memory.",
    inputSchema: GraphGetMemoryNodesSchema,
  },
  "graph/insights": {
    description:
      "Discover patterns and insights in my knowledge graph. I use this to find bridges, clusters, and interesting connections.",
    inputSchema: GraphInsightsSchema,
  },
  "graph/stats": {
    description:
      "Get statistics about my knowledge graph - total nodes, edges, breakdowns by type and perspective.",
    inputSchema: GraphStatsSchema,
  },
};

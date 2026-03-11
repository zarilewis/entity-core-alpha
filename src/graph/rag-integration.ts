/**
 * RAG Integration
 *
 * Combines vector search with graph traversal for hybrid retrieval.
 * Provides rich context for LLM queries by including related concepts.
 */

import type { GraphStore } from "./store.ts";
import type { GraphNode, GraphEdge, Subgraph } from "./types.ts";

/**
 * Options for graph-enhanced retrieval.
 */
export interface GraphRAGOptions {
  /** Maximum nodes to retrieve via vector search */
  maxVectorResults?: number;
  /** Maximum depth for graph traversal */
  traversalDepth?: number;
  /** Maximum related nodes to include */
  maxRelatedNodes?: number;
  /** Minimum similarity score for vector search */
  minScore?: number;
  /** Include evidence for relationships */
  includeEvidence?: boolean;
}

/**
 * Result of graph-enhanced retrieval.
 */
export interface GraphRAGResult {
  /** Primary nodes found via vector search */
  primaryNodes: Array<{
    node: GraphNode;
    score: number;
  }>;
  /** Related nodes found via graph traversal */
  relatedNodes: Array<{
    node: GraphNode;
    relationship: string;
    viaNode: string;
  }>;
  /** Relationships between found nodes */
  relationships: Array<{
    edge: GraphEdge;
    fromLabel: string;
    toLabel: string;
  }>;
  /** Formatted context string for LLM */
  contextString: string;
}

/**
 * Graph RAG provides hybrid retrieval combining vector search with graph traversal.
 */
export class GraphRAG {
  constructor(private store: GraphStore) {}

  /**
   * Perform graph-enhanced retrieval.
   * First finds nodes via vector search, then expands via graph traversal.
   */
  async retrieve(
    queryEmbedding: number[],
    options: GraphRAGOptions = {}
  ): Promise<GraphRAGResult> {
    const {
      maxVectorResults = 5,
      traversalDepth = 2,
      maxRelatedNodes = 10,
      minScore = 0.3,
    } = options;

    // Step 1: Vector search for primary nodes
    const searchResults = await this.store.searchNodes({
      queryEmbedding,
      minScore,
      limit: maxVectorResults,
    });

    const primaryNodes = searchResults.map((r) => ({
      node: r.node,
      score: r.score,
    }));

    // Step 2: Expand via graph traversal
    const relatedNodes: GraphRAGResult["relatedNodes"] = [];
    const visitedIds = new Set(primaryNodes.map((p) => p.node.id));
    const relationshipEdges: GraphEdge[] = [];

    for (const primary of primaryNodes) {
      const subgraph = this.store.getSubgraph(primary.node.id, traversalDepth);

      // Collect relationships involving primary node
      for (const edge of subgraph.edges) {
        if (
          edge.fromId === primary.node.id ||
          edge.toId === primary.node.id
        ) {
          relationshipEdges.push(edge);
        }
      }

      // Collect related nodes
      for (const node of subgraph.nodes) {
        if (visitedIds.has(node.id)) continue;
        if (relatedNodes.length >= maxRelatedNodes) break;

        // Find the relationship connecting this node
        const connectingEdge = subgraph.edges.find(
          (e) =>
            (e.fromId === primary.node.id && e.toId === node.id) ||
            (e.toId === primary.node.id && e.fromId === node.id)
        );

        if (connectingEdge) {
          relatedNodes.push({
            node,
            relationship: connectingEdge.type,
            viaNode: primary.node.label,
          });
          visitedIds.add(node.id);
        }
      }
    }

    // Step 3: Build relationships array
    const relationships = relationshipEdges.map((edge) => {
      const fromNode = this.store.getNode(edge.fromId);
      const toNode = this.store.getNode(edge.toId);
      return {
        edge,
        fromLabel: fromNode?.label ?? edge.fromId,
        toLabel: toNode?.label ?? edge.toId,
      };
    });

    // Step 4: Build context string
    const contextString = this.buildContextString(
      primaryNodes,
      relatedNodes,
      relationships,
      options.includeEvidence ?? false
    );

    return {
      primaryNodes,
      relatedNodes,
      relationships,
      contextString,
    };
  }

  /**
   * Retrieve context for a specific node and its neighborhood.
   */
  retrieveNodeContext(
    nodeId: string,
    depth: number = 2
  ): { subgraph: Subgraph; contextString: string } {
    const subgraph = this.store.getSubgraph(nodeId, depth);
    const contextString = this.buildSubgraphContextString(subgraph);
    return { subgraph, contextString };
  }

  /**
   * Build a formatted context string for LLM consumption.
   */
  private buildContextString(
    primaryNodes: Array<{ node: GraphNode; score: number }>,
    relatedNodes: Array<{
      node: GraphNode;
      relationship: string;
      viaNode: string;
    }>,
    relationships: Array<{
      edge: GraphEdge;
      fromLabel: string;
      toLabel: string;
    }>,
    includeEvidence: boolean
  ): string {
    const sections: string[] = [];

    // Primary nodes section
    if (primaryNodes.length > 0) {
      sections.push("## Key Concepts (via semantic search)");
      for (const { node, score } of primaryNodes) {
        const confidence = `confidence: ${Math.round(node.confidence * 100)}%`;
        sections.push(
          `- **${node.label}** (${node.type})\n  ${node.description}\n  [${confidence}, relevance: ${Math.round(score * 100)}%]`
        );
      }
    }

    // Related nodes section
    if (relatedNodes.length > 0) {
      sections.push("\n## Related Concepts (via graph connections)");
      for (const { node, relationship, viaNode } of relatedNodes) {
        sections.push(
          `- **${node.label}** (${node.type}): ${relationship} from "${viaNode}"\n  ${node.description}`
        );
      }
    }

    // Relationships section
    if (relationships.length > 0) {
      sections.push("\n## Relationships");
      for (const { edge, fromLabel, toLabel } of relationships) {
        const relType = edge.customType ?? edge.type;
        const weight = `weight: ${Math.round(edge.weight * 100)}%`;
        const evidence = includeEvidence && edge.evidence
          ? `\n  Evidence: ${edge.evidence}`
          : "";
        sections.push(
          `- **${fromLabel}** → *${relType}* → **${toLabel}** [${weight}]${evidence}`
        );
      }
    }

    return sections.join("\n");
  }

  /**
   * Build a context string for a subgraph.
   */
  private buildSubgraphContextString(subgraph: Subgraph): string {
    const sections: string[] = [];

    // Nodes
    if (subgraph.nodes.length > 0) {
      sections.push("## Nodes");
      for (const node of subgraph.nodes) {
        sections.push(
          `- **${node.label}** (${node.type})\n  ${node.description}`
        );
      }
    }

    // Edges
    if (subgraph.edges.length > 0) {
      sections.push("\n## Relationships");
      for (const edge of subgraph.edges) {
        const fromNode = subgraph.nodes.find((n) => n.id === edge.fromId);
        const toNode = subgraph.nodes.find((n) => n.id === edge.toId);
        const relType = edge.customType ?? edge.type;
        sections.push(
          `- **${fromNode?.label ?? edge.fromId}** → *${relType}* → **${toNode?.label ?? edge.toId}**`
        );
      }
    }

    return sections.join("\n");
  }

  /**
   * Find paths between two nodes.
   * Returns all paths up to a maximum length.
   */
  findPaths(
    fromNodeId: string,
    toNodeId: string,
    maxDepth: number = 4
  ): Array<Array<{ node: GraphNode; edge?: GraphEdge }>> {
    const paths: Array<Array<{ node: GraphNode; edge?: GraphEdge }>> = [];
    const startNode = this.store.getNode(fromNodeId);
    const endNode = this.store.getNode(toNodeId);

    if (!startNode || !endNode) return paths;

    const visited = new Set<string>();
    const queue: Array<{
      nodeId: string;
      path: Array<{ node: GraphNode; edge?: GraphEdge }>;
    }> = [
      {
        nodeId: fromNodeId,
        path: [{ node: startNode }],
      },
    ];

    while (queue.length > 0 && paths.length < 10) {
      const current = queue.shift()!;
      const currentPath = current.path;

      if (current.nodeId === toNodeId && currentPath.length > 1) {
        paths.push(currentPath);
        continue;
      }

      if (currentPath.length > maxDepth) continue;

      visited.add(current.nodeId);

      // Get outgoing edges
      const outEdges = this.store.getEdges({
        fromId: current.nodeId,
        onlyValid: true,
      });
      // Get incoming edges
      const inEdges = this.store.getEdges({
        toId: current.nodeId,
        onlyValid: true,
      });

      for (const edge of [...outEdges, ...inEdges]) {
        const nextNodeId = edge.fromId === current.nodeId ? edge.toId : edge.fromId;
        if (visited.has(nextNodeId)) continue;

        const nextNode = this.store.getNode(nextNodeId);
        if (!nextNode) continue;

        queue.push({
          nodeId: nextNodeId,
          path: [...currentPath, { node: nextNode, edge }],
        });
      }
    }

    return paths;
  }

  /**
   * Get the "neighborhood" context for a query.
   * Returns nodes that are semantically similar and their immediate neighbors.
   */
  async getNeighborhood(
    queryEmbedding: number[],
    options: GraphRAGOptions = {}
  ): Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    contextString: string;
  }> {
    const result = await this.retrieve(queryEmbedding, {
      ...options,
      traversalDepth: 1,
    });

    const nodeIds = new Set<string>();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Collect all nodes
    for (const { node } of result.primaryNodes) {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        nodes.push(node);
      }
    }
    for (const { node } of result.relatedNodes) {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        nodes.push(node);
      }
    }

    // Collect edges between these nodes
    for (const nodeId of nodeIds) {
      const outEdges = this.store.getEdges({
        fromId: nodeId,
        onlyValid: true,
      });
      for (const edge of outEdges) {
        if (nodeIds.has(edge.toId)) {
          edges.push(edge);
        }
      }
    }

    return {
      nodes,
      edges,
      contextString: result.contextString,
    };
  }
}

/**
 * Create a Graph RAG instance.
 */
export function createGraphRAG(store: GraphStore): GraphRAG {
  return new GraphRAG(store);
}

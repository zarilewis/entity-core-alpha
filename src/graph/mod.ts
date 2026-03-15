/**
 * Graph Module
 *
 * My knowledge graph - the web of what I know about my person
 * and how everything connects.
 */

// Types
export {
  type GraphNode,
  type GraphEdge,
  type CreateNodeInput,
  type CreateEdgeInput,
  type UpdateNodeInput,
  type UpdateEdgeInput,
  type SearchNodesOptions,
  type ListNodesOptions,
  type GetEdgesOptions,
  type TraverseOptions,
  type TraverseResult,
  type NodeSearchResult,
  type Subgraph,
  type GraphInsight,
  type GraphStats,
  type SuggestedNodeType,
  type SuggestedEdgeType,
  EMBEDDING_DIMENSION,
} from "./types.ts";

// Store
export { GraphStore } from "./store.ts";

// Schema
export {
  initializeGraphSchema,
  isVectorSearchAvailable,
  getVecVersion,
  verifyVectorTableSync,
} from "./schema.ts";

// Memory Integration
export {
  MemoryIntegration,
  createMemoryIntegration,
} from "./memory-integration.ts";

// RAG Integration
export {
  GraphRAG,
  createGraphRAG,
  type GraphRAGOptions,
  type GraphRAGResult,
} from "./rag-integration.ts";

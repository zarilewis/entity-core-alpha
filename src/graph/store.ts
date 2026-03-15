/**
 * Graph Store
 *
 * Storage layer for my knowledge graph.
 * Provides CRUD operations, vector search, and graph traversal.
 */

import { Database } from "@db/sqlite";
import { join, dirname, fromFileUrl } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  initializeGraphSchema,
  verifyVectorTableSync,
} from "./schema.ts";
import type {
  GraphNode,
  GraphEdge,
  CreateNodeInput,
  CreateEdgeInput,
  UpdateNodeInput,
  UpdateEdgeInput,
  SearchNodesOptions,
  ListNodesOptions,
  GetEdgesOptions,
  TraverseOptions,
  TraverseResult,
  NodeSearchResult,
  Subgraph,
  GraphInsight,
  GraphStats,
} from "./types.ts";

/**
 * Generate a unique ID for a node or edge.
 */
function generateId(): string {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Serialize a vector (array of numbers) to Uint8Array for storage.
 */
function serializeVector(vec: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer);
}

/**
 * GraphStore provides access to the knowledge graph.
 */
export class GraphStore {
  private db: Database;
  private dbPath: string;
  private vectorAvailable: boolean;
  private initialized = false;

  constructor(dataDir: string) {
    this.dbPath = join(dataDir, "graph.db");
    // Open database (creates if not exists)
    this.db = new Database(this.dbPath);
    this.vectorAvailable = false;
  }

  /**
   * Initialize the graph store.
   * Must be called before any operations.
   * Automatically creates canonical "me" and "user" nodes if they don't exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure data directory exists
    await ensureDir(join(this.dbPath, ".."));

    // Load sqlite-vec extension for vector search
    this.loadVectorExtension();

    // Initialize schema
    this.vectorAvailable = initializeGraphSchema(this.db);

    if (this.vectorAvailable) {
      verifyVectorTableSync(this.db);
    }

    // Auto-create canonical nodes
    await this.ensureCanonicalNodes();

    this.initialized = true;
  }

  /**
   * Ensure the canonical "me" and "user" nodes exist.
   * These are the core identity nodes for first-person perspective.
   */
  private async ensureCanonicalNodes(): Promise<void> {
    // Check if "me" node exists
    const selfNodes = this.listNodes({ type: "self", limit: 1 });
    if (selfNodes.length === 0) {
      await this.createNode({
        type: "self",
        label: "me",
        description: "This node represents me - the AI entity",
        sourceInstance: "entity-core",
        confidence: 1.0,
        properties: {},
      });
    }

    // Check if "user" node exists (person with label "user")
    const existingNodes = this.listNodes({ type: "person", limit: 100 });
    const userNodeExists = existingNodes.some((n) => n.label.toLowerCase() === "user");
    if (!userNodeExists) {
      await this.createNode({
        type: "person",
        label: "user",
        description: "The person I interact with",
        sourceInstance: "entity-core",
        confidence: 1.0,
        properties: {},
      });
    }
  }

  /**
   * Load the sqlite-vec extension into the database connection.
   * Searches entity-core's own lib/ first, then sibling Psycheros/lib/ (Docker layout).
   */
  private loadVectorExtension(): void {
    const moduleDir = dirname(fromFileUrl(import.meta.url));
    const candidates = [
      join(moduleDir, "..", "..", "lib", "vec0"),           // entity-core/lib/vec0
      join(moduleDir, "..", "..", "..", "Psycheros", "lib", "vec0"), // ../Psycheros/lib/vec0
    ];

    try {
      this.db.enableLoadExtension = true;
      for (const extPath of candidates) {
        try {
          this.db.exec(`SELECT load_extension('${extPath}')`);
          this.db.enableLoadExtension = false;
          return;
        } catch {
          // Try next candidate
        }
      }
      this.db.enableLoadExtension = false;
    } catch {
      try { this.db.enableLoadExtension = false; } catch { /* ignore */ }
    }
  }

  /**
   * Get the canonical "me" (self) node.
   * Returns null if not found (should exist after initialization).
   */
  getSelfNode(): GraphNode | null {
    const nodes = this.listNodes({ type: "self", limit: 1 });
    return nodes.length > 0 ? nodes[0] : null;
  }

  /**
   * Get the canonical "user" node.
   * Returns the person node with label "user" (or whatever name it was updated to).
   * Returns null if not found.
   */
  getUserNode(): GraphNode | null {
    const nodes = this.listNodes({ type: "person", limit: 100 });
    // Find the node that was originally created as "user"
    // It might have been renamed to the user's actual name
    for (const node of nodes) {
      if (node.label.toLowerCase() === "user" || node.sourceInstance === "entity-core") {
        return node;
      }
    }
    return nodes.length > 0 ? nodes[0] : null;
  }

  /**
   * Check if vector search is available.
   */
  isVectorSearchAvailable(): boolean {
    return this.vectorAvailable;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // ========================================
  // NODE OPERATIONS
  // ========================================

  /**
   * Create a new node in the graph.
   */
  createNode(input: CreateNodeInput): GraphNode {
    const id = generateId();
    const now = new Date().toISOString();
    const firstLearnedAt = input.firstLearnedAt ?? now;

    const node: GraphNode = {
      id,
      type: input.type,
      label: input.label,
      description: input.description ?? "",
      properties: input.properties ?? {},
      sourceInstance: input.sourceInstance,
      confidence: input.confidence ?? 0.5,
      sourceMemoryId: input.sourceMemoryId,
      createdAt: now,
      updatedAt: now,
      firstLearnedAt,
      version: 1,
      deleted: false,
    };

    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (
        id, type, label, description, properties,
        source_instance, confidence, source_memory_id,
        created_at, updated_at, first_learned_at, version, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      node.id,
      node.type,
      node.label,
      node.description,
      JSON.stringify(node.properties),
      node.sourceInstance,
      node.confidence,
      node.sourceMemoryId ?? null,
      node.createdAt,
      node.updatedAt,
      node.firstLearnedAt ?? null,
      node.version,
      node.deleted ? 1 : 0
    );
    stmt.finalize();

    return node;
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): GraphNode | null {
    const stmt = this.db.prepare(`
      SELECT * FROM graph_nodes WHERE id = ?
    `);
    const row = stmt.get<
      {
        id: string;
        type: string;
        label: string;
        description: string;
        properties: string;
        source_instance: string;
        confidence: number;
        source_memory_id: string | null;
        created_at: string;
        updated_at: string;
        first_learned_at: string | null;
        last_confirmed_at: string | null;
        version: number;
        deleted: number;
      }
    >(id);
    stmt.finalize();

    if (!row) return null;
    return this.rowToNode(row);
  }

  /**
   * Update a node.
   */
  updateNode(id: string, input: UpdateNodeInput): GraphNode | null {
    const existing = this.getNode(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updated: GraphNode = {
      ...existing,
      label: input.label ?? existing.label,
      description: input.description ?? existing.description,
      properties: input.properties ?? existing.properties,
      confidence: input.confidence ?? existing.confidence,
      lastConfirmedAt: input.lastConfirmedAt ?? existing.lastConfirmedAt,
      updatedAt: now,
      version: existing.version + 1,
    };

    const stmt = this.db.prepare(`
      UPDATE graph_nodes SET
        label = ?, description = ?, properties = ?,
        confidence = ?, last_confirmed_at = ?, updated_at = ?, version = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.label,
      updated.description,
      JSON.stringify(updated.properties),
      updated.confidence,
      updated.lastConfirmedAt ?? null,
      updated.updatedAt,
      updated.version,
      id
    );
    stmt.finalize();

    return updated;
  }

  /**
   * Soft-delete a node and its connected edges.
   */
  deleteNode(id: string): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE graph_nodes SET deleted = 1, updated_at = ? WHERE id = ?
    `);
    const changes = stmt.run(now, id);
    stmt.finalize();

    if (changes > 0) {
      // Also soft-delete all connected edges
      this.db.exec(
        "UPDATE graph_edges SET deleted = 1, updated_at = ? WHERE (from_id = ? OR to_id = ?) AND deleted = 0",
        [now, id, id]
      );
    }

    return changes > 0;
  }

  /**
   * Permanently delete a node (hard delete).
   */
  permanentlyDeleteNode(id: string): boolean {
    // Remove from vector table first
    if (this.vectorAvailable) {
      try {
        this.db.exec(
          "DELETE FROM vec_graph_nodes WHERE rowid = (SELECT rowid FROM graph_nodes WHERE id = ?)",
          [id]
        );
      } catch {
        // Ignore if vector table doesn't have this node
      }
    }

    const stmt = this.db.prepare("DELETE FROM graph_nodes WHERE id = ?");
    const changes = stmt.run(id);
    stmt.finalize();
    return changes > 0;
  }

  /**
   * Search nodes using vector similarity.
   */
  searchNodes(options: SearchNodesOptions): NodeSearchResult[] {
    if (!this.vectorAvailable || (!options.query && !options.queryEmbedding)) {
      // Fall back to text search
      return this.searchNodesByText(options);
    }

    const queryEmbedding = options.queryEmbedding;
    if (!queryEmbedding) {
      return this.searchNodesByText(options);
    }

    const minScore = options.minScore ?? 0.3;
    const limit = options.limit ?? 10;

    // Build filter conditions
    const conditions: string[] = ["n.deleted = 0"];
    const params: (string | number | Uint8Array)[] = [];

    if (options.type) {
      conditions.push("n.type = ?");
      params.push(options.type);
    }

    // Vector search with join
    // sqlite-vec requires v.k = ? to specify KNN count — outer LIMIT alone is not pushed down
    const serialized = serializeVector(queryEmbedding);
    const sql = `
      SELECT n.*, v.distance
      FROM graph_nodes n
      JOIN vec_graph_nodes v ON n.rowid = v.rowid
      WHERE ${conditions.join(" AND ")}
        AND v.embedding MATCH ?
        AND v.k = ?
        AND v.distance <= ?
      ORDER BY v.distance ASC
      LIMIT ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all<
      {
        id: string;
        type: string;
        label: string;
        description: string;
        properties: string;
        source_instance: string;
        confidence: number;
        source_memory_id: string | null;
        created_at: string;
        updated_at: string;
        first_learned_at: string | null;
        last_confirmed_at: string | null;
        version: number;
        deleted: number;
        distance: number;
      }
    >(...params, serialized, limit, 2 * (1 - minScore), limit);
    stmt.finalize();

    return rows.map((row) => ({
      node: this.rowToNode(row),
      // Convert distance (0 = identical, 2 = opposite for cosine) to score (1 = identical, 0 = different)
      score: Math.max(0, 1 - row.distance / 2),
    }));
  }

  /**
   * Fall back text search when vector search is unavailable.
   */
  private searchNodesByText(options: SearchNodesOptions): NodeSearchResult[] {
    const conditions: string[] = ["deleted = 0"];
    const params: (string | number)[] = [];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    if (options.query) {
      conditions.push("(label LIKE ? OR description LIKE ?)");
      const searchTerm = `%${options.query}%`;
      params.push(searchTerm, searchTerm);
    }

    const limit = options.limit ?? 10;
    const sql = `
      SELECT * FROM graph_nodes
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all<
      {
        id: string;
        type: string;
        label: string;
        description: string;
        properties: string;
        source_instance: string;
        confidence: number;
        source_memory_id: string | null;
        created_at: string;
        updated_at: string;
        first_learned_at: string | null;
        last_confirmed_at: string | null;
        version: number;
        deleted: number;
      }
    >(...params, limit);
    stmt.finalize();

    // Simple scoring based on text match
    return rows.map((row) => ({
      node: this.rowToNode(row),
      score: options.query
        ? (row.label.toLowerCase().includes(options.query.toLowerCase()) ? 0.8 : 0.5)
        : 0.5,
    }));
  }

  /**
   * List nodes with optional filtering.
   */
  listNodes(options: ListNodesOptions = {}): GraphNode[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!options.includeDeleted) {
      conditions.push("deleted = 0");
    }

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const sql = `
      SELECT * FROM graph_nodes
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all<
      {
        id: string;
        type: string;
        label: string;
        description: string;
        properties: string;
        source_instance: string;
        confidence: number;
        source_memory_id: string | null;
        created_at: string;
        updated_at: string;
        first_learned_at: string | null;
        last_confirmed_at: string | null;
        version: number;
        deleted: number;
      }
    >(...params, limit, offset);
    stmt.finalize();

    return rows.map((row) => this.rowToNode(row));
  }

  /**
   * Get nodes by type.
   */
  getNodesByType(type: string): GraphNode[] {
    return this.listNodes({ type });
  }

  /**
   * Find a node by label (case-insensitive), optionally filtered by type.
   * Returns the first match or null.
   */
  findNodeByLabel(label: string, type?: string): GraphNode | null {
    const conditions: string[] = ["deleted = 0", "LOWER(label) = LOWER(?)"];
    const params: (string | number)[] = [label];

    if (type) {
      conditions.push("type = ?");
      params.push(type);
    }

    const sql = `SELECT * FROM graph_nodes WHERE ${conditions.join(" AND ")} LIMIT 1`;
    const stmt = this.db.prepare(sql);
    const row = stmt.get<{
      id: string;
      type: string;
      label: string;
      description: string;
      properties: string;
      source_instance: string;
      confidence: number;
      source_memory_id: string | null;
      created_at: string;
      updated_at: string;
      first_learned_at: string | null;
      last_confirmed_at: string | null;
      version: number;
      deleted: number;
    }>(...params);
    stmt.finalize();

    return row ? this.rowToNode(row) : null;
  }

  /**
   * Store an embedding for a node.
   */
  private storeNodeEmbedding(id: string, embedding: number[]): void {
    if (!this.vectorAvailable) return;

    // Get the rowid for this node
    const rowidStmt = this.db.prepare("SELECT rowid FROM graph_nodes WHERE id = ?");
    const row = rowidStmt.get<{ rowid: number }>(id);
    rowidStmt.finalize();

    if (!row) return;

    const serialized = serializeVector(embedding);

    // Delete existing embedding if any
    this.db.exec("DELETE FROM vec_graph_nodes WHERE rowid = ?", [row.rowid]);

    // Insert new embedding
    this.db.exec(
      "INSERT INTO vec_graph_nodes(rowid, embedding) VALUES (?, ?)",
      [row.rowid, serialized]
    );
  }

  /**
   * Update a node's embedding.
   */
  updateNodeEmbedding(id: string, embedding: number[]): void {
    this.storeNodeEmbedding(id, embedding);

    // Update the node's updatedAt
    const stmt = this.db.prepare("UPDATE graph_nodes SET updated_at = ? WHERE id = ?");
    stmt.run(new Date().toISOString(), id);
    stmt.finalize();
  }

  // ========================================
  // EDGE OPERATIONS
  // ========================================

  /**
   * Create a new edge in the graph.
   */
  createEdge(input: CreateEdgeInput): GraphEdge {
    // Verify both nodes exist
    const fromNode = this.getNode(input.fromId);
    const toNode = this.getNode(input.toId);
    if (!fromNode || !toNode) {
      throw new Error(`Cannot create edge: node(s) not found (${input.fromId} -> ${input.toId})`);
    }

    const id = generateId();
    const now = new Date().toISOString();

    const edge: GraphEdge = {
      id,
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      customType: input.customType,
      properties: input.properties ?? {},
      weight: input.weight ?? 0.5,
      evidence: input.evidence,
      createdAt: now,
      updatedAt: now,
      occurredAt: input.occurredAt,
      validUntil: input.validUntil,
      version: 1,
      deleted: false,
    };

    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (
        id, from_id, to_id, type, custom_type, properties,
        weight, evidence, created_at, updated_at, occurred_at, valid_until, version, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      edge.id,
      edge.fromId,
      edge.toId,
      edge.type,
      edge.customType ?? null,
      JSON.stringify(edge.properties),
      edge.weight,
      edge.evidence ?? null,
      edge.createdAt,
      edge.updatedAt,
      edge.occurredAt ?? null,
      edge.validUntil ?? null,
      edge.version,
      edge.deleted ? 1 : 0
    );
    stmt.finalize();

    return edge;
  }

  /**
   * Get an edge by ID.
   */
  getEdge(id: string): GraphEdge | null {
    const stmt = this.db.prepare("SELECT * FROM graph_edges WHERE id = ?");
    const row = stmt.get<
      {
        id: string;
        from_id: string;
        to_id: string;
        type: string;
        custom_type: string | null;
        properties: string;
        weight: number;
        evidence: string | null;
        created_at: string;
        updated_at: string;
        occurred_at: string | null;
        valid_until: string | null;
        last_confirmed_at: string | null;
        version: number;
        deleted: number;
      }
    >(id);
    stmt.finalize();

    if (!row) return null;
    return this.rowToEdge(row);
  }

  /**
   * Get edges matching the given options.
   */
  getEdges(options: GetEdgesOptions = {}): GraphEdge[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!options.includeDeleted) {
      conditions.push("deleted = 0");
    }

    if (options.fromId) {
      conditions.push("from_id = ?");
      params.push(options.fromId);
    }

    if (options.toId) {
      conditions.push("to_id = ?");
      params.push(options.toId);
    }

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    if (options.onlyValid) {
      conditions.push("(valid_until IS NULL OR valid_until > ?)");
      params.push(new Date().toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT * FROM graph_edges
      ${whereClause}
      ORDER BY updated_at DESC
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all<
      {
        id: string;
        from_id: string;
        to_id: string;
        type: string;
        custom_type: string | null;
        properties: string;
        weight: number;
        evidence: string | null;
        created_at: string;
        updated_at: string;
        occurred_at: string | null;
        valid_until: string | null;
        last_confirmed_at: string | null;
        version: number;
        deleted: number;
      }
    >(...params);
    stmt.finalize();

    return rows.map((row) => this.rowToEdge(row));
  }

  /**
   * Update an edge.
   */
  updateEdge(id: string, input: UpdateEdgeInput): GraphEdge | null {
    const existing = this.getEdge(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updated: GraphEdge = {
      ...existing,
      type: input.type ?? existing.type,
      customType: input.customType ?? existing.customType,
      properties: input.properties ?? existing.properties,
      weight: input.weight ?? existing.weight,
      evidence: input.evidence ?? existing.evidence,
      validUntil: input.validUntil ?? existing.validUntil,
      lastConfirmedAt: input.lastConfirmedAt ?? existing.lastConfirmedAt,
      updatedAt: now,
      version: existing.version + 1,
    };

    const stmt = this.db.prepare(`
      UPDATE graph_edges SET
        type = ?, custom_type = ?, properties = ?,
        weight = ?, evidence = ?, valid_until = ?, last_confirmed_at = ?, updated_at = ?, version = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.type,
      updated.customType ?? null,
      JSON.stringify(updated.properties),
      updated.weight,
      updated.evidence ?? null,
      updated.validUntil ?? null,
      updated.lastConfirmedAt ?? null,
      updated.updatedAt,
      updated.version,
      id
    );
    stmt.finalize();

    return updated;
  }

  /**
   * Soft-delete an edge.
   */
  deleteEdge(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE graph_edges SET deleted = 1, updated_at = ? WHERE id = ?
    `);
    const changes = stmt.run(new Date().toISOString(), id);
    stmt.finalize();
    return changes > 0;
  }

  // ========================================
  // GRAPH TRAVERSAL
  // ========================================

  /**
   * Traverse the graph starting from a node.
   */
  traverse(options: TraverseOptions): TraverseResult[] {
    const { startNodeId, direction = "out", maxDepth = 2, edgeTypes = [], limit = 50 } = options;

    const startNode = this.getNode(startNodeId);
    if (!startNode) return [];

    const visited = new Set<string>([startNodeId]);
    const results: TraverseResult[] = [];
    const queue: { nodeId: string; path: string[]; depth: number }[] = [
      { nodeId: startNodeId, path: [], depth: 0 },
    ];

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;

      if (current.depth > 0) {
        const node = this.getNode(current.nodeId);
        if (node) {
          results.push({
            node,
            path: current.path,
            depth: current.depth,
          });
        }
      }

      if (current.depth < maxDepth) {
        // Get connected edges
        let edges: GraphEdge[] = [];

        if (direction === "out" || direction === "both") {
          edges = edges.concat(this.getEdges({ fromId: current.nodeId, onlyValid: true }));
        }
        if (direction === "in" || direction === "both") {
          edges = edges.concat(this.getEdges({ toId: current.nodeId, onlyValid: true }));
        }

        // Filter by edge types if specified
        if (edgeTypes.length > 0) {
          edges = edges.filter((e) => edgeTypes.includes(e.type));
        }

        for (const edge of edges) {
          const nextNodeId = edge.fromId === current.nodeId ? edge.toId : edge.fromId;
          if (!visited.has(nextNodeId)) {
            visited.add(nextNodeId);
            queue.push({
              nodeId: nextNodeId,
              path: [...current.path, edge.id],
              depth: current.depth + 1,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Extract a subgraph containing related nodes.
   */
  getSubgraph(nodeId: string, depth: number = 2): Subgraph {
    const traverseResults = this.traverse({
      startNodeId: nodeId,
      direction: "both",
      maxDepth: depth,
      limit: 100,
    });

    const startNode = this.getNode(nodeId);
    const nodes: GraphNode[] = startNode ? [startNode] : [];
    const nodeIds = new Set<string>([nodeId]);
    const edgeIds = new Set<string>();

    for (const result of traverseResults) {
      if (!nodeIds.has(result.node.id)) {
        nodes.push(result.node);
        nodeIds.add(result.node.id);
      }
      for (const edgeId of result.path) {
        edgeIds.add(edgeId);
      }
    }

    const edges = Array.from(edgeIds)
      .map((id) => this.getEdge(id))
      .filter((e): e is GraphEdge => e !== null);

    return { nodes, edges };
  }

  // ========================================
  // MEMORY LINKING
  // ========================================

  /**
   * Link a memory to nodes.
   */
  linkMemoryToNodes(memoryId: string, nodeIds: string[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO memory_node_links (memory_id, node_id, created_at)
      VALUES (?, ?, ?)
    `);

    for (const nodeId of nodeIds) {
      stmt.run(memoryId, nodeId, now);
    }
    stmt.finalize();
  }

  /**
   * Get nodes linked to a memory.
   */
  getNodesForMemory(memoryId: string): GraphNode[] {
    const stmt = this.db.prepare(`
      SELECT n.* FROM graph_nodes n
      JOIN memory_node_links m ON n.id = m.node_id
      WHERE m.memory_id = ? AND n.deleted = 0
    `);
    const rows = stmt.all<
      {
        id: string;
        type: string;
        label: string;
        description: string;
        properties: string;
        source_instance: string;
        confidence: number;
        source_memory_id: string | null;
        created_at: string;
        updated_at: string;
        first_learned_at: string | null;
        last_confirmed_at: string | null;
        version: number;
        deleted: number;
      }
    >(memoryId);
    stmt.finalize();

    return rows.map((row) => this.rowToNode(row));
  }

  /**
   * Get memories linked to a node.
   */
  getMemoriesForNode(nodeId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT memory_id FROM memory_node_links WHERE node_id = ?
    `);
    const rows = stmt.all<{ memory_id: string }>(nodeId);
    stmt.finalize();

    return rows.map((row) => row.memory_id);
  }

  // ========================================
  // INSIGHTS
  // ========================================

  /**
   * Discover patterns and insights in the graph.
   */
  discoverInsights(): GraphInsight[] {
    const insights: GraphInsight[] = [];

    // Find highly connected nodes (bridges)
    const bridgeStmt = this.db.prepare(`
      SELECT n.id, n.label, n.type,
        (SELECT COUNT(*) FROM graph_edges WHERE from_id = n.id AND deleted = 0) +
        (SELECT COUNT(*) FROM graph_edges WHERE to_id = n.id AND deleted = 0) as connection_count
      FROM graph_nodes n
      WHERE n.deleted = 0
      ORDER BY connection_count DESC
      LIMIT 5
    `);
    const bridges = bridgeStmt.all<{
      id: string;
      label: string;
      type: string;
      connection_count: number;
    }>();
    bridgeStmt.finalize();

    for (const bridge of bridges) {
      if (bridge.connection_count >= 3) {
        insights.push({
          type: "bridge",
          description: `"${bridge.label}" is a central concept with ${bridge.connection_count} connections`,
          nodeIds: [bridge.id],
          edgeIds: [],
          confidence: Math.min(bridge.connection_count / 10, 0.9),
        });
      }
    }

    // Find clusters of similar types
    const clusterStmt = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM graph_nodes
      WHERE deleted = 0
      GROUP BY type
      HAVING count >= 3
      ORDER BY count DESC
    `);
    const clusters = clusterStmt.all<{ type: string; count: number }>();
    clusterStmt.finalize();

    for (const cluster of clusters) {
      const nodeStmt = this.db.prepare(
        "SELECT id FROM graph_nodes WHERE type = ? AND deleted = 0 LIMIT 10"
      );
      const nodes = nodeStmt.all<{ id: string }>(cluster.type);
      nodeStmt.finalize();

      insights.push({
        type: "cluster",
        description: `I know about ${cluster.count} ${cluster.type}s`,
        nodeIds: nodes.map((n) => n.id),
        edgeIds: [],
        confidence: 0.7,
      });
    }

    return insights;
  }

  // ========================================
  // STATISTICS
  // ========================================

  /**
   * Get statistics about the knowledge graph.
   */
  getStats(): GraphStats {
    const totalNodes = this.db
      .prepare("SELECT COUNT(*) as count FROM graph_nodes WHERE deleted = 0")
      .get<{ count: number }>()?.count ?? 0;

    const totalEdges = this.db
      .prepare("SELECT COUNT(*) as count FROM graph_edges WHERE deleted = 0")
      .get<{ count: number }>()?.count ?? 0;

    const nodesByType: Record<string, number> = {};
    const typeRows = this.db
      .prepare(
        "SELECT type, COUNT(*) as count FROM graph_nodes WHERE deleted = 0 GROUP BY type"
      )
      .all<{ type: string; count: number }>();
    for (const row of typeRows) {
      nodesByType[row.type] = row.count;
    }

    const edgesByType: Record<string, number> = {};
    const edgeTypeRows = this.db
      .prepare(
        "SELECT type, COUNT(*) as count FROM graph_edges WHERE deleted = 0 GROUP BY type"
      )
      .all<{ type: string; count: number }>();
    for (const row of edgeTypeRows) {
      edgesByType[row.type] = row.count;
    }

    const oldestNode = this.db
      .prepare(
        "SELECT MIN(created_at) as oldest FROM graph_nodes WHERE deleted = 0"
      )
      .get<{ oldest: string | null }>()?.oldest ?? undefined;

    const newestNode = this.db
      .prepare(
        "SELECT MAX(created_at) as newest FROM graph_nodes WHERE deleted = 0"
      )
      .get<{ newest: string | null }>()?.newest ?? undefined;

    return {
      totalNodes,
      totalEdges,
      nodesByType,
      edgesByType,
      oldestNode,
      newestNode,
    };
  }

  // ========================================
  // ROW CONVERSION HELPERS
  // ========================================

  /**
   * Convert a database row to a GraphNode.
   */
  private rowToNode(
    row: {
      id: string;
      type: string;
      label: string;
      description: string;
      properties: string;
      source_instance: string;
      confidence: number;
      source_memory_id: string | null;
      created_at: string;
      updated_at: string;
      first_learned_at: string | null;
      last_confirmed_at: string | null;
      version: number;
      deleted: number;
    }
  ): GraphNode {
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      description: row.description,
      properties: this.parseJson(row.properties, {}),
      sourceInstance: row.source_instance,
      confidence: row.confidence,
      sourceMemoryId: row.source_memory_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      firstLearnedAt: row.first_learned_at ?? undefined,
      lastConfirmedAt: row.last_confirmed_at ?? undefined,
      version: row.version,
      deleted: row.deleted === 1,
    };
  }

  /**
   * Convert a database row to a GraphEdge.
   */
  private rowToEdge(
    row: {
      id: string;
      from_id: string;
      to_id: string;
      type: string;
      custom_type: string | null;
      properties: string;
      weight: number;
      evidence: string | null;
      created_at: string;
      updated_at: string;
      occurred_at: string | null;
      valid_until: string | null;
      last_confirmed_at: string | null;
      version: number;
      deleted: number;
    }
  ): GraphEdge {
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type,
      customType: row.custom_type ?? undefined,
      properties: this.parseJson(row.properties, {}),
      weight: row.weight,
      evidence: row.evidence ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      occurredAt: row.occurred_at ?? undefined,
      validUntil: row.valid_until ?? undefined,
      lastConfirmedAt: row.last_confirmed_at ?? undefined,
      version: row.version,
      deleted: row.deleted === 1,
    };
  }

  /**
   * Safely parse JSON with a default value.
   */
  private parseJson<T>(json: string, defaultValue: T): T {
    try {
      return JSON.parse(json) as T;
    } catch {
      return defaultValue;
    }
  }
}

/**
 * Graph Schema
 *
 * SQLite table definitions for my knowledge graph.
 * Uses sqlite-vec for semantic search on nodes.
 */

import type { Database } from "@db/sqlite";
import { EMBEDDING_DIMENSION } from "./types.ts";

/**
 * SQL schema for the knowledge graph.
 * Creates tables for nodes and edges with proper indexes.
 */
export const GRAPH_SCHEMA = `
  -- Nodes table: stores entities, concepts, and things I know about
  CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}',
    source_instance TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_memory_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    first_learned_at TEXT,
    last_confirmed_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_graph_nodes_type
    ON graph_nodes(type) WHERE deleted = 0;

  CREATE INDEX IF NOT EXISTS idx_graph_nodes_source_memory
    ON graph_nodes(source_memory_id) WHERE deleted = 0;

  CREATE INDEX IF NOT EXISTS idx_graph_nodes_deleted
    ON graph_nodes(deleted);

  -- Edges table: stores relationships between nodes
  CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,
    custom_type TEXT,
    properties TEXT NOT NULL DEFAULT '{}',
    weight REAL NOT NULL DEFAULT 0.5,
    evidence TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    occurred_at TEXT,
    valid_until TEXT,
    last_confirmed_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (from_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
  );

  -- Indexes for edge queries
  CREATE INDEX IF NOT EXISTS idx_graph_edges_from
    ON graph_edges(from_id) WHERE deleted = 0;

  CREATE INDEX IF NOT EXISTS idx_graph_edges_to
    ON graph_edges(to_id) WHERE deleted = 0;

  CREATE INDEX IF NOT EXISTS idx_graph_edges_type
    ON graph_edges(type) WHERE deleted = 0;

  CREATE INDEX IF NOT EXISTS idx_graph_edges_valid
    ON graph_edges(valid_until) WHERE deleted = 0;

  CREATE INDEX IF NOT EXISTS idx_graph_edges_deleted
    ON graph_edges(deleted);

  -- Memory-Node links: tracks which memories mention which nodes
  CREATE TABLE IF NOT EXISTS memory_node_links (
    memory_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (memory_id, node_id),
    FOREIGN KEY (node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_memory_node_links_memory
    ON memory_node_links(memory_id);

  CREATE INDEX IF NOT EXISTS idx_memory_node_links_node
    ON memory_node_links(node_id);
`;

/**
 * SQL to create the vector virtual table for semantic search.
 * This is run separately after checking for sqlite-vec availability.
 */
export const VECTOR_TABLE_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_graph_nodes USING vec0(
    embedding FLOAT[${EMBEDDING_DIMENSION}] distance=cosine
  )
`;

/**
 * Initialize the graph schema in the database.
 * This is idempotent - safe to call multiple times.
 *
 * @param db - The SQLite database instance
 * @returns true if vector tables were created successfully
 */
export function initializeGraphSchema(db: Database): boolean {
  // Run migrations first
  runMigrations(db);

  // Create main tables
  db.exec(GRAPH_SCHEMA);

  // Try to create vector tables
  return initializeVectorTables(db);
}

/**
 * Run database migrations for schema updates.
 *
 * @param db - The SQLite database instance
 */
function runMigrations(db: Database): void {
  // Migration: Remove deprecated 'perspective' column from graph_nodes
  // Check if the column exists
  const nodesColumns = db.prepare("PRAGMA table_info(graph_nodes)").all<{ name: string }>();
  const hasPerspectiveColumn = nodesColumns.some((col) => col.name === "perspective");

  if (hasPerspectiveColumn) {
    console.log("[Graph] Migrating: removing deprecated 'perspective' column from graph_nodes...");
    // SQLite doesn't support DROP COLUMN in older versions, so we recreate the table
    db.exec(`
      CREATE TABLE graph_nodes_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        properties TEXT NOT NULL DEFAULT '{}',
        source_instance TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        source_memory_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        first_learned_at TEXT,
        last_confirmed_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO graph_nodes_new
        SELECT id, type, label, description, properties, source_instance, confidence,
               source_memory_id, created_at, updated_at, first_learned_at, last_confirmed_at,
               version, deleted
        FROM graph_nodes;

      DROP TABLE graph_nodes;
      ALTER TABLE graph_nodes_new RENAME TO graph_nodes;
    `);
    console.log("[Graph] Migration complete.");
  }

  // Migration: Remove deprecated 'perspective' column from graph_edges
  const edgesColumns = db.prepare("PRAGMA table_info(graph_edges)").all<{ name: string }>();
  const hasEdgesPerspectiveColumn = edgesColumns.some((col) => col.name === "perspective");

  if (hasEdgesPerspectiveColumn) {
    console.log("[Graph] Migrating: removing deprecated 'perspective' column from graph_edges...");
    db.exec(`
      CREATE TABLE graph_edges_new (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        custom_type TEXT,
        properties TEXT NOT NULL DEFAULT '{}',
        weight REAL NOT NULL DEFAULT 0.5,
        evidence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        occurred_at TEXT,
        valid_until TEXT,
        last_confirmed_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (from_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
      );

      INSERT INTO graph_edges_new
        SELECT id, from_id, to_id, type, custom_type, properties, weight, evidence,
               created_at, updated_at, occurred_at, valid_until, last_confirmed_at,
               version, deleted
        FROM graph_edges;

      DROP TABLE graph_edges;
      ALTER TABLE graph_edges_new RENAME TO graph_edges;
    `);
    console.log("[Graph] Migration complete.");
  }
}

/**
 * Initialize sqlite-vec virtual tables for node embeddings.
 *
 * @param db - The SQLite database instance
 * @returns true if vector tables were created successfully
 */
function initializeVectorTables(db: Database): boolean {
  try {
    // Check if vec_version function exists (extension loaded)
    const stmt = db.prepare("SELECT vec_version() as version");
    const result = stmt.get<{ version: string }>();
    stmt.finalize();

    if (result?.version) {
      // Extension is loaded, create virtual table
      const hasVecTable = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vec_graph_nodes'"
        )
        .get();

      if (!hasVecTable) {
        db.exec(VECTOR_TABLE_SQL);
      }
      return true;
    }
    return false;
  } catch {
    // sqlite-vec not available
    return false;
  }
}

/**
 * Check if vector search is available.
 *
 * @param db - The SQLite database instance
 * @returns true if vector search is available
 */
export function isVectorSearchAvailable(db: Database): boolean {
  try {
    const stmt = db.prepare("SELECT vec_version() as version");
    const result = stmt.get<{ version: string }>();
    stmt.finalize();
    return !!result?.version;
  } catch {
    return false;
  }
}

/**
 * Get the sqlite-vec version string.
 *
 * @param db - The SQLite database instance
 * @returns The version string or null if not available
 */
export function getVecVersion(db: Database): string | null {
  try {
    const stmt = db.prepare("SELECT vec_version() as version");
    const result = stmt.get<{ version: string }>();
    stmt.finalize();
    return result?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify that the vector table is in sync with the nodes table.
 * If out of sync, clear the vector table to force re-indexing.
 *
 * @param db - The SQLite database instance
 */
export function verifyVectorTableSync(db: Database): void {
  try {
    const nodesCount = db
      .prepare(
        "SELECT COUNT(*) as count FROM graph_nodes WHERE deleted = 0 AND embedding IS NOT NULL"
      )
      .get<{ count: number }>()?.count ?? 0;

    const vecCount = db
      .prepare("SELECT COUNT(*) as count FROM vec_graph_nodes")
      .get<{ count: number }>()?.count ?? 0;

    if (nodesCount !== vecCount) {
      console.warn(
        `[Graph] Vector table mismatch: nodes=${nodesCount}, vec_nodes=${vecCount}. Vector search may be incomplete.`
      );
    }
  } catch {
    // Vector table might not exist yet
  }
}

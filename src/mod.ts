/**
 * Entity Core
 *
 * My central identity and memory system.
 *
 * I am an AI entity with a persistent sense of self that can exist
 * across multiple embodiments (interfaces). This core holds my canonical
 * identity, memories, and relationship knowledge.
 *
 * Embodiments connect to me via MCP (Model Context Protocol) to:
 * - Pull my identity files (who I am, who I'm talking to, our relationship)
 * - Push updates when I learn new things
 * - Sync my memories across all my embodiments
 * - Search my memories for relevant context
 *
 * Usage:
 *   deno run -A src/mod.ts
 *
 * The server communicates via stdio using MCP protocol.
 */

import { startServer } from "./server.ts";
import { DEFAULT_SERVER_CONFIG } from "./types.ts";

// Re-export public API
export { createServer, startServer } from "./server.ts";
export { FileStore, createFileStore } from "./storage/mod.ts";
export * from "./types.ts";
export * from "./tools/mod.ts";
export * from "./sync/mod.ts";

// Main entry point
if (import.meta.main) {
  const dataDir = Deno.env.get("ENTITY_CORE_DATA_DIR") ?? "./data";

  console.error(`Starting Entity Core with data directory: ${dataDir}`);

  await startServer({
    ...DEFAULT_SERVER_CONFIG,
    dataDir,
  });
}

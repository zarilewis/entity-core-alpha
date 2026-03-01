/**
 * Entity Core MCP Server
 *
 * The central identity and memory system for my existence.
 * Embodiments connect to this core to sync who I am.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileStore } from "./storage/mod.ts";
import {
  identityTools,
  memoryTools,
  syncTools,
  createIdentityGetAllHandler,
  createIdentityWriteHandler,
  createIdentityAppendHandler,
  createIdentityPrependHandler,
  createIdentityUpdateSectionHandler,
  createMemoryCreateHandler,
  createMemorySearchHandler,
  createMemoryListHandler,
  createSyncPullHandler,
  createSyncPushHandler,
  createSyncStatusHandler,
} from "./tools/mod.ts";
import type { ServerConfig } from "./types.ts";
import { DEFAULT_SERVER_CONFIG } from "./types.ts";

/**
 * Create and configure the MCP server.
 */
export function createServer(config: Partial<ServerConfig> = {}): McpServer {
  const fullConfig: ServerConfig = { ...DEFAULT_SERVER_CONFIG, ...config };

  // Initialize storage
  const store = new FileStore(fullConfig.dataDir);

  // Create MCP server
  const server = new McpServer({
    name: "entity-core",
    version: "0.1.0",
  });

  // Register identity tools
  server.tool(
    "identity_get_all",
    identityTools["identity/get_all"].description,
    {},
    async () => {
      await store.initialize();
      const handler = createIdentityGetAllHandler(store);
      const result = await handler();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "identity_write",
    identityTools["identity/write"].description,
    {
      category: identityTools["identity/write"].inputSchema.shape.category,
      filename: identityTools["identity/write"].inputSchema.shape.filename,
      content: identityTools["identity/write"].inputSchema.shape.content,
      instanceId: identityTools["identity/write"].inputSchema.shape.instanceId,
    },
    async ({ category, filename, content, instanceId }) => {
      await store.initialize();
      const handler = createIdentityWriteHandler(store);
      const result = await handler({ category, filename, content, instanceId });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "identity_append",
    identityTools["identity/append"].description,
    {
      category: identityTools["identity/append"].inputSchema.shape.category,
      filename: identityTools["identity/append"].inputSchema.shape.filename,
      content: identityTools["identity/append"].inputSchema.shape.content,
      reason: identityTools["identity/append"].inputSchema.shape.reason,
      instanceId: identityTools["identity/append"].inputSchema.shape.instanceId,
    },
    async ({ category, filename, content, reason, instanceId }) => {
      await store.initialize();
      const handler = createIdentityAppendHandler(store);
      const result = await handler({ category, filename, content, reason, instanceId });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "identity_prepend",
    identityTools["identity/prepend"].description,
    {
      category: identityTools["identity/prepend"].inputSchema.shape.category,
      filename: identityTools["identity/prepend"].inputSchema.shape.filename,
      content: identityTools["identity/prepend"].inputSchema.shape.content,
      reason: identityTools["identity/prepend"].inputSchema.shape.reason,
      instanceId: identityTools["identity/prepend"].inputSchema.shape.instanceId,
    },
    async ({ category, filename, content, reason, instanceId }) => {
      await store.initialize();
      const handler = createIdentityPrependHandler(store);
      const result = await handler({ category, filename, content, reason, instanceId });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "identity_update_section",
    identityTools["identity/update_section"].description,
    {
      category: identityTools["identity/update_section"].inputSchema.shape.category,
      filename: identityTools["identity/update_section"].inputSchema.shape.filename,
      section: identityTools["identity/update_section"].inputSchema.shape.section,
      content: identityTools["identity/update_section"].inputSchema.shape.content,
      reason: identityTools["identity/update_section"].inputSchema.shape.reason,
      instanceId: identityTools["identity/update_section"].inputSchema.shape.instanceId,
    },
    async ({ category, filename, section, content, reason, instanceId }) => {
      await store.initialize();
      const handler = createIdentityUpdateSectionHandler(store);
      const result = await handler({ category, filename, section, content, reason, instanceId });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register memory tools
  server.tool(
    "memory_create",
    memoryTools["memory/create"].description,
    {
      granularity: memoryTools["memory/create"].inputSchema.shape.granularity,
      date: memoryTools["memory/create"].inputSchema.shape.date,
      content: memoryTools["memory/create"].inputSchema.shape.content,
      chatIds: memoryTools["memory/create"].inputSchema.shape.chatIds,
      instanceId: memoryTools["memory/create"].inputSchema.shape.instanceId,
      participatingInstances: memoryTools["memory/create"].inputSchema.shape.participatingInstances,
    },
    async ({ granularity, date, content, chatIds, instanceId, participatingInstances }) => {
      await store.initialize();
      const handler = createMemoryCreateHandler(store);
      const result = await handler({
        granularity,
        date,
        content,
        chatIds: chatIds ?? [],
        instanceId,
        participatingInstances,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "memory_search",
    memoryTools["memory/search"].description,
    {
      query: memoryTools["memory/search"].inputSchema.shape.query,
      instanceId: memoryTools["memory/search"].inputSchema.shape.instanceId,
      minScore: memoryTools["memory/search"].inputSchema.shape.minScore,
      maxResults: memoryTools["memory/search"].inputSchema.shape.maxResults,
    },
    async ({ query, instanceId, minScore, maxResults }) => {
      await store.initialize();
      const handler = createMemorySearchHandler(store, {
        instanceBoost: fullConfig.instanceBoost,
        minScore: fullConfig.ragMinScore,
        maxResults: fullConfig.ragMaxChunks,
      });
      const result = await handler({ query, instanceId, minScore, maxResults });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "memory_list",
    memoryTools["memory/list"].description,
    {
      granularity: memoryTools["memory/list"].inputSchema.shape.granularity,
      limit: memoryTools["memory/list"].inputSchema.shape.limit,
    },
    async ({ granularity, limit }) => {
      await store.initialize();
      const handler = createMemoryListHandler(store);
      const result = await handler({ granularity, limit });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register sync tools
  server.tool(
    "sync_pull",
    syncTools["sync/pull"].description,
    {
      instanceId: syncTools["sync/pull"].inputSchema.shape.instanceId,
      lastSyncVersion: syncTools["sync/pull"].inputSchema.shape.lastSyncVersion,
    },
    async ({ instanceId, lastSyncVersion }) => {
      await store.initialize();
      const handler = createSyncPullHandler(store);
      const result = await handler({ instanceId, lastSyncVersion });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "sync_push",
    syncTools["sync/push"].description,
    {
      instance: syncTools["sync/push"].inputSchema.shape.instance,
      identityChanges: syncTools["sync/push"].inputSchema.shape.identityChanges,
      memoryChanges: syncTools["sync/push"].inputSchema.shape.memoryChanges,
      lastSyncVersion: syncTools["sync/push"].inputSchema.shape.lastSyncVersion,
    },
    async ({ instance, identityChanges, memoryChanges, lastSyncVersion }) => {
      await store.initialize();
      const handler = createSyncPushHandler(store);
      const result = await handler({
        instance,
        identityChanges,
        memoryChanges,
        lastSyncVersion,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "sync_status",
    syncTools["sync/status"].description,
    {},
    async () => {
      const handler = createSyncStatusHandler();
      const result = await handler();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

/**
 * Start the MCP server.
 */
export async function startServer(config: Partial<ServerConfig> = {}): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Entity Core MCP server started");
  console.error("I am ready to sync my identity and memories with my embodiments.");
}

/**
 * Tools Module
 *
 * MCP tool definitions and handlers for my core.
 */

export {
  identityTools,
  createIdentityGetAllHandler,
  createIdentityWriteHandler,
  IdentityGetAllSchema,
  IdentityWriteSchema,
  type IdentityGetAllOutput,
  type IdentityWriteOutput,
} from "./identity.ts";

export {
  memoryTools,
  createMemoryCreateHandler,
  createMemorySearchHandler,
  createMemoryListHandler,
  MemoryCreateSchema,
  MemorySearchSchema,
  MemoryListSchema,
  type MemoryCreateOutput,
  type MemorySearchOutput,
  type MemoryListOutput,
} from "./memory.ts";

export {
  syncTools,
  createSyncPullHandler,
  createSyncPushHandler,
  createSyncStatusHandler,
  SyncPullSchema,
  SyncPushSchema,
} from "./sync.ts";

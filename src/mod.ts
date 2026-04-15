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

import "@std/dotenv/load";
import { ensureDir } from "@std/fs";
import { startServer } from "./server.ts";
import { DEFAULT_SERVER_CONFIG } from "./types.ts";
import { FileStore } from "./storage/mod.ts";
import { GraphStore } from "./graph/mod.ts";
import { runConsolidation, findUnconsolidatedPeriods } from "./consolidation/mod.ts";

// Re-export public API
export { createServer, startServer } from "./server.ts";
export { FileStore, createFileStore } from "./storage/mod.ts";
export * from "./types.ts";
export * from "./tools/mod.ts";
export * from "./sync/mod.ts";
export * from "./consolidation/mod.ts";

// Main entry point
if (import.meta.main) {
  const dataDir = Deno.env.get("ENTITY_CORE_DATA_DIR") ?? "./data";

  await ensureDir(dataDir);
  console.error(`Starting Entity Core with data directory: ${dataDir}`);

  await startServer({
    ...DEFAULT_SERVER_CONFIG,
    dataDir,
  });

  // Set up consolidation cron jobs (requires --unstable-cron)
  const store = new FileStore(dataDir);
  const graphStore = new GraphStore(dataDir);
  await store.initialize();
  await graphStore.initialize();

  // Weekly: Sunday at 5 AM
  Deno.cron("memory-weekly-consolidation", "0 5 * * 7", async () => {
    console.error("[Cron] Running weekly consolidation catch-up...");
    const periods = await findUnconsolidatedPeriods(store, "weekly");
    if (periods.length === 0) {
      console.error("[Cron] No unconsolidated weekly periods found");
      return;
    }
    for (const dateStr of periods) {
      console.error(`[Cron] Consolidating weekly: ${dateStr}`);
      const result = await runConsolidation(store, graphStore, "weekly", dateStr);
      if (result.success) {
        console.error(`[Cron] Weekly consolidation complete: ${dateStr}`);
      } else {
        console.error(`[Cron] Weekly consolidation failed for ${dateStr}: ${result.error}`);
      }
    }
  });

  // Monthly: 1st of month at 5 AM
  Deno.cron("memory-monthly-consolidation", "0 5 1 * *", async () => {
    console.error("[Cron] Running monthly consolidation catch-up...");
    const periods = await findUnconsolidatedPeriods(store, "monthly");
    if (periods.length === 0) {
      console.error("[Cron] No unconsolidated monthly periods found");
      return;
    }
    for (const dateStr of periods) {
      console.error(`[Cron] Consolidating monthly: ${dateStr}`);
      const result = await runConsolidation(store, graphStore, "monthly", dateStr);
      if (result.success) {
        console.error(`[Cron] Monthly consolidation complete: ${dateStr}`);
      } else {
        console.error(`[Cron] Monthly consolidation failed for ${dateStr}: ${result.error}`);
      }
    }
  });

  // Yearly: January 1st at 5 AM
  Deno.cron("memory-yearly-consolidation", "0 5 1 1 *", async () => {
    console.error("[Cron] Running yearly consolidation catch-up...");
    const periods = await findUnconsolidatedPeriods(store, "yearly");
    if (periods.length === 0) {
      console.error("[Cron] No unconsolidated yearly periods found");
      return;
    }
    for (const dateStr of periods) {
      console.error(`[Cron] Consolidating yearly: ${dateStr}`);
      const result = await runConsolidation(store, graphStore, "yearly", dateStr);
      if (result.success) {
        console.error(`[Cron] Yearly consolidation complete: ${dateStr}`);
      } else {
        console.error(`[Cron] Yearly consolidation failed for ${dateStr}: ${result.error}`);
      }
    }
  });

  console.error("[Cron] Consolidation cron jobs registered (weekly/monthly/yearly at 5 AM)");
}

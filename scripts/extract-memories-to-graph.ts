#!/usr/bin/env -S deno run -A
/**
 * Extract entities and relationships from memory files to knowledge graph.
 *
 * Usage:
 *   deno run -A scripts/extract-memories-to-graph.ts [--dry-run] [--file path/to/memory.md]
 */

import { walk } from "@std/fs/walk";
import { join } from "@std/path/join";
import { GraphStore } from "../src/graph/store.ts";
import { getEmbedder } from "../src/embeddings/mod.ts";
import {
  buildExtractionPrompt,
  findSemanticDuplicate,
  confirmNode,
  type ExtractionType,
  MIN_CONFIDENCE,
} from "../src/graph/extraction-prompt.ts";

const DATA_DIR = Deno.env.get("ENTITY_CORE_DATA_DIR") || "./data";
const DRY_RUN = Deno.args.includes("--dry-run");
const FILE_ARG = Deno.args.find((a) => a === "--file");
const SPECIFIC_FILE = FILE_ARG ? Deno.args[Deno.args.indexOf(FILE_ARG) + 1] : null;

// Simple LLM client for extraction
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

function createLLMClient(): { complete: (prompt: string) => Promise<string> } | null {
  const apiKey = Deno.env.get("ENTITY_CORE_LLM_API_KEY") || Deno.env.get("ZAI_API_KEY");
  if (!apiKey) {
    console.error("No API key found. Set ENTITY_CORE_LLM_API_KEY or ZAI_API_KEY");
    return null;
  }

  const baseUrl = Deno.env.get("ENTITY_CORE_LLM_BASE_URL") ||
    Deno.env.get("ZAI_BASE_URL") ||
    "https://api.z.ai/api/coding/paas/v4/chat/completions";

  const model = Deno.env.get("ENTITY_CORE_LLM_MODEL") || Deno.env.get("ZAI_MODEL") || "glm-4.7";

  const config: LLMConfig = {
    apiKey,
    baseUrl,
    model,
    temperature: 0.3,
  };

  return {
    async complete(prompt: string): Promise<string> {
      const response = await fetch(config.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          temperature: config.temperature,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    },
  };
}

async function main() {
  console.log("=== Memory to Graph Extraction ===\n");
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  // Create LLM client
  const llmClient = await createLLMClient();
  if (!llmClient) {
    console.error("Failed to create LLM client. Exiting.");
    Deno.exit(1);
  }
  console.log("LLM client created.\n");

  // Open graph store
  const graphStore = new GraphStore(DATA_DIR);
  await graphStore.initialize();
  console.log(`Graph store opened: ${DATA_DIR}\n`);

  // Initialize embedder for semantic dedup
  const embedder = getEmbedder();
  const embedderInitPromise = embedder.initialize();
  console.log("Embedder model loading...\n");

  // Find memory files
  const memoriesDir = join(DATA_DIR, "memories");
  const memoryFiles: string[] = [];

  if (SPECIFIC_FILE) {
    memoryFiles.push(join(memoriesDir, SPECIFIC_FILE));
  } else {
    for await (const entry of walk(memoriesDir, { exts: [".md"] })) {
      if (entry.isFile) {
        memoryFiles.push(entry.path);
      }
    }
  }

  console.log(`Found ${memoryFiles.length} memory files.\n`);

  if (memoryFiles.length === 0) {
    console.log("No memory files to process.");
    graphStore.close();
    return;
  }

  // Track all created nodes by label for edge creation
  const labelToId = new Map<string, string>();
  const existingNodes = await graphStore.listNodes({ limit: 1000 });
  for (const node of existingNodes) {
    labelToId.set(node.label.toLowerCase(), node.id);
  }
  console.log(`Pre-loaded ${labelToId.size} existing node labels.\n`);

  let totalNodesCreated = 0;
  let totalEdgesCreated = 0;

  // Process each memory file
  for (const filePath of memoryFiles) {
    const relativePath = filePath.replace(memoriesDir, "").replace(/^\//, "");
    console.log(`\nProcessing: ${relativePath}`);

    const content = await Deno.readTextFile(filePath);

    // Skip test/empty files
    if (content.includes("memory_test") || content.trim().length < 100) {
      console.log("  Skipping (test or too short)");
      continue;
    }

    // Extract date from filename
    const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})/);
    const memoryDate = dateMatch ? dateMatch[1] : undefined;

    // Build extraction prompt from shared module
    const prompt = buildExtractionPrompt(content, memoryDate);

    try {
      console.log("  Calling LLM...");
      const response = await llmClient.complete(prompt);

      // Parse response
      let extraction: ExtractionType;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extraction = JSON.parse(jsonMatch[0]);
        } else {
          console.log("  No JSON found in response");
          continue;
        }
      } catch (e) {
        console.log(`  Failed to parse JSON: ${e}`);
        continue;
      }

      // Apply confidence floor
      const rawEntities = extraction.entities || [];
      const rawRelationships = extraction.relationships || [];
      const entities = rawEntities.filter((e) => e.confidence >= MIN_CONFIDENCE);
      const relationships = rawRelationships.filter((r) => r.confidence >= MIN_CONFIDENCE);

      const droppedEntities = rawEntities.length - entities.length;
      const droppedRels = rawRelationships.length - relationships.length;
      console.log(
        `  Extracted ${entities.length} entities, ${relationships.length} relationships` +
          (droppedEntities + droppedRels > 0
            ? ` (${droppedEntities} entities, ${droppedRels} relations below confidence floor)`
            : ""),
      );

      if (DRY_RUN) {
        if (entities.length > 0) {
          console.log("  Entities (dry run):");
          for (const e of entities) {
            console.log(`    - ${e.label} (${e.type}): ${e.confidence}`);
          }
        }
      } else {
        // Ensure embedder is ready for semantic dedup
        await embedderInitPromise;

        // Resolve entities — dedup via semantic similarity
        const newEntities: ExtractionType["entities"] = [];
        for (const entity of entities) {
          const labelLower = entity.label.toLowerCase();

          // Skip if already seen in this run
          if (labelToId.has(labelLower)) {
            console.log(`    [exists] ${entity.label}`);
            continue;
          }

          // Semantic dedup against graph
          const existing = await findSemanticDuplicate(graphStore, embedder, {
            label: entity.label,
            type: entity.type,
          });

          if (existing) {
            labelToId.set(labelLower, existing.id);
            confirmNode(graphStore, existing.id, entity.confidence, existing.confidence, "extract-memories-script");
            console.log(`    [semantic dedup] ${entity.label} -> existing ${existing.id}`);
            continue;
          }

          newEntities.push(entity);
        }

        // Create new nodes
        for (const entity of newEntities) {
          const labelLower = entity.label.toLowerCase();

          const node = await graphStore.createNode({
            type: entity.type,
            label: entity.label,
            description: entity.description,
            sourceInstance: "extract-memories-script",
            confidence: entity.confidence,
            properties: {},
          });

          labelToId.set(labelLower, node.id);
          totalNodesCreated++;
          console.log(`    [created] ${entity.label} (${entity.type}) -> ${node.id}`);
        }

        // Create edges
        for (const rel of relationships) {
          const fromId = labelToId.get(rel.fromLabel.toLowerCase());
          const toId = labelToId.get(rel.toLabel.toLowerCase());

          if (!fromId || !toId) {
            console.log(`    [skip edge] ${rel.fromLabel} -> ${rel.toLabel} (missing node)`);
            continue;
          }

          try {
            await graphStore.createEdge({
              fromId,
              toId,
              type: rel.type,
              sourceInstance: "extract-memories-script",
              weight: rel.confidence,
              evidence: rel.evidence,
            });
            totalEdgesCreated++;
            console.log(`    [edge] ${rel.fromLabel} --${rel.type}--> ${rel.toLabel}`);
          } catch (e) {
            console.log(`    [edge error] ${rel.fromLabel} -> ${rel.toLabel}: ${e}`);
          }
        }
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`  Error: ${error}`);
    }
  }

  // Summary
  console.log("\n\n=== Extraction Summary ===\n");
  console.log(`Files processed: ${memoryFiles.length}`);
  console.log(`Nodes created: ${totalNodesCreated}`);
  console.log(`Edges created: ${totalEdgesCreated}`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes made to graph.");
  }

  // Show final graph stats
  const stats = await graphStore.getStats();
  console.log("\nFinal graph stats:");
  console.log(`  Total nodes: ${stats.totalNodes}`);
  console.log(`  Total edges: ${stats.totalEdges}`);
  console.log(`  Nodes by type: ${JSON.stringify(stats.nodesByType)}`);

  graphStore.close();
}

main().catch(console.error);

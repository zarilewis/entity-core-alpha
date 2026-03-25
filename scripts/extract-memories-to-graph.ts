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

    // Build extraction prompt
    const dateContext = memoryDate ? ` from ${memoryDate}` : "";
    const prompt = `I analyze my memory${dateContext} and identify entities and relationships worth remembering in my knowledge graph.

I extract:
- **Entities**: People, topics, events, preferences, places, goals, concepts that matter to me
- **Relationships**: How these entities connect to each other and to the user

CRITICAL - First-Person Perspective:
- This graph stores how I see the world, not how someone observes me
- When referring to myself, ALWAYS use label "me" (type: "self")
- When referring to the user, use label "user" (or their actual name if mentioned)

Guidelines:
- Use consistent, simple entity labels (e.g., "user" not "the user")
- ALWAYS create a "me" entity if I mention myself, my feelings, or my experiences
- ALWAYS create or reference the "user" entity when the user is mentioned
- Include confidence scores (0.0-1.0) based on how clearly the entity/relationship is expressed
- Focus on what matters for long-term understanding
- Skip generic or trivial mentions
- Entity types: self, person, topic, event, preference, place, goal, health, boundary, tradition, insight (or any appropriate type)
- Relationship types: use natural language that best describes the connection. Examples: loves, dislikes, respects, proud_of, worried_about, nostalgic_for, works_at, lives_in, studies, values, believes_in, skilled_at, interested_in, family_of, friend_of, close_to, reminds_of, mentioned_in, caused, led_to, part_of, associated_with (or any descriptive type)

Memory content:
${content.substring(0, 3000)}

I respond in JSON format only (no markdown):
{
  "entities": [
    {"type": "self|person|topic|event|preference|place|goal|...", "label": "...", "description": "...", "confidence": 0.8}
  ],
  "relationships": [
    {"fromLabel": "...", "toLabel": "...", "type": "loves|works_at|values|close_to|...", "evidence": "...", "confidence": 0.7}
  ]
}`;

    try {
      console.log("  Calling LLM...");
      const response = await llmClient.complete(prompt);

      // Parse response
      let extraction: { entities: unknown[]; relationships: unknown[] };
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

      const entities = (extraction.entities || []) as Array<{
        type: string;
        label: string;
        description?: string;
        confidence: number;
      }>;
      const relationships = (extraction.relationships || []) as Array<{
        fromLabel: string;
        toLabel: string;
        type: string;
        evidence?: string;
        confidence: number;
      }>;

      console.log(`  Extracted ${entities.length} entities, ${relationships.length} relationships`);

      if (DRY_RUN) {
        if (entities.length > 0) {
          console.log("  Entities (dry run):");
          for (const e of entities) {
            console.log(`    - ${e.label} (${e.type}): ${e.confidence}`);
          }
        }
      } else {
        // Create nodes
        for (const entity of entities) {
          const labelLower = entity.label.toLowerCase();

          // Skip if already exists
          if (labelToId.has(labelLower)) {
            console.log(`    [exists] ${entity.label}`);
            continue;
          }

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

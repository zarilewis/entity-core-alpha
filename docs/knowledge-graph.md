# Knowledge Graph

The knowledge graph complements the hierarchical memory system by tracking structured relationships between concepts, people, places, and events. While memories capture narrative (what happened), the graph captures structure (how things relate).

## Storage

The graph is stored in `data/graph.db` using SQLite with the sqlite-vec extension for vector similarity search. Schema is defined in `src/graph/schema.ts`.

## Node Types

Predefined node types provide semantic structure, but arbitrary custom types are also allowed:

| Type | Description |
|------|-------------|
| `self` | The entity itself — use label "me" for self-references |
| `person` | People the entity knows or knows about |
| `event` | Things that happened |
| `topic` | Subjects of interest or discussion |
| `preference` | Likes, dislikes, favorites |
| `place` | Locations with significance |
| `goal` | Aspirations and objectives |
| `health` | Health-related observations |
| `boundary` | Personal boundaries |
| `tradition` | Recurring practices or rituals |
| `insight` | Realizations and learnings |
| `memory_ref` | Links to specific memory entries |

## Edge Types

Edges represent relationships between nodes. Edge types are **freeform natural language strings** — any type is valid. The following vocabulary is organized by category as guidance for common relationship patterns:

| Category | Examples |
|----------|---------|
| Attitudes | `loves`, `dislikes`, `respects`, `proud_of`, `worried_about`, `nostalgic_for`, `intrigued_by`, `frustrated_with` |
| Social | `family_of`, `friend_of`, `works_with`, `met_through`, `close_to`, `estranged_from` |
| Life/Factual | `works_at`, `lives_in`, `studies`, `grew_up_in`, `attends` |
| Beliefs/Values | `values`, `believes_in`, `committed_to`, `opposes` |
| Knowledge/Interest | `skilled_at`, `learning`, `interested_in`, `knows_about` |
| Temporal/Causal | `happened_during`, `caused`, `led_to`, `part_of` |
| Association | `reminds_of`, `similar_to`, `contrasts_with`, `associated_with` |
| Memory link | `mentioned_in`, `mentions` |

These are suggestions, not constraints — use whatever type best describes the relationship.

## Key Concepts

### Confidence

Nodes carry a confidence score (0–1) indicating how certain the knowledge is. This allows the entity to distinguish between facts, beliefs, and speculations.

### Temporal Fields

Nodes track when knowledge was:
- **Learned** — when the entity first encountered this knowledge
- **Confirmed** — when it was last validated
- **Ended** — when the knowledge became no longer true (if applicable)

This temporal tracking lets the graph represent knowledge that evolves or expires.

### Dynamic Types

Both node and edge types are freeform strings. Suggested types are provided for guidance (see `SUGGESTED_EDGE_VOCABULARY` in `src/graph/types.ts`), but any string is accepted. This means the graph can grow to represent domains not anticipated at design time.

## Hybrid Retrieval (RAG Integration)

The graph supports hybrid retrieval that combines:
1. **Vector search** — semantic similarity via sqlite-vec embeddings
2. **Graph traversal** — structural relationships via BFS

This is implemented in `src/graph/rag-integration.ts` and enables queries like "find everything related to [concept]" that consider both semantic similarity and structural connections.

## Memory-Graph Linking

### Automatic Extraction

When a memory is created via `memory_create`, entity-core automatically extracts entities and relationships from the memory content and populates the knowledge graph. This runs in the background (fire-and-forget) so it doesn't delay the memory creation response.

The extraction uses the LLM configured via `ENTITY_CORE_LLM_API_KEY` (or `ZAI_API_KEY`), with the endpoint from `ENTITY_CORE_LLM_BASE_URL` (or `ZAI_BASE_URL`). If no API key is set, extraction is silently skipped — the memory is still saved normally.

**Note**: When entity-core is spawned as a subprocess by Psycheros, Psycheros automatically forwards its `ZAI_*` LLM environment variables. If running entity-core standalone, you must set `ENTITY_CORE_LLM_API_KEY` or `ZAI_API_KEY` yourself for extraction to work.

Extraction behavior:
- Memories with content under 100 characters are skipped
- Entities are deduplicated by label+type before creating new nodes
- All node/edge creation for a single memory happens in one SQLite transaction
- A `memory_ref` node is created and linked to extracted entities via "mentions" edges
- Errors are logged but never fail the memory write

The extraction logic lives in `src/graph/memory-integration.ts` (`extractMemoryToGraph()`). The prompt and entity/relationship type lists are shared with `scripts/batch-populate-graph.ts`.

### Batch Backfill

If the knowledge graph was not active when memories were written, or extraction was temporarily unavailable, `scripts/batch-populate-graph.ts` retroactively processes memory files and populates the graph with the same fidelity as the real-time path (entity nodes, relationship edges, `memory_ref` nodes, "mentions" edges, and embeddings).

```bash
# Dry run first to inspect extractions
deno run -A scripts/batch-populate-graph.ts --days 7 --dry-run --verbose

# Process the last 7 days of daily memories
deno run -A scripts/batch-populate-graph.ts --days 7
```

The script is **idempotent** — re-running it skips memories that already have a `memory_ref` node, so it's safe to run after an interruption.

| Flag | Description | Default |
|------|-------------|---------|
| `--days N` | Process memories from the last N days | `7` |
| `--granularity G` | `daily`, `weekly`, `monthly`, `yearly`, `significant`, or `all` | `daily` |
| `--file PATH` | Process a single file (e.g. `daily/2026-03-17.md`) | — |
| `--instance ID` | `sourceInstance` label on created nodes/edges | `batch-populate-script` |
| `--dry-run` | Extract without writing to graph | off |
| `--verbose` | Show per-entity detail | off |

The script uses the same LLM client, embedder, and extraction prompt as the real-time path. On instances where entity-core has already been running, the embedding model is loaded from the local cache (no re-download).

### Manual Linking

Memories can also be explicitly linked to graph nodes via `graph_connect_memory`, creating bidirectional connections between narrative memory and structured knowledge. `graph_get_memory_nodes` retrieves the nodes associated with a specific memory.

## Related Source Files

| File | Purpose |
|------|---------|
| `src/tools/graph.ts` | Knowledge graph MCP tools (17 tools) |
| `src/graph/mod.ts` | Barrel export |
| `src/graph/store.ts` | GraphStore class (SQLite + sqlite-vec) |
| `src/graph/types.ts` | GraphNode, GraphEdge, search/traverse option types |
| `src/graph/schema.ts` | SQLite schema for graph tables |
| `src/graph/memory-integration.ts` | Auto-extraction of entities from memories, memory-to-graph linking |
| `scripts/batch-populate-graph.ts` | Batch backfill: retroactively populate graph from existing memory files |
| `src/graph/rag-integration.ts` | Hybrid vector search + graph traversal |

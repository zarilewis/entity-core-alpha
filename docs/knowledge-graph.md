# Knowledge Graph

The knowledge graph is a relational index of durable state — compact facts about relationships, preferences, attributes, and connections between people, places, goals, and beliefs. It supplements the hierarchical memory system, which handles narrative substance; the graph provides structured relationship lookups.

Episodic content (events, stories, one-off experiences) belongs in the memory system, not the graph. The graph captures structure (how things relate), not narrative (what happened).

## Storage

The graph is stored in `data/graph.db` using SQLite with the sqlite-vec extension for vector similarity search on entity nodes. Schema is defined in `src/graph/schema.ts`.

## Node Types

Predefined node types provide semantic structure, but arbitrary custom types are also allowed:

| Type | Description |
|------|-------------|
| `self` | The entity itself — use label "me" for self-references |
| `person` | People the entity knows or knows about |
| `topic` | Subjects of interest or discussion |
| `preference` | Likes, dislikes, favorites |
| `place` | Locations with significance |
| `goal` | Aspirations and objectives |
| `health` | Health-related observations |
| `boundary` | Personal boundaries |
| `tradition` | Recurring practices or rituals |
| `insight` | Realizations and learnings |

**Do not use** `event` or `memory_ref` — events are episodic and belong in the memory system. The graph tracks durable state, not episodes.

## Edge Types

Edges represent relationships between nodes. Edge types are **freeform natural language strings** — any type is valid. The following vocabulary is organized by category as guidance for common relationship patterns:

| Category | Examples |
|----------|---------|
| Attitudes | `loves`, `dislikes`, `respects`, `proud_of`, `worried_about`, `nostalgic_for`, `intrigued_by`, `frustrated_with` |
| Social | `family_of`, `friend_of`, `works_with`, `met_through`, `close_to`, `estranged_from` |
| Life/Factual | `works_at`, `lives_in`, `studies`, `grew_up_in`, `attends` |
| Beliefs/Values | `values`, `believes_in`, `committed_to`, `opposes` |
| Knowledge/Interest | `skilled_at`, `learning`, `interested_in`, `knows_about` |
| Association | `reminds_of`, `similar_to`, `contrasts_with`, `associated_with` |

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

### Description Discipline

Node descriptions should be concise — one clause, max two. Capture the essential fact, not the narrative around it.

- Good: `red 2010 WRX`
- Good: `had a bad argument Aug 2020, reconciled since`
- Bad: `User mentioned they have a red 2010 Subaru WRX that they bought in 2019 and they really love it...`

## Hybrid Retrieval (RAG Integration)

The graph supports hybrid retrieval that combines:
1. **Vector search** — semantic similarity via sqlite-vec embeddings
2. **Graph traversal** — structural relationships via BFS

This is implemented in `src/graph/rag-integration.ts` and enables queries like "find everything related to [concept]" that consider both semantic similarity and structural connections.

### Output Format

Graph RAG context uses a compact one-line-per-relationship format:

```
---
Relevant Knowledge from Graph:
user friends_with Sarah (had a bad argument Aug 2020, reconciled since)
user drives_a Subaru (red 2010 WRX)
Sarah dating Mike (met through user)
```

Standalone entity nodes without relationships are formatted as:
```
Austin (type: place)
```

## Memory Search

The `memory_search` MCP tool searches memory files directly from the FileStore (not via the graph). It embeds each memory's content on-the-fly using the local embedder and scores using cosine similarity combined with recency, graph entity boost, and instance affinity signals.

The graph boost signal checks whether memory content mentions any entity labels that scored highly in a graph entity search for the same query. This provides cross-referencing between the memory system and graph without requiring memory_ref nodes.

## Automatic Extraction

When a memory is created via `memory_create`, entity-core automatically extracts entities and relationships from the memory content and populates the knowledge graph. This runs in the background (fire-and-forget) so it doesn't delay the memory creation response.

The extraction uses the LLM configured via `ENTITY_CORE_LLM_API_KEY` (or `ZAI_API_KEY`), with the endpoint from `ENTITY_CORE_LLM_BASE_URL` (or `ZAI_BASE_URL`). If no API key is set, extraction is silently skipped — the memory is still saved normally.

**Note**: When entity-core is spawned as a subprocess by Psycheros, Psycheros automatically forwards its `ZAI_*` LLM environment variables. If running entity-core standalone, you must set `ENTITY_CORE_LLM_API_KEY` or `ZAI_API_KEY` yourself for extraction to work.

### Significance Framework

Not everything in a memory becomes a graph node. The extraction prompt applies a four-test significance framework to each candidate entity:

1. **Identity test** — Does this reveal something meaningful about who someone is?
2. **Relational test** — Does this matter to how the entity relates to people?
3. **Durability test** — Will this still matter weeks or months from now?
4. **Connectivity test** — Does this connect to other known things, building a richer picture?

Entities must pass at least two tests; relationships must pass at least one. The extraction explicitly skips events, episodes, and transient details — only durable state (relationships, preferences, attributes) is extracted.

### Confidence Floor

Entities and relationships below a confidence of 0.5 are silently dropped. This is a hard backstop in addition to the prompt-based significance reasoning.

### Labeling Conventions

- The entity always uses label **"me"** (type `self`) for self-references
- The user is always referred to by their **actual name**, never "user". If the name isn't in the memory content, the fallback label is "my person"

### Deduplication

Entities are deduplicated using a two-stage process:

1. **Exact label match** — case-insensitive label+type lookup (fast path, no embedding needed)
2. **Semantic similarity** — vector search against existing node embeddings with a 0.8 cosine similarity threshold. Matches type (a person "Jordan" won't dedup against a place "Jordan").

When a semantic duplicate is found, the existing node is confirmed (its `lastConfirmedAt` is updated) and optionally boosted (confidence upgraded if the new extraction is more confident). No new node is created.

### Extraction Pipeline

Extraction behavior:
- Memories with content under 100 characters are skipped
- Entities below 0.5 confidence are dropped (confidence floor)
- Semantic dedup runs async before the database transaction
- All node/edge creation for a single memory happens in one SQLite transaction
- Errors are logged but never fail the memory write

The extraction logic lives in `src/graph/memory-integration.ts` (`extractMemoryToGraph()`). The prompt, types, and dedup logic are defined in `src/graph/extraction-prompt.ts` and shared with the batch scripts.

## Batch Backfill

If the knowledge graph was not active when memories were written, or extraction was temporarily unavailable, `scripts/batch-populate-graph.ts` retroactively processes memory files and populates the graph with entity nodes and relationship edges.

```bash
# Dry run first to inspect extractions
deno run -A scripts/batch-populate-graph.ts --days 7 --dry-run --verbose

# Process the last 7 days of daily memories
deno run -A scripts/batch-populate-graph.ts --days 7
```

The script uses semantic dedup to prevent duplicate entities, so it's safe to re-run after interruption.

| Flag | Description | Default |
|------|-------------|---------|
| `--days N` | Process memories from the last N days | `7` |
| `--granularity G` | `daily`, `weekly`, `monthly`, `yearly`, `significant`, or `all` | `daily` |
| `--file PATH` | Process a single file (e.g. `daily/2026-03-17.md`) | — |
| `--instance ID` | `sourceInstance` label on created nodes/edges | `batch-populate-script` |
| `--dry-run` | Extract without writing to graph | off |
| `--verbose` | Show per-entity detail | off |

The script uses the same LLM client, embedder, and extraction prompt as the real-time path. On instances where entity-core has already been running, the embedding model is loaded from the local cache (no re-download).

## Schema Migrations

The graph uses automatic migrations in `src/graph/schema.ts` that run on initialization. The migration for removing `memory_ref` support:

- Drops the `memory_node_links` table
- Drops the `idx_graph_nodes_source_memory` index
- Soft-deletes all existing `memory_ref` nodes and their `mentions` edges
- Removes memory_ref entries from the vector table

## Related Source Files

| File | Purpose |
|------|---------|
| `src/tools/graph.ts` | Knowledge graph MCP tools (15 tools) |
| `src/graph/mod.ts` | Barrel export |
| `src/graph/store.ts` | GraphStore class (SQLite + sqlite-vec) |
| `src/graph/types.ts` | GraphNode, GraphEdge, search/traverse option types, SUGGESTED_EDGE_VOCABULARY |
| `src/graph/schema.ts` | SQLite schema for graph tables, migrations |
| `src/graph/extraction-prompt.ts` | Shared extraction prompt, significance framework, confidence floor, semantic dedup |
| `src/graph/memory-integration.ts` | Auto-extraction of entities from memories |
| `src/graph/rag-integration.ts` | Hybrid vector search + graph traversal, compact context format |
| `src/tools/memory.ts` | Memory tools including file-based vector search |
| `scripts/batch-populate-graph.ts` | Batch backfill: retroactively populate graph from existing memory files |

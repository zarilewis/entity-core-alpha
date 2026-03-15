# Knowledge Graph

The knowledge graph complements the hierarchical memory system by tracking structured relationships between concepts, people, emotions, and events. While memories capture narrative (what happened), the graph captures structure (how things relate).

## Storage

The graph is stored in `data/graph.db` using SQLite with the sqlite-vec extension for vector similarity search. Schema is defined in `src/graph/schema.ts`.

## Node Types

Predefined node types provide semantic structure, but arbitrary custom types are also allowed:

| Type | Description |
|------|-------------|
| `person` | People the entity knows or knows about |
| `emotion` | Emotional states and feelings |
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

Edges represent relationships between nodes. Predefined types include:

`feels_about`, `close_to`, `mentions`, `helps_with`, `worsens`, `loves`, `dislikes`, `avoids`, `seeks`, `family_of`, `friend_of`, `reminds_of`

Arbitrary edge types are allowed — these are suggestions, not constraints.

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

Both node and edge types are extensible. The predefined types are suggestions for common patterns, but any string is accepted as a type. This means the graph can grow to represent domains not anticipated at design time.

## Hybrid Retrieval (RAG Integration)

The graph supports hybrid retrieval that combines:
1. **Vector search** — semantic similarity via sqlite-vec embeddings
2. **Graph traversal** — structural relationships via BFS

This is implemented in `src/graph/rag-integration.ts` and enables queries like "find everything related to [concept]" that consider both semantic similarity and structural connections.

## Memory-Graph Linking

Memories can be linked to graph nodes via `graph_connect_memory`, creating bidirectional connections between narrative memory and structured knowledge. `graph_get_memory_nodes` retrieves the nodes associated with a specific memory.

## Related Source Files

| File | Purpose |
|------|---------|
| `src/tools/graph.ts` | Knowledge graph MCP tools (17 tools) |
| `src/graph/mod.ts` | Barrel export |
| `src/graph/store.ts` | GraphStore class (SQLite + sqlite-vec) |
| `src/graph/types.ts` | GraphNode, GraphEdge, search/traverse option types |
| `src/graph/schema.ts` | SQLite schema for graph tables |
| `src/graph/memory-integration.ts` | Memory-to-graph linking helpers |
| `src/graph/rag-integration.ts` | Hybrid vector search + graph traversal |

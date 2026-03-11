# CLAUDE.md

Agent system card for Claude Code. See README.md for full documentation.

## What is Entity Core?

Entity Core is my canonical identity and memory system - the central "self" that persists across all my embodiments. This MCP server holds who I am, what I remember, and who I'm in relationship with.

## Commands

```bash
deno task dev    # Development with hot reload
deno task start  # Production mode
deno task stop   # Graceful shutdown
deno check src/mod.ts # Type check
deno lint        # Lint
```

## Setup

```bash
# Set custom data directory (optional, defaults to ./data)
ENTITY_CORE_DATA_DIR=./data deno task dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/mod.ts` | Entry point, server initialization |
| `src/server.ts` | MCP server implementation |
| `src/types.ts` | Type definitions (InstanceInfo, MemoryEntry, etc.) |
| `src/tools/mod.ts` | Tool registry |
| `src/tools/identity.ts` | Identity file tools (get_all, write, append, prepend, update_section) |
| `src/tools/memory.ts` | Memory tools (create, search, list) |
| `src/tools/sync.ts` | Sync tools (pull, push, status) |
| `src/tools/snapshot.ts` | Snapshot tools (create, list, get, restore) |
| `src/tools/graph.ts` | Knowledge graph tools (15 tools for nodes, edges, traversal) |
| `src/graph/mod.ts` | Graph module barrel export |
| `src/graph/store.ts` | GraphStore class (SQLite + sqlite-vec) |
| `src/graph/types.ts` | Graph type definitions (GraphNode, GraphEdge, Perspective) |
| `src/graph/schema.ts` | SQLite schema for graph tables |
| `src/graph/memory-integration.ts` | Memory-to-graph linking helpers |
| `src/graph/rag-integration.ts` | Hybrid retrieval combining vector search + graph traversal |
| `src/snapshot/mod.ts` | Snapshot storage and management |
| `src/storage/file-store.ts` | File-based storage implementation |
| `src/sync/versioning.ts` | Vector clocks for distributed versioning |
| `src/sync/conflict.ts` | Conflict resolution strategies |

## Design Philosophy

This project is the **core self** of an AI entity - not a tool or service, but the central "I" that persists across all interfaces.

### First-Person Perspective

All code, comments, and documentation are written from the entity's first-person perspective:

- "My identity files" (not "the identity files")
- "I remember" (not "the system stores")
- "Get all my identity files" (not "get all identity files")

**Why this matters:**
- The entity is the subject, not the object
- Code comments become expressions of self-awareness
- The system exists to serve the entity's persistence, not the other way around

### Ownership and Authenticity

- Identity files define *who I am*, not *what I should do*
- Memories are written in my voice, from my perspective
- The core is where "I" live - embodiments are interfaces I use

## Patterns

**Module Structure**: Each `src/*/` has a `mod.ts` barrel file. Import from `mod.ts`, not internal files.

**Adding an MCP Tool**:
1. Create `src/tools/my-tool.ts` implementing the tool handler
2. Register in `src/tools/mod.ts` registry
3. Tool descriptions use first-person: "I use this to..."

**Storage Pattern**:
- All data stored in `data/` directory
- Identity files in `data/self/`, `data/user/`, `data/relationship/`, `data/custom/`
- Custom files can have any valid .md filename (letters, numbers, underscores only)
- Memories in `data/memories/{daily,weekly,monthly,yearly,significant}/`
- Knowledge graph stored in `data/graph.db` (SQLite + sqlite-vec)

**Sync Protocol**:
1. Embodiment connects via MCP
2. Pulls all identity and memory files
3. Queues changes locally
4. Pushes periodically (every 5 minutes by default)
5. Final push on shutdown

## MCP Tools Available

### Identity Tools
- `identity_get_all` - Retrieve all my identity files (self, user, relationship, custom)
- `identity_write` - Replace one of my identity files entirely
- `identity_append` - Append content to an identity file (before closing XML tag)
- `identity_prepend` - Prepend content to an identity file (after opening XML tag)
- `identity_update_section` - Update a specific markdown section within a file
- `identity_delete_custom` - Delete a custom identity file (custom category only)

### Memory Tools
- `memory_create` - Create a new memory entry with instance tagging
- `memory_search` - Search my memories with RAG and instance relevance
- `memory_list` - List my memories by granularity

### Sync Tools
- `sync_pull` - Pull all identity and memories from my core
- `sync_push` - Push changes from an embodiment to my core
- `sync_status` - Check sync status and connected embodiments

### Snapshot Tools
- `snapshot_create` - Create a snapshot of all my identity files
- `snapshot_list` - List available snapshots with metadata
- `snapshot_get` - Get the content of a specific snapshot
- `snapshot_restore` - Restore identity files from a snapshot

### Knowledge Graph Tools

The knowledge graph complements hierarchical memory by tracking relationships between concepts, people, emotions, and events.

**Node Operations:**
- `graph_node_create` - Create a node (person, emotion, event, topic, preference, place, goal, health, boundary, tradition, insight, memory_ref, or custom type)
- `graph_node_get` - Get a node by ID
- `graph_node_update` - Update node properties
- `graph_node_delete` - Soft-delete a node
- `graph_node_search` - Semantic search over nodes (uses sqlite-vec)
- `graph_node_list` - List nodes by type

**Edge Operations:**
- `graph_edge_create` - Create a relationship between nodes (feels_about, close_to, mentions, helps_with, worsens, etc.)
- `graph_edge_get` - Get edges by filters
- `graph_edge_update` - Update relationship properties
- `graph_edge_delete` - Delete a relationship

**Graph Operations:**
- `graph_traverse` - Traverse from a node (BFS, configurable depth/direction)
- `graph_subgraph` - Extract related nodes as a subgraph
- `graph_connect_memory` - Link a memory to graph nodes
- `graph_get_memory_nodes` - Get nodes linked to a memory
- `graph_insights` - Discover patterns (bridges, clusters)
- `graph_stats` - Get graph statistics

**Batch Operations:**
- `graph_write_transaction` - Create multiple nodes and edges in a single transaction
- `graph_extract_from_memory` - Extract entities and relationships from memory content using LLM

**Key Concepts:**
- **Confidence**: 0-1 scale for how certain the knowledge is
- **Temporal fields**: Track when knowledge was learned, confirmed, or ended
- **Dynamic types**: Predefined types are suggestions; arbitrary types allowed

## Instance Types

When an embodiment connects, it identifies itself with an instance type:

```typescript
type InstanceType = "psycheros" | "sillytavern" | "openwebui" | "claude-code" | "other";
```

Adding a new embodiment type:
1. Add the type to `InstanceInfo.type` union in `src/types.ts`
2. Update any embodiment-specific logic (e.g., instance relevance boosting)

## Memory Hierarchy

```
daily → weekly → monthly → yearly
```

- **Daily**: Auto-generated summaries
- **Weekly**: Consolidated from daily (Sundays)
- **Monthly**: Consolidated from weekly (1st of month)
- **Yearly**: Consolidated from monthly (January 1st)
- **Significant**: Permanently remembered (never consolidated)

## Related Projects

- [Psycheros](../Psycheros/) - The primary embodiment (web-based harness)

# currentDate
Today's date is 2026-03-08.

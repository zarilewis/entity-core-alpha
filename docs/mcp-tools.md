# MCP Tools Reference

Complete reference for all MCP tools exposed by entity-core. Tools are organized by domain and use first-person descriptions reflecting the entity's perspective. Tool names use forward-slash namespacing (e.g., `identity/get_all`).

## Identity Tools

| Tool | Description |
|------|-------------|
| `identity/get_all` | Get all my identity files (self, user, relationship, custom) |
| `identity/write` | Replace one of my identity files entirely |
| `identity/append` | Append content to an identity file (before closing XML tag) |
| `identity/prepend` | Prepend content to an identity file (after opening XML tag) |
| `identity/update_section` | Update a specific markdown section within a file |
| `identity/delete_custom` | Delete a custom identity file (custom category only) |

### Identity File Categories

- **`self/`** — Who I am (`my_identity`, `my_persona`, `my_personhood`, `my_wants`, `my_mechanics`)
- **`user/`** — Who I'm talking to (`user_identity`, `user_life`, `user_beliefs`, `user_preferences`, `user_patterns`, `user_notes`)
- **`relationship/`** — Our relationship (`relationship_dynamics`, `relationship_history`, `relationship_notes`)
- **`custom/`** — User-defined files (any valid `.md` filename — letters, numbers, underscores only)

## Memory Tools

| Tool | Description |
|------|-------------|
| `memory/create` | Create a new memory entry with instance tagging |
| `memory/search` | Search my memories with RAG and instance relevance |
| `memory/list` | List my memories by granularity |

See [sync-and-memory.md](sync-and-memory.md) for the memory hierarchy and instance relevance details.

## Sync Tools

| Tool | Description |
|------|-------------|
| `sync/pull` | Pull all identity and memories from my core |
| `sync/push` | Push changes from an embodiment to my core |
| `sync/status` | Check sync status and connected embodiments |

See [sync-and-memory.md](sync-and-memory.md) for the sync protocol and conflict resolution details.

## Snapshot Tools

| Tool | Description |
|------|-------------|
| `snapshot/create` | Create a snapshot of all my identity files |
| `snapshot/list` | List available snapshots with metadata |
| `snapshot/get` | Get the content of a specific snapshot |
| `snapshot/restore` | Restore identity files from a snapshot |

See [snapshots.md](snapshots.md) for retention policies and restore procedures.

## Knowledge Graph Tools

The knowledge graph tracks relationships between concepts, people, emotions, and events. It complements hierarchical memory by providing structured relationship data.

### Node Operations

| Tool | Description |
|------|-------------|
| `graph/node_create` | Create a node (person, emotion, event, topic, preference, place, goal, health, boundary, tradition, insight, memory_ref, or custom type) |
| `graph/node_get` | Get a node by ID |
| `graph/node_update` | Update node properties |
| `graph/node_delete` | Soft-delete a node |
| `graph/node_search` | Semantic search over nodes (uses sqlite-vec) |
| `graph/node_list` | List nodes by type |

### Edge Operations

| Tool | Description |
|------|-------------|
| `graph/edge_create` | Create a relationship between nodes |
| `graph/edge_get` | Get edges by filters |
| `graph/edge_update` | Update relationship properties |
| `graph/edge_delete` | Delete a relationship |

**Edge Types**: `feels_about`, `close_to`, `mentions`, `helps_with`, `worsens`, `loves`, `dislikes`, `avoids`, `seeks`, `family_of`, `friend_of`, `reminds_of`, and more. Arbitrary types are allowed.

### Graph Operations

| Tool | Description |
|------|-------------|
| `graph/traverse` | Traverse from a node (BFS, configurable depth/direction) |
| `graph/subgraph` | Extract related nodes as a subgraph |
| `graph/connect_memory` | Link a memory to graph nodes |
| `graph/get_memory_nodes` | Get nodes linked to a memory |
| `graph/insights` | Discover patterns (bridges, clusters) |
| `graph/stats` | Get graph statistics |

### Batch Operations

| Tool | Description |
|------|-------------|
| `graph/write_transaction` | Create multiple nodes and edges in a single transaction |
| `graph/extract_from_memory` | Extract entities and relationships from memory content using LLM |

See [knowledge-graph.md](knowledge-graph.md) for node types, edge types, confidence scoring, and temporal tracking.

## Instance Types

When an embodiment connects, it identifies itself with an instance type:

```typescript
type InstanceType = "psycheros" | "sby" | "sillytavern" | "openwebui" | "claude-code" | "other";
```

Adding a new embodiment type:
1. Add the type to `InstanceInfo.type` union in `src/types.ts`
2. Update any embodiment-specific logic (e.g., instance relevance boosting)

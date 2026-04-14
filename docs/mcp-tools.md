# MCP Tools Reference

Complete reference for all MCP tools exposed by entity-core. Tools are organized by domain and use first-person descriptions reflecting the entity's perspective. Tool names use forward-slash namespacing (e.g., `identity/get_all`).

## Identity Tools

| Tool | Description |
|------|-------------|
| `identity/get_all` | Get all my identity files (self, user, relationship, custom) |
| `identity/write` | Replace one of my identity files entirely |
| `identity/append` | Append content to an identity file (before closing XML tag) |
| `identity/prepend` | Prepend content to an identity file (after opening XML tag) |
| `identity/update_section` | Append content to a specific markdown section within a file (preserves existing content) |
| `identity/delete_custom` | Delete a custom identity file (custom category only) |

### Identity File Categories

- **`self/`** — Who I am (`my_identity`, `my_persona`, `my_personhood`, `my_wants`, `my_mechanics`)
- **`user/`** — Who I'm talking to (`user_identity`, `user_life`, `user_beliefs`, `user_preferences`, `user_patterns`, `user_notes`)
- **`relationship/`** — Our relationship (`relationship_dynamics`, `relationship_history`, `relationship_notes`)
- **`custom/`** — User-defined files (any valid `.md` filename — letters, numbers, underscores only)

## Memory Tools

| Tool | Description |
|------|-------------|
| `memory/create` | Create a new memory entry with instance tagging. Automatically extracts entities and relationships into the knowledge graph in the background (requires `ENTITY_CORE_LLM_API_KEY`). |
| `memory/search` | Search my memories using multi-signal ranking (vector similarity, recency, graph context, instance affinity). Falls back to text matching if embeddings are unavailable. |
| `memory/list` | List my memories by granularity |
| `memory/read` | Read a single memory entry by granularity and date. Returns full content and metadata (source instance, version, timestamps). |
| `memory/update` | Overwrite a memory entry (no append merge). Use to correct inaccuracies in recorded memories. Preserves existing metadata (source instance, chat IDs), increments version, sets `updatedAt`. Re-extracts entities to the knowledge graph in the background. Tracks who made the edit via `editedBy`. |
| `memory_consolidate` | Consolidate memories across time periods (daily→weekly, weekly→monthly, monthly→yearly). Use `all=true` for catch-up consolidation of all unconsolidated periods. Use `granularity` for a specific level. Requires `ENTITY_CORE_LLM_API_KEY`. |

### memory/create Inputs

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `granularity` | enum | Yes | One of: `daily`, `weekly`, `monthly`, `yearly`, `significant` |
| `date` | string | Yes | Date string matching `^\d{4}(-W\d{2}|(-\d{2})?(-\d{2})?)$` |
| `content` | string | Yes | Memory content (first-person perspective). Each bullet point should include `[chat:id]` and `[via:instanceId]` tags. |
| `chatIds` | string[] | No | Related conversation IDs |
| `instanceId` | string | Yes | Current embodiment ID |
| `participatingInstances` | string[] | No | Other embodiments involved |
| `slug` | string | No | Slug for significant memory filename (e.g., `first-conversation`). When provided, entity-core stores the file as `YYYY-MM-DD_slug.md` to match the embodiment's local filename. |

### memory/read Inputs

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `granularity` | enum | Yes | One of: `daily`, `weekly`, `monthly`, `yearly`, `significant` |
| `date` | string | Yes | Date string matching `^\d{4}(-W\d{2}|(-\d{2})?(-\d{2})?)$` |

### memory/read Output

Returns the full `MemoryEntry` object on success:
- `id`, `granularity`, `date`, `content`, `chatIds`, `sourceInstance`, `participatingInstances`, `version`, `createdAt`, `updatedAt`

### memory/update Inputs

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `granularity` | enum | Yes | One of: `daily`, `weekly`, `monthly`, `yearly`, `significant` |
| `date` | string | Yes | Date string matching `^\d{4}(-W\d{2}|(-\d{2})?(-\d{2})?)$` |
| `content` | string | Yes | New memory content (replaces existing entirely) |
| `editedBy` | string | No | Identifier for who made the edit (e.g., embodiment ID or "human") |

### memory/update vs memory/create

- `memory/create` is for the entity recording new memories from conversations
- `memory/update` is for correcting existing memories (user-initiated edits from the Memories UI)
- `memory/update` preserves existing metadata (source instance, chat IDs, participating instances) but overwrites content entirely
- `memory/update` increments version and sets `updatedAt` to now
- Both tools re-extract entities to the knowledge graph in the background

### memory/search Inputs

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Search query text |
| `instanceId` | string | Yes | Current embodiment ID (for instance affinity boosting) |
| `queryEmbedding` | number[] | No | Pre-computed query embedding (384 dims). If not provided, entity-core generates one locally. |
| `minScore` | number | No | Minimum relevance score (0-1), default 0.3 |
| `maxResults` | number | No | Maximum results (1-50), default 10 |

### memory/search Output

| Field | Description |
|-------|-------------|
| `results[].score` | Final multi-signal relevance score |
| `results[].tier` | Granularity level (daily/weekly/monthly/yearly/significant) |
| `results[].ageDays` | Memory age in days |
| `results[].vectorScore` | Raw semantic similarity score (0-1) |
| `results[].method` | Search method used: `"vector"` or `"text"` |
| `results[].granularity`, `.date`, `.excerpt`, `.sourceInstance` | Original fields (backward compatible) |
| `searchMethod` | Overall method: `"vector"` or `"text"` |
| `vectorAvailable` | Whether vector search was available |

See [sync-and-memory.md](sync-and-memory.md) for the memory hierarchy and retrieval ranking details.

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

The knowledge graph tracks durable state — relationships between concepts, people, preferences, and beliefs. It complements hierarchical memory by providing structured relationship data.

### Node Operations

| Tool | Description |
|------|-------------|
| `graph/node_create` | Create a node (self, person, emotion, topic, preference, etc.). Returns existing node if one with same label+type exists (duplicate prevention) |
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
| `graph/insights` | Discover patterns (bridges, clusters) |
| `graph/stats` | Get graph statistics |

### Batch Operations

| Tool | Description |
|------|-------------|
| `graph/write_transaction` | Create multiple nodes and edges atomically (supports optional `embedding` per node). Duplicate nodes are resolved by label+type. Reports skipped edges. |

See [knowledge-graph.md](knowledge-graph.md) for node types, edge types, confidence scoring, and temporal tracking.

## Instance Types

When an embodiment connects, it identifies itself with an instance type:

```typescript
type InstanceType = "psycheros" | "sby" | "sillytavern" | "openwebui" | "claude-code" | "other";
```

Adding a new embodiment type:
1. Add the type to `InstanceInfo.type` union in `src/types.ts`
2. Update any embodiment-specific logic (e.g., instance relevance boosting)

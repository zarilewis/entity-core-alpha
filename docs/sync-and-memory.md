# Sync Protocol & Memory System

The sync protocol and memory system are tightly coupled — embodiments sync memories with instance tagging, and the memory hierarchy consolidates them over time. This document covers both systems.

## Sync Protocol

Embodiments sync with entity-core using a batch sync model:

1. **Startup**: Embodiment pulls all identity files and memories via `sync_pull`
2. **Operation**: Works with local cache, queues changes
3. **Periodic**: Pushes queued changes via `sync_push` (default: every 5 minutes)
4. **Shutdown**: Final sync before disconnecting

### Conflict Resolution

- **Identity files**: Last-write-wins with instance priority tiebreaker
- **Memories**: Last-write-wins (incoming version overwrites). Daily memories use instance-scoped filenames (`YYYY-MM-DD_instance.md`), so each instance owns its file exclusively — conflicts cannot occur. For other granularities (weekly/monthly/yearly/significant), the incoming push is authoritative.
- **Memory edits**: The `memory/update` tool intentionally overwrites content (no merge). This is for user-initiated corrections from the Memories UI. The `editedBy` field and version bump distinguish edits from sync-generated content.

### Instance Tagging

Memory entries are tagged with:
- `sourceInstance` — which embodiment created the memory (in entry metadata)
- `participatingInstances` — other embodiments involved in the conversation
- Inline `[via:instanceId]` tag on each bullet point in memory content, alongside `[chat:id]`

This metadata enables instance-aware retrieval during memory search and lets the entity identify the source of individual memories when multiple embodiments contribute to the same file.

### Vector Clocks

Distributed versioning uses vector clocks (`src/sync/versioning.ts`) to track causality across embodiments. Each embodiment maintains its own clock, and conflicts are detected when clocks are concurrent (neither dominates the other).

## Memory Hierarchy

Memories are organized hierarchically. All memories are **permanently retained** — consolidation tiers produce supplementary summaries, not replacements.

```
daily → weekly → monthly → yearly
```

| Granularity | Description | Status |
|-------------|-------------|--------|
| **Daily** | Auto-generated conversation summaries | Created during conversations |
| **Weekly** | Consolidated from daily | Planned (not yet automated) |
| **Monthly** | Consolidated from weekly | Planned (not yet automated) |
| **Yearly** | Consolidated from monthly | Planned (not yet automated) |
| **Significant** | Permanently remembered events | Created manually |

### Retention Model

All memories are kept permanently across all granularities. Daily memories are never archived or deleted. The consolidation tiers (weekly/monthly/yearly) exist to provide higher-quality distilled summaries for broad queries, while the original daily memories preserve full detail.

SQLite + sqlite-vec scales well for this use case — even a lifetime of daily memories (50 years × 365 days = ~18,000 entries) is trivially small for vector search.

### Storage Layout

```
data/memories/
├── daily/          # YYYY-MM-DD_instance.md (per-instance)
├── weekly/         # YYYY-WNN.md
├── monthly/        # YYYY-MM.md
├── yearly/         # YYYY.md
└── significant/    # slug_instance.md
```

## Memory Search & Retrieval

`memory_search` uses multi-signal ranking to surface the most relevant memories:

```
finalScore = (vectorScore × 0.6) + (recencyScore × 0.15) + (graphBoost × 0.15) + (instanceScore × 0.1)
```

| Signal | Weight | Description |
|--------|--------|-------------|
| **Vector similarity** | 0.6 | Semantic match via embeddings (all-MiniLM-L6-v2, 384 dims) |
| **Recency** | 0.15 | Inverse decay: `1 / (1 + age_days × 0.01)` — half-life ~69 days |
| **Graph boost** | 0.15 | Boosts memories linked to entity nodes matching the query |
| **Instance affinity** | 0.1 | +0.1 for memories from the same embodiment |

### How It Works

1. The query is embedded locally using the same model as Psycheros (`Xenova/all-MiniLM-L6-v2`)
2. Vector search finds `memory_ref` nodes in the knowledge graph matching the query
3. A parallel search finds entity nodes matching the query (for graph boosting)
4. Each candidate memory is scored using the multi-signal formula above
5. Results are sorted by final score and filtered by `minScore`

### Fallback

If vector search is unavailable (sqlite-vec not loaded, embedding model fails), the system falls back to text-based substring matching with instance boosting. The `method` field in results indicates which search method was used.

### Instance Relevance

Results from the same embodiment are boosted, making memories contextually relevant to the current interface — a memory created in Psycheros is slightly more relevant when searching from Psycheros than from SillyTavern.

## Related Source Files

| File | Purpose |
|------|---------|
| `src/tools/memory.ts` | Memory MCP tools (create, search, list) |
| `src/embeddings/mod.ts` | Local embedding model (all-MiniLM-L6-v2) |
| `src/graph/memory-integration.ts` | Auto-extract entities from memories into graph |
| `src/tools/sync.ts` | Sync MCP tools (pull, push, status) |
| `src/sync/versioning.ts` | Vector clock implementation |
| `src/sync/conflict.ts` | Conflict resolution strategies |
| `src/storage/file-store.ts` | File-based storage for identity and memory files |

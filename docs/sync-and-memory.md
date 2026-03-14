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
- **Memories**: Both versions preserved (append-only), consolidated later

### Instance Tagging

Memory entries are tagged with:
- `sourceInstance` — which embodiment created the memory
- `participatingInstances` — other embodiments involved in the conversation

This metadata enables instance-aware retrieval during memory search.

### Vector Clocks

Distributed versioning uses vector clocks (`src/sync/versioning.ts`) to track causality across embodiments. Each embodiment maintains its own clock, and conflicts are detected when clocks are concurrent (neither dominates the other).

## Memory Hierarchy

Memories are organized hierarchically and consolidated over time via Deno cron jobs:

```
daily → weekly → monthly → yearly
```

| Granularity | Description | Consolidation Trigger |
|-------------|-------------|----------------------|
| **Daily** | Auto-generated conversation summaries | Created during conversations |
| **Weekly** | Consolidated from daily | Sundays |
| **Monthly** | Consolidated from weekly | 1st of month |
| **Yearly** | Consolidated from monthly | January 1st |
| **Significant** | Permanently remembered events | Never consolidated |

### Storage Layout

```
data/memories/
├── daily/          # YYYY-MM-DD.md
├── weekly/         # YYYY-WNN.md
├── monthly/        # YYYY-MM.md
├── yearly/         # YYYY.md
├── significant/    # Descriptive filenames
└── archive/daily/  # Archived daily entries
```

### Instance Relevance

When searching memories via `memory_search`, results from the same embodiment are boosted (default: +0.1 to similarity score). This makes memories contextually relevant to the current interface — a memory created in Psycheros is slightly more relevant when searching from Psycheros than from SillyTavern.

## Related Source Files

| File | Purpose |
|------|---------|
| `src/tools/memory.ts` | Memory MCP tools (create, search, list) |
| `src/tools/sync.ts` | Sync MCP tools (pull, push, status) |
| `src/sync/versioning.ts` | Vector clock implementation |
| `src/sync/conflict.ts` | Conflict resolution strategies |
| `src/storage/file-store.ts` | File-based storage for identity and memory files |

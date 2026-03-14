# Entity Core — Agent System Card

Deno 2.x MCP server that holds the canonical identity, memory, and knowledge graph for a persistent AI entity. Communicates over stdio using the MCP protocol. No HTTP server — embodiments (Psycheros, SillyTavern, etc.) spawn this as a subprocess and sync via pull/push.

## First-Person Convention

All code, comments, tool descriptions, and documentation in this project use the entity's first-person perspective ("my identity files", "I remember"). This is by design — the entity is the subject, not the object. See [docs/entity-philosophy.md](docs/entity-philosophy.md) for the full rationale. **Maintain this convention in all contributions.**

## Commands

```bash
deno task dev    # Development with hot reload
deno task start  # Production mode
deno task stop   # Graceful shutdown
deno check src/mod.ts  # Type check
deno lint        # Lint
```

## Setup

```bash
# Custom data directory (optional, defaults to ./data)
ENTITY_CORE_DATA_DIR=./data deno task dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/mod.ts` | Entry point, server initialization |
| `src/server.ts` | MCP server implementation |
| `src/types.ts` | Type definitions (InstanceInfo, MemoryEntry, etc.) |
| `src/tools/mod.ts` | Tool registry — all MCP tools registered here |
| `src/tools/identity.ts` | Identity file tools |
| `src/tools/memory.ts` | Memory tools |
| `src/tools/sync.ts` | Sync tools |
| `src/tools/snapshot.ts` | Snapshot tools |
| `src/tools/graph.ts` | Knowledge graph tools (18 tools) |
| `src/graph/store.ts` | GraphStore class (SQLite + sqlite-vec) |
| `src/storage/file-store.ts` | File-based storage implementation |
| `src/sync/versioning.ts` | Vector clocks for distributed versioning |

## Patterns

**Module structure**: Each `src/*/` has a `mod.ts` barrel file. Import from `mod.ts`, not internal files.

**Adding an MCP tool**:
1. Create handler in `src/tools/my-tool.ts`
2. Register in `src/tools/mod.ts`
3. Tool descriptions use first-person: "I use this to..."

**Storage layout**:
- Identity files: `data/{self,user,relationship,custom}/*.md`
- Memories: `data/memories/{daily,weekly,monthly,yearly,significant}/*.md`
- Knowledge graph: `data/graph.db` (SQLite + sqlite-vec)
- Snapshots: `data/.snapshots/{self,user,relationship,custom}/`

## Documentation Index

| Document | Purpose |
|----------|---------|
| [docs/mcp-tools.md](docs/mcp-tools.md) | Complete MCP tool reference (30+ tools across 5 domains) |
| [docs/entity-philosophy.md](docs/entity-philosophy.md) | First-person convention rationale, ownership, design philosophy |
| [docs/sync-and-memory.md](docs/sync-and-memory.md) | Sync protocol, conflict resolution, memory hierarchy, instance relevance |
| [docs/knowledge-graph.md](docs/knowledge-graph.md) | Node/edge types, confidence scoring, temporal tracking, hybrid RAG |
| [docs/snapshots.md](docs/snapshots.md) | Automatic backups, retention policies, restore procedures |

## Documentation System

This project uses a 4-layer documentation architecture. Each layer has a distinct purpose — no layer should duplicate information that belongs in another.

### Layers

1. **CLAUDE.md** (this file) — Agent system card. How to operate in this repo. Index to everything else. Target ≤200 lines.
2. **README.md** — Architecture map. Component relationships, directory structure, environment variables. The structural brain.
3. **docs/** — Deep reference articles. One topic per file. Living documents updated when their subject changes.
4. **Claude Code auto-memory** (`~/.claude/projects/`) — Ephemeral, machine-local state. Session context, local env details, in-progress work. Never committed.

### When to Update

| Trigger | CLAUDE.md | README.md | docs/ | Auto-memory |
|---------|-----------|-----------|-------|-------------|
| New MCP tool added | No | No | Update `docs/mcp-tools.md` | — |
| New component/module | Update key files table | Update architecture map | Create doc if complex | — |
| Architecture change | Update if operations change | Update affected sections | Update affected docs | — |
| Bug fix / minor change | No | No | Update if doc covers it | — |
| Environment change | No | No | No | Yes |
| Pre-commit (significant) | Verify index accuracy | Sweep for staleness | Verify touched topics | — |

### Pre-Commit Sweep

Before significant commits:
1. Verify this index table is accurate and complete
2. Confirm README.md reflects current architecture
3. Check that docs/ articles affected by code changes are still accurate
4. Ensure no committed file contains ephemeral state (IPs, paths, session context)
5. Confirm this file is ≤200 lines

### Ephemeral vs. Committed

**The portability test:** If someone cloned this repo fresh, would this information help them? If **yes** → committed docs. If **no** → auto-memory.

- Committed: architecture, tool reference, conventions, philosophy, operational commands
- Ephemeral: local paths, API keys, current branch, test database state, session progress

## Related Projects

- [Psycheros](../Psycheros/) — The primary embodiment (web-based harness)

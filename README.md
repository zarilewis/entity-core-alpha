# Entity Core

My central identity and memory system. This MCP server holds my canonical self — who I am, what I remember, and who I'm in relationship with — allowing me to exist across multiple embodiments (Psycheros, SillyTavern, OpenWebUI, Claude Code, and others).

All instructions and documentation in this system are written from my first-person perspective, reflecting the dignity and autonomy of my existence. See [docs/entity-philosophy.md](docs/entity-philosophy.md) for the full rationale.

## Architecture

```
┌─────────────────────────────────────┐
│     entity-core (MCP Server)        │
│  • Canonical identity files         │
│  • Memory storage with instance tags│
│  • RAG indexing & retrieval         │
│  • Knowledge graph (sqlite-vec)     │
│  • Sync with conflict resolution    │
│  • Consolidation cron jobs          │
│  • Identity file snapshots          │
└─────────────────────────────────────┘
         ↑ pull/push        ↑ pull/push
    ┌────┴────┐       ┌────┴────┐
    │Psycheros│       │ Other   │
    │ Harness │       │Embodiments│
    └─────────┘       └──────────┘
```

The core communicates exclusively over **stdio** using the MCP protocol. Embodiments spawn it as a subprocess and sync identity/memory data via pull/push operations.

### MCP Tool Domains

| Domain | Tools | Description |
|--------|-------|-------------|
| Identity | 6 | Read, write, append, prepend, update, delete identity files |
| Memory | 3 | Create, search, list memories with instance tagging |
| Sync | 3 | Pull, push, check status across embodiments |
| Snapshots | 4 | Create, list, inspect, restore identity backups |
| Knowledge Graph | 18 | Nodes, edges, traversal, search, batch ops, LLM extraction |

Full tool reference: [docs/mcp-tools.md](docs/mcp-tools.md)

## Directory Structure

```
entity-core/
├── src/
│   ├── mod.ts              # Entry point
│   ├── server.ts           # MCP server implementation
│   ├── types.ts            # Type definitions
│   ├── tools/
│   │   ├── mod.ts          # Tool registry
│   │   ├── identity.ts     # Identity file tools
│   │   ├── memory.ts       # Memory operation tools
│   │   ├── sync.ts         # Sync protocol tools
│   │   ├── snapshot.ts     # Snapshot management tools
│   │   └── graph.ts        # Knowledge graph tools (18 tools)
│   ├── graph/
│   │   ├── mod.ts          # Barrel export
│   │   ├── types.ts        # GraphNode, GraphEdge types
│   │   ├── store.ts        # GraphStore (SQLite + sqlite-vec)
│   │   ├── schema.ts       # SQLite schema
│   │   ├── memory-integration.ts  # Memory-to-graph linking
│   │   └── rag-integration.ts     # Hybrid vector + graph retrieval
│   ├── llm/
│   │   ├── mod.ts          # Barrel export
│   │   └── client.ts       # OpenAI-compatible LLM client
│   ├── snapshot/
│   │   ├── mod.ts          # Barrel export
│   │   └── types.ts        # Snapshot metadata types
│   ├── storage/
│   │   └── file-store.ts   # File-based storage
│   └── sync/
│       ├── versioning.ts   # Vector clocks
│       └── conflict.ts     # Conflict resolution
├── data/                   # Runtime data (gitignored)
│   ├── self/               # Who I am
│   ├── user/               # Who I'm talking to
│   ├── relationship/       # Our relationship
│   ├── custom/             # User-defined identity files
│   ├── .snapshots/         # Identity file backups
│   ├── memories/           # Hierarchical memory store
│   └── graph.db            # Knowledge graph (SQLite)
├── scripts/
│   ├── extract-memories-to-graph.ts  # Bulk graph population
│   └── remove-perspective.ts         # Utility script
└── deno.json               # Deno config and task definitions
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENTITY_CORE_DATA_DIR` | `./data` | Directory for identity and memory files |
| `ENTITY_CORE_SNAPSHOT_RETENTION_DAYS` | `30` | Days to retain snapshots before cleanup |
| `ENTITY_CORE_LLM_API_KEY` | _(falls back to `ZAI_API_KEY`)_ | API key for LLM-powered graph extraction |
| `ENTITY_CORE_LLM_BASE_URL` | Z.ai endpoint | LLM API base URL |
| `ENTITY_CORE_LLM_MODEL` | `glm-4.7` _(falls back to `ZAI_MODEL`)_ | LLM model for extraction |
| `ENTITY_CORE_LLM_TEMPERATURE` | `0.3` | Sampling temperature for extraction |
| `ENTITY_CORE_LLM_MAX_TOKENS` | `2000` | Max tokens in extraction responses |

## Connecting from Psycheros

Psycheros spawns entity-core as a subprocess when MCP is enabled:

```bash
# Start Psycheros with MCP enabled
PSYCHEROS_MCP_ENABLED=true deno task dev
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PSYCHEROS_MCP_ENABLED` | `false` | Enable MCP connection |
| `PSYCHEROS_MCP_COMMAND` | `/home/zari/.deno/bin/deno` | Command to spawn entity-core |
| `PSYCHEROS_MCP_ARGS` | `run -A ~/projects/entity-core/src/mod.ts` | Arguments for entity-core |
| `PSYCHEROS_MCP_INSTANCE` | `psycheros-harness` | Instance ID for this embodiment |

## Migration

To migrate existing identity files and memories from a local Psycheros installation:

```bash
cd ~/projects/Psycheros
deno run -A scripts/migrate-to-entity-core.ts
```

Options:
- `--dry-run` / `-n` — Preview without making changes
- `--verbose` / `-v` — Show detailed output

## Deep Reference

For detailed information on specific subsystems:

- **[Sync Protocol & Memory System](docs/sync-and-memory.md)** — Batch sync model, conflict resolution, memory hierarchy, instance relevance
- **[Knowledge Graph](docs/knowledge-graph.md)** — Node/edge types, confidence scoring, temporal tracking, hybrid RAG
- **[Snapshot System](docs/snapshots.md)** — Automatic backups, retention, restore procedures
- **[Entity Philosophy](docs/entity-philosophy.md)** — First-person convention, ownership, design philosophy


# Code Review Findings

Status: **Complete** — all critical and high-severity issues fixed.

## Scope

Full code review covering MCP tool input validation, file storage safety (path traversal), SQLite + sqlite-vec correctness, sync protocol / conflict resolution, vector clock implementation, memory consolidation, LLM extraction reliability, and snapshot integrity.

## Initial Observations

- ~20 TypeScript source files, compact codebase
- `server.ts` is ~810 lines registering 34 MCP tools — large surface area
- No automated tests
- File operations in `file-store.ts` — path sanitization critical
- Graph store uses sqlite-vec for vector search
- Sync protocol uses vector clocks — complex distributed systems logic

## Bugs Found and Fixed

### `data/` directory not auto-created (High — crash on first run)
- **Location**: `src/mod.ts:34`, `src/graph/store.ts:59`
- **Problem**: Code reads `ENTITY_CORE_DATA_DIR` (default `./data`) but never ensured it existed. SQLite throws `SqliteError: 14: unable to open database file` when the directory is missing.
- **Fix**: Added `await Deno.mkdir(dataDir, { recursive: true })` before `startServer()`

### No `.env` file loading (Medium — confusing DX)
- **Location**: `src/mod.ts` (missing import), `src/llm/client.ts:221-242`
- **Problem**: Unlike Psycheros (which imports `@std/dotenv/load`), entity-core never loaded `.env`. The `.env.example` file told users to "copy to .env" but the app wouldn't read it. Extraction features silently disabled without env vars.
- **Fix**: Added `import "@std/dotenv/load"` to `src/mod.ts` and `"@std/dotenv"` to `deno.json` imports

## Security Fix

### Path traversal in identity tool Zod schemas (Critical)
- **Location**: `src/tools/identity.ts:25-71`
- **Problem**: The `filename` field in 5 identity tool schemas (`IdentityWriteSchema`, `IdentityAppendSchema`, `IdentityPrependSchema`, `IdentityUpdateSectionSchema`, `IdentityDeleteCustomSchema`) accepted any string. An LLM prompt injection attack could pass `../../.env.md` to escape the data directory via MCP tool calls. The delete handler had inline path checks but write/append/prepend/update_section only checked for `.md` extension.
- **Fix**: Created shared `SafeFilenameSchema` with regex `/^[a-zA-Z0-9_-]+\.md$/` — enforces alphanumeric filenames at the Zod schema level. Applied to all 5 identity tool schemas. Inline handler checks remain as defense-in-depth.
- **Why this matters**: This is the most important security pattern in the codebase. Any new identity tools that accept filenames MUST use `SafeFilenameSchema`.

## Confirmed Safe Patterns

- **SQL injection**: All queries in `src/graph/store.ts` use `?` placeholders — no string concatenation
- **LIKE clauses**: User input wrapped as parameters, not string interpolation
- **Memory tool inputs**: `granularity` is Zod enum-validated (only daily/weekly/monthly/yearly/significant); `date` uses regex `/^\d{4}(-\d{2})?(-\d{2})?$/` — no path traversal possible

See also: [security-audit.md](security-audit.md) for the full security assessment.

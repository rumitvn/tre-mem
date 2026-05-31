# Changelog

All notable changes to **tre-mem** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-31

First public release. Branch-aware memory layer over claude-mem with 3-signal
retrieval and an MCP server. Validated live end-to-end on a real multi-branch
Android project; A/B precision@10 lifts from 0.19 (FTS5 baseline) to 0.97
(3-signal rerank) on the tre-mem repo's own memory.

### Added

- **Sidecar SQLite store** at `~/.tre-mem/tre-mem.db` with `branch_tag`,
  `branch_pin`, `graduated`, `branch_state`, `schema_versions` and migrations.
- **Read-only adapter** for `~/.claude-mem/claude-mem.db` via better-sqlite3
  (`readonly: true`, `PRAGMA query_only`). Exposes `getObservations`,
  `getSessionSummaries`, `getPendingMessages`, `fts5SearchObservations`,
  `listProjects`. Auto-detects upstream epoch unit (seconds vs milliseconds).
- **Git branch resolver**: `currentBranch(cwd)` with `(no-git)` and
  `(detached:<sha>)` fallbacks.
- **`.git/HEAD` watcher** (chokidar) that upserts `branch_state` on every
  branch change.
- **Reflog backfill engine**: parses `git reflog show HEAD --date=unix`,
  maps observation epochs to branches, idempotent via PK on
  `branch_tag.observation_id`.
- **3-signal retrieval**: semantic (FTS5/BM25), branch locality, recency
  (3-day half-life decay), with additive pin boost. Pure rerank function with
  weights `{semantic: 0.4, branch: 0.4, recency: 0.2, pin: 1.0}`.
- **MCP server** (`@modelcontextprotocol/sdk` stdio) with 5 tools:
  `get_branch_context`, `get_branch_timeline`, `list_branches`, `pin_fact`,
  `graduate_fact`. Returns both `content[0].text` and `structuredContent` so
  old and new MCP clients both work.
- **SessionStart hook** (`tre hook session-start`) that refreshes
  `branch_state` and emits `additionalContext` summarising project + branch +
  tag counts at the top of every Claude Code session.
- **`tre` CLI** (cac) with `init`, `status`, `backfill`, `search`, `pin`,
  `graduate`, `list-branches`, `hook`, `mcp` commands.
- **A/B benchmark harness** at `scripts/benchmark.mjs` with results in
  [BENCHMARK.md](./BENCHMARK.md).
- **Docs**: README, [CLAUDE.md](./CLAUDE.md) codebase guide,
  [docs/HOOKS.md](./docs/HOOKS.md) hook registration guide,
  [PLAN.md](./PLAN.md) as single source of truth for design + roadmap.

### Notes

- Chroma vector adapter intentionally deferred — `chromadb` v3 npm client
  requires an HTTP server we don't want to bring into MVP. The
  `SemanticSearcher` interface keeps the swap-in point open; `Fts5SemanticSearcher`
  is the default and is the documented fallback per the Risks matrix in PLAN.md.
- Tested with claude-mem schema as of 2026-05-31. Schema sanity check fires
  fast at `tre init` / first adapter open if upstream tables are missing.

[0.1.0]: https://github.com/rumitvn/tre-mem/releases/tag/v0.1.0

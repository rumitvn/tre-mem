# CLAUDE.md — Codebase Guide for Claude Code

> **Always read `PLAN.md` first.** It is the roadmap & status index — current version, what shipped, and the phase-SSOT chain. This file gives Claude orientation; `PLAN.md` gives the work. Current: **v0.11.0**. Phase SSOTs: `docs/plan/PLAN-PHASE2.md` (v0.2–0.4 team share), `docs/plan/PLAN-PHASE3.md` (v0.5 web dashboard), `docs/plan/PLAN-PHASE4.md` (v0.6 cross-tool), `docs/plan/PLAN-PHASE5.md` (v0.7 "share, made obvious"), `docs/plan/PLAN-PHASE6.md` (v0.8–0.9 bamboo identity + the Grove), `docs/plan/PLAN-PHASE7.md` (v0.10 agent-driven export + cross-clone memory), `docs/plan/PLAN-PHASE8.md` (v0.11 forget/correct facts via tombstones + onboarding/banner polish).

## What this project is

**tre-mem** — branch-aware shared memory layer for AI coding tools.

- Tagline: _"Tre — shared roots for your codebase."_
- One-liner: builds _on top of_ claude-mem (read-only) and adds the missing `branch` dimension so AI assistants understand the _feature you're working on_, not just the _repo you're in_.
- Distribution: npm package `tre-mem`, binary command `tre`, MCP stdio server.

## Stack & key decisions

| Area          | Choice                                              | Why                                                                             |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Language      | TypeScript (Node 20+)                               | Match claude-mem ecosystem, official MCP SDK in TS                              |
| Storage       | Sidecar SQLite at `~/.tre-mem/tre-mem.db`           | Read-only adapter on `~/.claude-mem/claude-mem.db`, no schema mutation upstream |
| SQLite driver | `better-sqlite3` (readonly mode)                    | Sync API, WAL-friendly, plays well with claude-mem's worker                     |
| Vector        | reuse `~/.claude-mem/chroma/` via `chromadb` client | Don't re-embed                                                                  |
| MCP           | `@modelcontextprotocol/sdk` (stdio)                 | Standard transport for Claude Code / Cursor / Gemini CLI                        |
| Git           | `simple-git` + `chokidar` on `.git/HEAD`            | Live branch detect + reflog backfill                                            |
| CLI           | `cac`                                               | Lightweight, ergonomic                                                          |
| Tests         | `vitest`                                            | Fast, TS-native                                                                 |

## Architecture (60-second tour)

```
Claude Code / Cursor → MCP stdio → tre-mem server
                                       │
                            ┌──────────┴──────────┐
                            ▼                     ▼
                    Retrieval engine        Git watcher
                    (3-signal rerank)       (.git/HEAD)
                            │                     │
                ┌───────────┴──────┐              │
                ▼                  ▼              ▼
        claude-mem.db        tre-mem.db ◀────────┘
        (READ-ONLY)          (branch_tag,
        observations,         branch_pin,
        FTS5, Chroma)         graduated,
                              branch_state)
```

5 modules: `adapter/` (claude-mem reader), `git/` (watcher + resolver + reflog), `store/` (sidecar DB), `retrieval/` (3-signal), `mcp/` (server + tools), plus `cli/` and `hooks/`.

## Project conventions

### Commits

Format: `<type>(<scope>): T<week>D<day> <subject>`

- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`
- Scopes: `adapter`, `git`, `retrieval`, `mcp`, `cli`, `store`, `hooks`, `meta`
- Examples:
  - `feat(adapter): T1D2 read-only claude-mem.db reader`
  - `feat(retrieval): T2D7 weighted 3-signal rerank with pin boost`
  - `chore(meta): T0D0 initial PLAN.md + CLAUDE.md`

### Files

- 1 concept per file, < 400 lines target, 800 hard cap.
- Tests next to code in `test/<module>.test.ts`.
- No comments unless they explain _why_ something non-obvious.

### Workflow

1. Pick the next unchecked task in `PLAN.md`.
2. Write tests first (per ECC TDD rule), then implementation.
3. Tick the checkbox in `PLAN.md` in the same commit as the code.
4. If a decision changes (scope, stack, schema), append a note to `PLAN.md` § Changelog.

## What NOT to do (MVP guard-rails)

- ❌ Do **not** fork or modify claude-mem internals. Read-only adapter only.
- ❌ Do **not** ALTER TABLE the claude-mem schema. All branch metadata lives in `tre-mem.db`.
- ❌ Do **not** build sync, dashboard UI, or multi-tool ingest before the 2-week MVP ships. See `PLAN.md` § Out of scope.
- ❌ Do **not** re-embed observations or build a parallel vector store. Reuse claude-mem's Chroma.

## Quickstart (once scaffolded)

```bash
pnpm install
pnpm test                    # vitest
pnpm build                   # tsc → dist/
pnpm link --global           # exposes `tre` binary
tre init                     # creates ~/.tre-mem/, runs migrations
tre status                   # sanity check
tre mcp                      # start MCP server (registered in ~/.claude.json)
```

## Pre-push gate (must match CI, or the PR fails)

CI (`.github/workflows/ci.yml`) runs these **in this order** on Node 20 + 22. Run
the same locally before committing/pushing — a failure at any step blocks the PR:

```bash
pnpm format:check            # prettier --check .   ← easy to miss; run pnpm format to fix
pnpm lint                    # eslint .
pnpm typecheck               # tsc --noEmit
pnpm test                    # vitest run
pnpm build                   # tsc → dist/ (+ copy assets)
```

One-liner before pushing:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

> ⚠️ `format:check` covers **all** files including Markdown — editing a README or
> doc can fail CI on formatting alone. Run `pnpm format` to auto-fix, then re-stage.

### Version bumps

Version lives in exactly **two** places, kept in sync: `package.json` `version`
and `src/version.ts` `VERSION`. Update both, add a `CHANGELOG.md` entry, then run
the gate above (the bump changes `tre --version` output asserted nowhere, but the
build must still pass).

## Where things live

- Brand & design system (bamboo green): `docs/BRAND.md` — SSOT for web tokens + terminal colors
- This project: `/Users/rumnv/Documents/tre-mem/`
- Sidecar data: `~/.tre-mem/` (created by `tre init`)
- Upstream data we read: `~/.claude-mem/claude-mem.db`, `~/.claude-mem/chroma/`
- MCP registration: `~/.claude.json` → `mcpServers.tre-mem`

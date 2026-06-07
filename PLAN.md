# tre-mem — Roadmap & Status Index

> Tagline: **"Tre — shared roots for your codebase."**
> Branch-aware, local-first memory layer built _on top of_ claude-mem so AI
> coding tools understand the **feature you're working on**, not just the _repo
> you're in_.

> **This file is the roadmap index — the single entry point for "where is the
> project?"** Each phase has its own SSOT (linked below) with the full
> task-level detail and decision log. Day-to-day orientation lives in
> [CLAUDE.md](./CLAUDE.md); user-facing docs live in [README.md](./README.md).

---

## Current status

**Shipped: v0.10.0** — agent-driven export + cross-clone memory. Covered by
**366 tests**, green on Node 20 + 22. Releases are tracked in
[CHANGELOG.md](./CHANGELOG.md).

| Version    | Theme                                                                     | Phase SSOT                           |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------ |
| **v0.10**  | Agent-driven `export_memory` + cross-clone memory union (by git remote)   | [PLAN-PHASE7.md](./PLAN-PHASE7.md)   |
| **v0.9**   | "The Grove" — contributor graph + leaderboard + full Vietnamese i18n      | [PLAN-PHASE6.md](./PLAN-PHASE6.md)   |
| **v0.8**   | Bamboo-green design identity (web + terminal), `docs/BRAND.md` SSOT       | [PLAN-PHASE6.md](./PLAN-PHASE6.md)   |
| **v0.7**   | "Share, made obvious" — one-command `tre share`, local graduate-on-merge  | [PLAN-PHASE5.md](./PLAN-PHASE5.md)   |
| **v0.6**   | Cross-tool — Codex / Gemini / Cursor / Antigravity via MCP                | [PLAN-PHASE4.md](./PLAN-PHASE4.md)   |
| **v0.5**   | Local team dashboard (`tre web`) — branch graph + team memory, live (SSE) | [PLAN-PHASE3.md](./PLAN-PHASE3.md)   |
| **v0.2–4** | Git-native team share — export/import, redaction, branch graduation       | [PLAN-PHASE2.md](./PLAN-PHASE2.md)   |
| **v0.1**   | Branch-aware retrieval (3-signal rerank) + MCP server                     | Phase 1 (this file, § Phase 1 recap) |

---

## What tre-mem is (and is not)

**The problem.** claude-mem ingests sessions beautifully but indexes them flat
per project — it has no `branch` dimension. Switch from `feature/payment` to
`fix/auth-jwt-expiry` and the assistant still sees Stripe chatter alongside JWT
context.

**The fix.** tre-mem:

1. Watches git `HEAD` (chokidar) and tags every new observation with its branch.
2. Backfills branch for old observations via `git reflog`.
3. Reranks retrieval with **3 signals** — semantic (FTS5/BM25), branch locality,
   and recency-in-branch — plus a `pin` boost (1.0) for curated facts.
4. Exposes it over **MCP** so Claude Code / Cursor / Gemini / Codex / Antigravity
   all see branch-scoped context.
5. Shares curated memory through **plain git** (`tre share`) — no server, no API
   keys, any git host.

**Positioning:** does **not** fork or modify claude-mem. A sidecar SQLite DB
(`~/.tre-mem/tre-mem.db`) read-only over `~/.claude-mem/claude-mem.db`. Never
`ALTER TABLE`s upstream.

---

## Architecture

```
   Claude Code / Cursor / Gemini / Codex / Antigravity
              │ (MCP stdio)
              ▼
   tre-mem MCP server (TS)
              │
   ┌──────────┴──────────────┐
   │  Retrieval engine        │   3-signal rerank
   │  (semantic + branch + recency, + pin boost)
   └──────┬──────────────┬────┘
          │              │
   ┌──────▼─────┐  ┌─────▼────────────┐
   │ tre-mem.db │  │ claude-mem.db     │  ← READ-ONLY (better-sqlite3)
   │ (sidecar)  │  │ observations, FTS5│
   │ branch_tag │  │ session_summaries │
   │ branch_pin │  └───────────────────┘
   │ graduated  │
   │ branch_state (+remote, v3)
   └────────────┘
          ▲
   ┌──────┴───────────┐
   │  Git watcher      │  chokidar on .git/HEAD per repo
   │  + reflog backfill│
   └───────────────────┘
```

**Modules:** `adapter/` (claude-mem reader) · `git/` (watcher + resolver +
reflog + remote) · `store/` (sidecar DB, repo, aliases, migrate) · `retrieval/`
(3-signal + rerank) · `mcp/` (server + tools) · `sync/` (export/import) · `web/`
(dashboard) · `cli/` + `hooks/`.

**Sidecar schema (v3):** `branch_tag`, `branch_pin`, `graduated`, `branch_state`
(with nullable `remote` for cross-clone identity), `schema_versions`. All branch
metadata lives here — upstream claude-mem is read-only.

---

## Stack & key decisions

| Area           | Choice                                   | Why                                                  |
| -------------- | ---------------------------------------- | ---------------------------------------------------- |
| Language       | TypeScript (Node 20+)                    | Match claude-mem ecosystem; official MCP SDK in TS   |
| Storage        | Sidecar SQLite at `~/.tre-mem/`          | Read-only over claude-mem; no upstream schema change |
| SQLite driver  | `better-sqlite3` (readonly mode)         | Sync API, WAL-friendly                               |
| MCP            | `@modelcontextprotocol/sdk` (stdio)      | Standard transport across every harness              |
| Git            | `simple-git` + `chokidar` on `.git/HEAD` | Live branch detect + reflog backfill                 |
| Team transport | plain git (`.tre-mem/` committed files)  | No server / API keys; works on any git host          |
| CLI            | `cac`                                    | Lightweight                                          |
| Tests          | `vitest`                                 | Fast, TS-native                                      |

---

## Phase 1 recap (v0.1 — branch-aware solo)

The original 2-week MVP, shipped as v0.1.0:

- Sidecar store + migrations (`tre init`).
- Read-only claude-mem adapter (better-sqlite3, `readonly: true`).
- Git branch resolver + chokidar watcher; reflog backfill (`tre backfill`).
- 3-signal retrieval (semantic 0.4 / branch 0.4 / recency 0.2, pin boost 1.0)
  with score-breakdown output.
- MCP server (5 tools at the time) + SessionStart hook.
- Benchmark harness: precision@10 **0.19 → 0.97** on the tre-mem repo itself
  (see [BENCHMARK.md](./BENCHMARK.md)).

Everything from v0.2 onward is detailed in the phase SSOTs linked in the status
table above.

---

## Out of scope (for now)

- Hosted / cloud sync — tre-mem stays local-first; git is the transport.
- Encrypted memory for sensitive repos (BYO-key).
- Independent ingest — recording observations is **claude-mem's** job, not ours.
  tre-mem _consumes_ on every harness via MCP; _ingest_ depends on claude-mem
  v13+ ingesting from that tool.

---

## Conventions

- **Commits:** `<type>(<scope>): <subject>` — scopes: `adapter`, `git`,
  `retrieval`, `mcp`, `cli`, `store`, `hooks`, `web`, `sync`, `meta`.
- **Version** lives in exactly two synced places: `package.json` `version` and
  `src/version.ts` `VERSION`. Bump both + add a `CHANGELOG.md` entry.
- **Pre-push gate** (must match CI): `pnpm format:check && pnpm lint &&
pnpm typecheck && pnpm test && pnpm build`.
- A decision that changes scope/stack/schema gets a note in the relevant phase
  SSOT and a `CHANGELOG.md` entry.

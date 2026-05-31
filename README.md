# tre-mem

> *Tre — shared roots for your codebase.*
> Branch-aware memory for [claude-mem](https://github.com/thedotmack/claude-mem),
> so your AI assistant understands the **feature you're working on**, not just
> the repo you're in.

> 🇻🇳 Phiên bản tiếng Việt: [README.vi.md](./README.vi.md)

`tre-mem` is a sidecar to claude-mem. It does **not** fork or modify claude-mem —
it adds a read-only adapter, tags every observation with the git branch it was
authored on, and serves a 3-signal retrieval API (semantic + branch + recency)
over MCP so Claude Code / Cursor / Gemini CLI all see branch-scoped context
instead of flat per-repo memory.

## Why

claude-mem ingests sessions beautifully but indexes them flat per project.
Switch from `feature/payment` to `fix/auth-jwt-expiry` and the assistant still
sees Stripe webhook chatter alongside JWT context. tre-mem fixes that:

- **Live branch tagging** via a chokidar watcher on `.git/HEAD`.
- **History backfill** via `git reflog` so existing observations get a branch.
- **3-signal rerank**: semantic (FTS5/BM25), branch locality, recency-in-branch,
  plus a `pin` boost for facts you want pinned to a branch.
- **MCP server** exposing 5 tools so Claude Code can call branch-aware
  retrieval directly.

On the tre-mem repo itself the rerank lifts precision@10 from **0.19** (raw
FTS5 baseline) to **0.97**. See [BENCHMARK.md](./BENCHMARK.md) for the harness.

## Install

```bash
# 1. Install
npm i -g tre-mem      # or: pnpm add -g tre-mem

# 2. Initialize the sidecar DB at ~/.tre-mem/
tre init

# 3. Backfill branch tags for existing claude-mem observations (per repo)
cd /path/to/your/repo
tre backfill
```

Requirements:
- Node 20+
- claude-mem already installed and ingesting (we read from
  `~/.claude-mem/claude-mem.db`)
- `git` on PATH

## Register the MCP server with Claude Code

The recommended way:

```bash
claude mcp add -s user tre-mem -- tre mcp
```

(or, if you cloned from source and `tre` is not on PATH, point at the built
CLI directly: `claude mcp add -s user tre-mem -- node /abs/path/to/tre-mem/dist/cli.js mcp`)

Verify inside Claude Code with `/mcp`. You should see:

```
tre-mem · connected · 5 tools
```

## Register the SessionStart hook (optional but recommended)

Refreshes `branch_state` whenever Claude Code starts a session, so retrieval
always knows which branch is active even between watcher cycles. See
[docs/HOOKS.md](./docs/HOOKS.md) for the registration snippet and
troubleshooting matrix. Short version: add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "tre hook session-start" }]
      }
    ]
  }
}
```

## CLI surface

```bash
tre init                                # create ~/.tre-mem/ + run migrations
tre status [path]                       # project / branch / tag counts for cwd
tre backfill [path] [--project SLUG]    # tag history via git reflog
tre search "<query>" [--branch B] [--k 10]
tre pin <observation_id> [--note "..."]
tre graduate <observation_id>           # promote branch fact → project-wide
tre list-branches [--project SLUG]
tre hook session-start                  # invoked by Claude Code, reads JSON on stdin
tre mcp                                 # start MCP server (stdio)
```

`tre search` prints top-K with a score breakdown so you can see why each hit
ranked:

```
tre-mem search "stripe webhook"
  project: shop
  branch:  feature/payment
  k:       10 (returned 4)

  [1.800] #938  feat(stripe): retry handler for failed charges
         sem 0.40  branch 0.40  rec 0.20  pin 1.00
  [0.600] #1034 BMOtpTextView keyboard handling
         sem 0.40  branch 0.00  rec 0.20  pin 0.00
  ...
```

## MCP tools

| Tool | Input | Output |
|------|-------|--------|
| `get_branch_context` | `query`, `project?`, `branch?`, `k?` | Top-K observations, rerank breakdown included |
| `get_branch_timeline` | `branch`, `project?`, `limit?` | Chronological feed for a branch |
| `list_branches` | `project?` | Branches with tag counts |
| `pin_fact` | `observation_id`, `branch?`, `note?` | Pin a fact to a branch (boost = 1.0) |
| `graduate_fact` | `observation_id` | Promote a branch fact to project scope |

## Architecture

```
Claude Code / Cursor / Gemini CLI
              │ (MCP stdio)
              ▼
   tre-mem MCP server (TS)
              │
   ┌──────────┴──────────────┐
   │  Retrieval engine        │   3-signal rerank
   │  (semantic + branch + recency)
   └──────┬──────────────┬────┘
          │              │
   ┌──────▼─────┐  ┌─────▼────────────┐
   │ tre-mem.db │  │ claude-mem.db     │  ← READ-ONLY (better-sqlite3)
   │ (sidecar)  │  │ observations, FTS5│
   │ branch_tag │  │ session_summaries │
   │ branch_pin │  └───────────────────┘
   │ graduated  │
   └────────────┘
          ▲
   ┌──────┴───────────┐
   │  Git watcher      │  chokidar on .git/HEAD per repo
   │  + reflog backfill│
   └───────────────────┘
```

Five modules: `adapter/` (claude-mem reader), `git/` (watcher + resolver +
reflog), `store/` (sidecar DB + repo), `retrieval/` (3-signal + rerank),
`mcp/` (server + tools). See [CLAUDE.md](./CLAUDE.md) and [PLAN.md](./PLAN.md)
for the full design.

## Status

MVP — Week 2 retrieval + MCP slice shipped. Live E2E verified on a real
multi-branch project; same query flips top-1 across branches as expected.
[CHANGELOG.md](./CHANGELOG.md) tracks releases.

Out of scope for MVP (deferred to V2):
- Team sync / cloud
- Dashboard UI
- Independent ingest from Cursor / Gemini CLI / Codex
- Auto fact-graduation on PR merge

## License

MIT. See [LICENSE](./LICENSE).

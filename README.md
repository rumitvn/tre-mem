# tre-mem 🎋

[![CI](https://github.com/rumitvn/tre-mem/actions/workflows/ci.yml/badge.svg)](https://github.com/rumitvn/tre-mem/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tre-mem?cacheSeconds=3600)](https://www.npmjs.com/package/tre-mem)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> _Tre — shared roots for your codebase._

> 🇻🇳 Phiên bản tiếng Việt: [README.vi.md](./README.vi.md)

In Vietnamese, **tre** means _bamboo_ — an enduring symbol of resilience,
kinship, and shared roots. A bamboo grove is many stalks rising from one root
system, swaying separately in the wind but standing together through every
storm. The many branches of a codebase grow the same way: each its own
feature, all from one shared history.

```
                  ╲╱           ╲╱           ╲╱
                  ╱╲           ╱╲           ╱╲
                 ╱  ╲         ╱  ╲         ╱  ╲
                 │  │         │  │         │  │
                 ├──┤         ├──┤         ├──┤    ← đốt tre (node)
                 │  │         │  │         │  │
                 ├──┤         ├──┤         ├──┤
                 │  │         │  │         │  │
                 ├──┤         ├──┤         ├──┤
                 │  │         │  │         │  │
              ═══╧══╧═════════╧══╧═════════╧══╧═══
                  ╲      ╲    │    ╱      ╱
                   ╲______╲___│___╱______╱
                      gốc chung · shared roots
                      branches of one codebase
```

That's what `tre-mem` gives your AI assistant: every branch gets its own
voice, while the shared roots of the codebase stay intact. Branch-aware
memory layered on [claude-mem](https://github.com/thedotmack/claude-mem) — so
Claude Code / Cursor / Gemini CLI understand the **feature you're working
on**, not just the repo you're in.

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

## Using it from Claude Code (the everyday path)

You rarely type `tre` by hand. tre-mem registers an MCP server **and** a
SessionStart hook, so the real loop is: **Claude shows you branch context when a
session starts, and you curate by just talking to it.** The CLI further down is
the manual escape hatch.

### What you see when a session starts

With the hook registered, every Claude Code session opens with a branch-scoped
digest (the hook's `systemMessage`, rendered in color in your terminal). When
this shows up, it's working:

```text
[tre-mem] recent context · feature/payment · shop · 4:12pm
Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
tagged: 38 on branch · 232 on project · imported: 1pin/0grad · source: startup

📌 Pinned on this branch
#411 ⚖️ Simulator Mock Features Strategy: File Download and MQTT Playgrounds [shared]
   ↳ why we mock MQTT + downloads instead of hitting staging

#412 🔵 CardApi Endpoints for Student, Deny, and Blackcard List Synchronization
#410 🔵 Simulator Web Infrastructure and API Routing for New Features
```

The `📌 Pinned` block floats curated decisions — and the note explaining _why_ —
to the top. `[shared]` means the pin arrived from a teammate's `git push` and was
auto-imported on this session. `imported: 1pin/0grad` in the stats line confirms
the import happened.

### Curate by talking to Claude, not the CLI

Pinning is deliberate by design — a pin gets a **1.0 search boost** (always top),
so if _everything_ were auto-pinned, nothing would stand out. But you steer it in
plain language via the `pin_fact` / `graduate_fact` MCP tools; Claude can even
write the note for you:

| You say to Claude…                                                   | Claude calls…                                 |
| -------------------------------------------------------------------- | --------------------------------------------- |
| "Pin this decision for the team: we use Stripe webhook v3."          | `pin_fact` (note on the current branch)       |
| "Remember why we chose MQTT over polling — share it with the team."  | `pin_fact` on the key ⚖️ decision             |
| "What's the context on this branch?" / "What did we decide about X?" | `get_branch_context` → ranked, pins on top    |
| "Show me the timeline of this feature so far."                       | `get_branch_timeline`                         |
| "This branch is merged — promote its decisions repo-wide."           | `graduate_fact` (or the merge Action does it) |

Then run `tre share` (one command: export + commit + push) and your teammate
inherits the pin automatically on their next session — surfaced in their digest
with the `[shared]` tag shown above.

## CLI surface

```bash
tre init                                # create ~/.tre-mem/ + run migrations
tre status [path]                       # project / branch / tag counts for cwd
tre backfill [path] [--project SLUG]    # tag history via git reflog
tre search "<query>" [--branch B] [--k 10]
tre pin <observation_id> [--note "..."]
tre graduate <observation_id>           # promote branch fact → project-wide
tre list-branches [--project SLUG]
tre logs [--tail 50 | --all] [--level warn] [--path]  # local diagnostics log
tre mcp                                 # start MCP server (stdio)

# --- team sharing ---
tre share [--branch B | --all] [--message M] [--no-push] [--no-commit]  # push memory to git (one step)
tre export [--branch B | --all] [--force] [--dry-run]   # low-level: write pins → .tre-mem/ only
tre import [--from .tre-mem] [--force]                   # pull a teammate's pins
tre graduate-pr <PR# | branch> [--dry-run]               # graduate a merged branch (any provider)
tre graduate-merge                                       # graduate the just-merged branch (post-merge hook)
tre setup claude-code [--auto-inject] [--with-hook] [--with-action]   # wire hooks (+ graduate hook/CI)
tre hook session-start | user-prompt-submit              # invoked by Claude Code
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

| Tool                  | Input                                | Output                                        |
| --------------------- | ------------------------------------ | --------------------------------------------- |
| `get_branch_context`  | `query`, `project?`, `branch?`, `k?` | Top-K observations, rerank breakdown included |
| `get_branch_timeline` | `branch`, `project?`, `limit?`       | Chronological feed for a branch               |
| `list_branches`       | `project?`                           | Branches with tag counts                      |
| `pin_fact`            | `observation_id`, `branch?`, `note?` | Pin a fact to a branch (boost = 1.0)          |
| `graduate_fact`       | `observation_id`                     | Promote a branch fact to project scope        |

## Diagnostics log

tre-mem writes a small append-only JSONL log to `~/.tre-mem/tre-mem.log` so you can
see what it did on a machine and share it for troubleshooting. It records **counts and
metadata only** — branch/project names, event counts, ids, durations, and error
class+message. It never logs raw query text, prompt text, or pin/note bodies, so the
file is safe to hand off.

```bash
tre logs                 # last 50 lines of JSONL
tre logs --all           # whole file (good for collecting end-of-day)
tre logs --level warn    # only warnings + errors
tre logs --component mcp # only MCP events
tre logs --path          # print the file path (e.g. to cat / copy it)
tre logs --clear         # truncate the log (and remove the rotated .1 backup)
```

Each line looks like:

```json
{
  "ts": "2026-06-04T09:12:03.144Z",
  "t": 1780989123144,
  "level": "info",
  "component": "hook",
  "event": "session_start",
  "fields": {
    "project": "shop",
    "branch": "feature/payment",
    "tagged_branch": 12,
    "imported_pins": 2,
    "ms": 31
  }
}
```

| Env var             | Default                      | Meaning                                  |
| ------------------- | ---------------------------- | ---------------------------------------- |
| `TRE_MEM_LOG`       | enabled                      | set `0`/`false`/`off` to disable logging |
| `TRE_MEM_LOG_LEVEL` | `info`                       | min level: `debug`/`info`/`warn`/`error` |
| `TRE_MEM_LOG_FILE`  | `<TRE_MEM_HOME>/tre-mem.log` | absolute path override                   |

The file rotates to `tre-mem.log.1` once it passes 5 MB, so it never grows unbounded.

## Team memory — push your memory to git (the headline feature)

This is what tre-mem is _for_. Pin a decision, run **one command**, and it's in
your team's git. Your teammate runs `git pull` and their AI already knows — Claude
Code, Codex, Gemini, Cursor, whatever they use. **No server, no API keys, and no
GitHub required**: GitHub, GitLab, Bitbucket, or a plain bare remote — if it's
git, it works.

```
   alice@laptop                          bob@laptop
   ~/.tre-mem/  (private sidecar)         ~/.tre-mem/  (private sidecar)
        │ tre share                             ▲ tre import (auto on SessionStart)
        ▼                                       │
   repo/.tre-mem/  ── git push ── git pull ── repo/.tre-mem/
        (merge=union: two sharers never conflict — git keeps both)
```

```bash
# alice, on feature/payment
tre pin 1234 --note "use Stripe webhook v3"
tre share                                # export + git add + commit + push — one step

# bob
git pull                                 # tre import runs automatically on his next session
#   → his AI now surfaces alice's pin, tagged [shared]
```

That's the whole loop. `tre share` writes your curated facts to `.tre-mem/`,
commits, and pushes; if the branch has no upstream it prints the exact
`git push -u …`. (`tre export` is still the low-level "write files only"
primitive if you'd rather drive git yourself.)

Key properties:

- **One command, any git host.** `tre share` is plain git underneath — works with
  GitHub, GitLab, Bitbucket, or a bare remote. Nothing is provider-locked.
- **Only pins + graduated facts are shared.** Raw observations stay private in
  each developer's `~/.claude-mem/`.
- **Fail-closed redaction.** Sharing refuses to write detected secrets
  (private keys, API tokens, JWTs…) unless you pass `--force` (which replaces
  them with `[REDACTED:*]`). Per-repo `.tre-mem/.shareignore` adds globs.
- **"Keep both" conflicts.** `.tre-mem/.gitattributes` sets `*.jsonl merge=union`,
  so two teammates sharing at once never hit a merge conflict — git keeps both
  sides and `tre import` de-dupes on read.
- **Graduate on merge, no CI required.** `tre setup … --with-hook` installs a local
  `post-merge` git hook that promotes a merged branch's pins to repo-wide facts —
  on any provider. CI snippets (GitLab/Bitbucket) and an optional GitHub Action are
  also supported.

Full guide: [docs/TEAM-WORKFLOW.md](./docs/TEAM-WORKFLOW.md). Upgrading from
v0.1 is automatic — see [docs/MIGRATION-v1-v2.md](./docs/MIGRATION-v1-v2.md).

## See it — the team dashboard (v0.5)

Phase 2 made memory travel through git; **v0.5 lets your team _see_ it.** Run
`tre web` for a local, read-only dashboard of the branch graph, pinned decisions,
graduated facts, and what's not shared yet — updating live as the repo and sidecar
change. No account, no cloud; binds `127.0.0.1` only.

```bash
tre web                 # start + open the browser (Ctrl-C to stop)
tre web --background    # run detached; manage with `tre web status` / `tre web stop`
```

- **Branch graph** — every branch with tagged-count, pins, last-active, current `HEAD`.
- **Team memory** — who pinned what and why, plus graduated facts, with a
  `shared via git ✓` / `not shared yet` marker.
- **Search** — branch-aware, with a per-signal score breakdown.
- **Live** — reacts to branch switches, teammate `git pull` / `tre import`, and
  pins written from another terminal (SSE).

Works even **without claude-mem** (shared-memory-only mode: pins + graduated from
the sidecar/`.tre-mem/`, substring search). Full guide:
[docs/WEB-UI.md](./docs/WEB-UI.md).

## Beyond Claude Code — cross-tool (v0.6)

tre-mem speaks **MCP**, so the git-shared team memory travels to every major
harness. Wire them all at once:

```bash
tre setup --all                # claude-code (repo) + every installed harness
tre setup --all --auto-inject  # also wire per-prompt context injection
```

Or one at a time: `tre setup codex` · `codex-desktop` · `gemini` · `cursor` ·
`antigravity`. Each registers tre-mem's MCP server (and, for Codex/Gemini,
SessionStart + opt-in prompt hooks) — idempotent and non-clobbering.

**Two layers:** _consume_ (team memory + branch ranking) works on every harness
via tre-mem's MCP; _ingest_ (recording observations) is **claude-mem's** job, and
claude-mem v13+ ingests from Claude Code, Codex, Gemini, Cursor, and Antigravity
into one shared DB. So full branch-aware search is available wherever claude-mem
is installed + ingesting — run `tre doctor` to see this machine's mode
(`full` / `shared-only`) and ingest health. Full guide:
[docs/CROSS-TOOL.md](./docs/CROSS-TOOL.md).

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

**v0.2 — team-shared memory via git.** Phase 1 (branch-aware retrieval + MCP)
and Phase 2 (export/import, redaction, graduate-on-merge, retrieval-v2, hooks)
are shipped and covered by 165 tests. The two-dev sync path is verified
end-to-end through a real git remote in `scripts/two-dev-e2e.sh`.
[CHANGELOG.md](./CHANGELOG.md) tracks releases.

Out of scope (deferred to V3):

- GitLab / Bitbucket equivalents of the graduate Action
- Dashboard / memory observability UI
- Full independent ingest from Cursor / Gemini CLI / Codex (`tre setup` stubs exist)
- Encrypted memory for sensitive repos (BYO-key)

## License

MIT. See [LICENSE](./LICENSE).

---

🎋 _Made with care, from the bamboo grove. Cảm ơn bạn đã ghé thăm._

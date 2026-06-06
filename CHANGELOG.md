# Changelog

All notable changes to **tre-mem** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] — 2026-06-07

**The Grove — a second-brain contributor graph for your repo's memory.** A new
`tre web` tab visualizes the team's shared knowledge as an Obsidian-style force
graph (trunk + branches + contributors + facts) and ranks who grew it.

### Added

- **Grove tab** in the dashboard: an interactive `d3-force` + canvas graph of the
  repo's shared memory. The project trunk (`root`), each branch, each contributor,
  and each fact (pins = young shoots, graduated facts = mature culms) are nodes;
  edges wire authorship, where a fact lives, and how branches graduate into the
  trunk. Bamboo palette driven by the existing theme tokens (light/dark aware).
  Hover for a tooltip; click a branch/fact to drill into Branch detail, click a
  contributor to highlight their shoots.
- **Contributor leaderboard** with a weighted value score (branch-local pins ×1,
  graduated/rooted facts ×3) plus playful badges & streaks — Gardener of the week,
  Most rooted, Longest streak, First sprout.
- **Shareable grove card**: one click exports a bamboo-framed PNG of your grove's
  headline stats — the viral, post-it-anywhere artifact.
- **Growth time-lapse**: scrub or play back how the grove grew over time.
- **Solo/unshared fallback**: when nothing has been shared yet, the grove backfills
  contributors from `git log` authors per branch (flagged as `git-fallback`) so a
  fresh repo is never empty. Toggle with `?fallback=` on the new endpoints.
- New read-only endpoints `GET /api/contributors` and `GET /api/graph`
  (project-scoped), plus a read-only `.tre-mem/` JSONL reader (`src/sync/read.ts`)
  — contributor attribution lives in the committed JSONL `author` field, so no
  schema migration was needed.

## [0.7.1] — 2026-06-06

**Removed the GitHub Action — graduation is now fully vendor-neutral.** The
provider-locked CI path was at odds with tre-mem's git-native, any-host design.

### Removed

- Deleted the `graduate-on-merge` GitHub composite action and the `--with-action`
  flag / workflow scaffold from `tre setup`. Graduation is now **only** git-native:
  the local `post-merge` hook (`tre setup … --with-hook` → `tre graduate-merge`), or
  a few lines of CI (GitLab/Bitbucket/any runner) calling `tre graduate-pr`. Docs
  updated accordingly.

## [0.7.0] — 2026-06-06

**Share, made obvious.** Team memory is tre-mem's headline feature, so v0.7 makes
_"push your memory to your git"_ a single, legible command that works with any git
host — no CI, no GitHub lock-in.

### Added

- **`tre share`** — one command that exports your pins + graduated facts, then
  `git add .tre-mem` + commit + push. Flags: `--branch`/`--all`, `--message`,
  `--no-push`, `--no-commit`, `--dry-run`. Degrades honestly: commits even when a
  branch has no upstream (and prints the exact `git push -u …`), and never crashes
  on a failed push. Works on GitHub, GitLab, Bitbucket, or a bare remote — plain
  git only. `tre export` remains as the low-level "write files only" primitive.
- **Claude-mem-optional sharing.** `tre share` / `tre export` no longer require
  claude-mem — when it's absent, each pin falls back to its stored title/body, so a
  teammate on Codex/Gemini/Cursor can still share.
- **`.tre-mem/.gitattributes` (`*.jsonl merge=union`)** scaffolded automatically
  (and backfilled on `tre share` for older repos): two teammates sharing at once
  "keep both" instead of hitting a merge conflict; `tre import` de-dupes on read.
- **Dashboard auto-start on session start.** The SessionStart hook now launches the
  `tre web` dashboard in the background (a single global daemon shared by every
  project) and prints the live link in the digest (`📊 dashboard live → …`), like
  claude-mem. Opt out with `TRE_MEM_WEB_AUTOSTART=0`; skipped in CI/tests.
- **CI-free, provider-agnostic graduation.** `tre graduate-merge` recovers the
  just-merged branch from the merge commit and graduates its pins — wired by
  `tre setup … --with-hook`, which installs a local `post-merge` git hook (any
  provider, no CI). `tre graduate-pr` now resolves the branch from `--branch`, then
  `gh`, then CI env (`GITHUB_HEAD_REF` / `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` /
  `BITBUCKET_BRANCH` / …) — no hard GitHub dependency.

### Changed

- **Legibility.** Unified the vocabulary to "share". `tre status`, the web Team
  Memory / Overview views, and the docs no longer show the unexplained
  "pending export" — pins read `not shared yet` / `shared via git ✓`, and every
  unshared state prints the exact command to run.
- **Docs.** `docs/TEAM-WORKFLOW.md` and the README lead with the one-command loop,
  document the local hook + generic GitLab/Bitbucket CI snippets, and reframe the
  GitHub Action as one optional path among several.

## [0.6.0] — 2026-06-05

**Cross-tool: tre-mem now works beyond Claude Code.** It speaks MCP — the
protocol every major AI coding harness shares — so the git-shared team memory is
portable. `tre setup <tool>` wires tre-mem into Codex CLI, Codex Desktop, Gemini
CLI, Cursor, and Antigravity, and claude-mem is no longer required to run.

### Added

- **`tre setup`** for **Codex CLI/Desktop** (`~/.codex/config.toml`), **Gemini CLI**
  (`~/.gemini/settings.json`), **Cursor** (`~/.cursor/mcp.json`), and **Antigravity**
  (`~/.gemini/antigravity[-cli]/mcp_config.json`). All idempotent, non-clobbering,
  and env-aware (`CODEX_HOME` / `GEMINI_HOME` / `CURSOR_HOME`).
- **`tre setup --all`** — detect every installed harness and wire each (plus
  claude-code for the current repo). `tre status` now shows a per-tool wiring line.
- **Lifecycle hooks for Codex + Gemini** (SessionStart always; per-prompt inject
  with `--auto-inject` → Codex `UserPromptSubmit`, Gemini `BeforeModel`). New
  `tre hook <event> --format=claude|codex|gemini` emits each harness's envelope
  (Codex matches Claude's `hookSpecificOutput.{hookEventName,additionalContext}`;
  Gemini omits `hookEventName`).
- **`tre doctor` ingest health** — reports `mode: full | shared-only` and whether
  claude-mem is actually ingesting (`active` / `stale` / none), since an installed
  claude-mem DB can still be empty on a given machine.

### Changed

- **claude-mem is now optional.** The MCP server and search degrade to
  **shared-memory-only mode** (pins + graduated from the sidecar / `.tre-mem/`)
  instead of refusing to start. `ToolDeps.adapter` / `SearchDeps.adapter` are
  nullable; the MCP server logs a one-line notice rather than exiting.

### Notes

- **Honest model:** _consume_ (team memory + branch ranking) works on every harness
  via tre-mem's MCP; _ingest_ is claude-mem's job, and claude-mem (v13+) ingests
  from Claude Code, Codex, Gemini, Cursor, and Antigravity into one shared DB — so
  full search is available wherever claude-mem is installed + ingesting (per-machine,
  not Claude-Code-only). See [docs/CROSS-TOOL.md](./docs/CROSS-TOOL.md).
- Antigravity is inject-only over MCP (its lifecycle hooks are a Python SDK, not
  declarative config). It has no native memory, making tre-mem a natural fit.

## [0.5.0] — 2026-06-04

**`tre web` — a local dashboard for your team's shared roots.** Phase 2 made AI
memory travel through git; this release lets the whole team _see_ it. Run
`tre web` and a localhost dashboard shows the branch graph, every pinned decision,
the facts that graduated repo-wide, and what's pending export — reading straight
from the sidecar + the committed `.tre-mem/`, and updating live as the repo and
sidecar change. Read-only, local-only, no account, no cloud.

### Added

- **`tre web [start|stop|status]`** — starts a local, read-only dashboard
  (foreground or `--background` daemon with a self-healing pidfile under
  `~/.tre-mem/`). Port defaults to `TRE_MEM_WEB_PORT` or `38700 + (uid % 100)`
  and walks forward if busy; auto-opens the browser (disable with `--no-open`).
- **Dashboard views** — Overview with a **branch-graph** hero (tag counts, pins,
  last-active, current `HEAD`), per-branch detail (pins + graduated + tagged
  activity), a **Team-memory** view (pinned decisions and graduated facts with
  branch + shared/pending state), and a branch-aware **Search** with a per-signal
  score breakdown (semantic / branch / recency / graduated / pin).
- **Live updates over SSE** — the page reacts to branch switches (`.git/HEAD`),
  teammate memory landing (`.tre-mem/` changes), and sidecar writes from another
  terminal, without a manual refresh.
- **Shared-memory-only mode** — the dashboard (and its API) render fully even when
  claude-mem is not installed: pins + graduated come from the sidecar/`.tre-mem/`,
  and Search degrades to a substring match over those self-contained snapshots.
  This is also groundwork for the v0.6 cross-tool port.
- **Frontend pipeline** — a React SPA bundled with esbuild to a static
  `dist/web/public` (~65 kb gzipped), served by a dependency-light `node:http`
  server (no Express). Build via `pnpm build` (or `pnpm build:web`).

### Notes

- The dashboard binds `127.0.0.1` and is read-only. Observation _ingest_ remains
  claude-mem's job; tre-mem visualizes the branch-aware + git-shared layer on top.
- Playwright visual-regression smoke is deferred (kept out of CI to stay lean);
  the server/API/SSE/watch paths have unit + integration coverage.

## [0.4.0] — 2026-06-04

**Curated pins now surface in the session digest, and `tre export` explains
itself when there's nothing to share.** Field feedback showed two gaps: an export
that added 0 rows gave no reason (the common cause is "lots of branch tags, but
nothing pinned"), and a pin's `--note` — the "why this matters" — was never shown
back to anyone, including teammates who imported it.

### Added

- **`📌 Pinned on this branch` block in the SessionStart digest.** Curated pins
  float above the recent list with their type icon, title, the attached **note**
  (`↳ …`), and a `[shared]` marker once the pin has been exported/imported. Works
  from the pin's own snapshot, so a teammate's shared pin renders even without
  claude-mem or the source observation locally. Shown in both the colored
  terminal display and the plain text the model reads.
- **Empty-export guidance.** When `tre export` adds 0 rows it now explains why and
  what to do — distinguishing "nothing pinned anywhere" (with `tre pin` /
  `tre graduate` / `pin_fact` next steps), "pins live on other branches" (suggests
  `--all`), and "everything already exported".
- **README "Using it from Claude Code" section** (EN + VI): example natural-language
  prompts that drive `pin_fact` / `graduate_fact` / `get_branch_context`, plus a
  sample session-start digest so users can recognize it's working.

### Changed

- **`tre status`** nudges toward curation when nothing is pinned yet, instead of
  reporting a bare `0 pin(s) exported` and an unconditional "run `tre export`".

## [0.3.2] — 2026-06-04

**First-run guidance, a claude-mem compatibility guard, and a colored session
digest.** Feedback from device installs surfaced three rough edges: nothing told
first-time users that claude-mem must be installed, there was no guard against a
breaking claude-mem upgrade, and the session output was a single plain line.

### Added

- **Onboarding guidance.** When claude-mem isn't installed, `tre status`,
  `tre init`, `tre backfill`, `tre search`, and `tre export` now print friendly,
  actionable setup steps instead of a cryptic error or a raw stack trace.
- **`tre doctor`** — diagnoses claude-mem connectivity (install state, schema
  version, compatibility) and tre-mem setup in one command; exits non-zero when
  something needs attention.
- **Colored SessionStart digest.** The hook now emits a bold/colored block
  (header, legend, stats, and a short list of recent branch-tagged observations)
  as the display `systemMessage`, while the model-facing `additionalContext`
  stays plain ASCII. Degrades gracefully — a missing claude-mem never blocks a
  session.

### Changed

- **claude-mem compatibility guard.** The adapter now verifies the exact
  `observations` columns it reads (hard error with the precise missing column if
  claude-mem's schema breaks) and records claude-mem's `schema_versions` version.
  A newer-than-tested schema (tested up to **v32**) keeps working but logs a
  non-fatal upgrade hint. The MCP server now fails with clear guidance instead of
  the opaque `setup issue: MCP`.

[0.3.2]: https://github.com/rumitvn/tre-mem/releases/tag/v0.3.2

## [0.3.1] — 2026-06-04

### Fixed

- **`tre status` crash on upgraded databases** (`SqliteError: no such column:
title`). Databases that recorded `schema_versions = 2` under an earlier build —
  before the `title`/`body` snapshot columns were added to the v2 set — were never
  topped up, because the `currentVersion < 2` gate skipped the additive DDL. The
  v2 column reconciliation now runs **unconditionally and idempotently** on every
  `migrate()`, self-healing affected `branch_pin`/`graduated` tables in place
  (no version bump, no data loss). Fixes `tre status`, `tre export`, and any path
  that reads pin/graduated snapshots. Just upgrade — the next `tre` command repairs
  the database automatically.

[0.3.1]: https://github.com/rumitvn/tre-mem/releases/tag/v0.3.1

## [0.3.0] — 2026-06-04

**Local diagnostics log.** tre-mem now records its own runtime events to a
quick, append-only JSONL file so you can collect real-world signal from a
device and paste it to an AI for product insight — no UI, no telemetry server.

### Added

- **Append-only JSONL log** at `~/.tre-mem/tre-mem.log` (one event per line:
  `ts`, `t`, `level`, `component`, `event`, `fields`). Writes **only to a file**
  (hooks keep stdout clean), **never throws** (a logging failure can't break a
  hook, the MCP server, or any command), and rotates to `tre-mem.log.1` at 5 MB.
- **`tre logs`** — `--tail <n>` / `--all` / `--level <lvl>` / `--component <name>`
  / `--path` / `--clear`. The end-of-day collection command.
- **Instrumented events** across hooks (`session_start`, `prompt_inject`,
  `session_import_failed`, `hook_error`), `backfill`, sync (`export`, `import`,
  `graduate_pr`, `export_redaction_blocked`), and the MCP server
  (`server_start`/`server_stop`, `tool_call`, `tool_error`), plus `cli_error`.
- **Env contract** — `TRE_MEM_LOG=0` to disable, `TRE_MEM_LOG_LEVEL` (default
  `info`), `TRE_MEM_LOG_FILE` to override the path.

### Notes

- **Privacy by design:** the log carries counts + metadata only (branch/project
  names, ids, durations, error class+message). It **never** logs raw query text,
  prompt text, or pin/note bodies — consistent with the fail-closed export
  redaction, so the file is safe to share.

[0.3.0]: https://github.com/rumitvn/tre-mem/releases/tag/v0.3.0

## [0.2.0] — 2026-06-04

**"Git for AI memory."** Phase 2 makes tre-mem team-shared: pin a decision on a
branch, `git push`, and your teammate's Claude Code inherits it. No server, no
API keys — the git workflow itself is the transport. Branch-awareness (0.1) +
team-share (0.2) is a combination no competitor has.

### Added

- **Committed `.tre-mem/` sync directory** (JSONL, append-only, human-readable
  diffs). Format spec frozen in [docs/SYNC-FORMAT.md](./docs/SYNC-FORMAT.md);
  versioned `schema` field; content-hash dedupe so two devs converge without
  real conflicts.
- **`tre export`** — writes pins to `branches/<slug>.jsonl` + graduated facts to
  `graduated.jsonl`, snapshotting observation title/body so receiving devs are
  self-contained. Idempotent, merge-safe, marks pins shared.
- **`tre import`** — pulls a teammate's `.tre-mem/` into the local sidecar,
  deduped on content-hash, idempotent via `import_state` file-SHA tracking.
- **Redaction guard** — `tre export` is **fail-closed**: an 8-rule secret pack
  (private keys, OpenAI/Anthropic/AWS/GitHub/Google/Slack keys, JWTs) blocks the
  write with a masked report unless `--force` (which replaces matches with
  `[REDACTED:*]`). Per-repo `.tre-mem/.shareignore` glob blocklist.
- **Auto-lifecycle** — `tre graduate-pr <PR#|branch>` promotes a merged branch's
  pins to repo-wide graduated facts; composite GitHub Action
  [`actions/graduate-on-merge`](./actions/graduate-on-merge) runs it on merge.
- **Retrieval v2** — graduated facts are a first-class signal (weight 0.3), and
  **shared pins/graduated surface from their JSONL snapshot even when the local
  claude-mem lacks the observation**. Free-text pins surface too;
  `SearchHit.source` distinguishes `observation` / `shared-pin` / `graduated`.
- **SessionStart hook v2** auto-imports `.tre-mem/` on every session (silent,
  idempotent). Optional **UserPromptSubmit** hook injects branch-scoped memory
  into prompts (opt-in via `tre setup claude-code --auto-inject`).
- **`tre setup <tool>`** — idempotently wires Claude Code hooks (and optionally
  the graduate workflow); `cursor`/`codex` stubbed for V3.
- **`tre status` v2** — shared/pending/graduated counts + `.tre-mem/` presence.
- **Schema v2 migration** — additive `content_hash` / `shared_at_epoch` /
  `title` / `body` columns + `import_state` table; upgrades populated v0.1 DBs
  with no data loss. See [docs/MIGRATION-v1-v2.md](./docs/MIGRATION-v1-v2.md).
- **Two-dev E2E** at `scripts/two-dev-e2e.sh` — drives export → git push → clone
  → import → search through a real bare remote and two isolated sidecars.

### Notes

- Migration is additive-only and idempotent; v0.1 users upgrade transparently on
  first `tre` invocation.
- Raw observations stay private — only pins + graduated facts enter `.tre-mem/`.

[0.2.0]: https://github.com/rumitvn/tre-mem/releases/tag/v0.2.0

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

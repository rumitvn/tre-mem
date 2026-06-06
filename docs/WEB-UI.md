# tre web — the team memory dashboard

`tre web` starts a small, **read-only**, **localhost-only** dashboard that makes
your team's git-shared memory legible: the branch graph, pinned decisions,
graduated facts, and what's still pending export — updating live as the repo and
the sidecar change.

It visualizes the layer tre-mem owns (branch-aware + git-shared). Raw observation
_ingest_ stays claude-mem's job; the dashboard reads the sidecar
(`~/.tre-mem/tre-mem.db`) and the committed `.tre-mem/` JSONL.

## Quick start

```bash
tre web                 # start in the foreground, open the browser, Ctrl-C to stop
tre web --background    # run detached (daemon); manage with status/stop
tre web status          # is it running? on which port?
tre web stop            # stop the background daemon
tre web --no-open       # don't auto-open the browser
tre web --port 39000    # pin a specific port
```

Build the bundled UI first if you're running from source: `pnpm build` (or
`pnpm build:web` to only rebuild the SPA into `dist/web/public`).

## Auto-start on session start

When the SessionStart hook runs (any wired harness), tre-mem **auto-starts the
dashboard in the background** if it isn't already up, and prints the live link in
the session digest:

```
📊 dashboard live → http://127.0.0.1:38700/
```

It's a single global daemon (one `~/.tre-mem/web.pid`) shared by every project, so
this is a fast no-op once it's running. To turn it off, set
`TRE_MEM_WEB_AUTOSTART=0`. It's also skipped automatically in CI and test runs.

## Port

Default is `TRE_MEM_WEB_PORT` if set, otherwise `38700 + (uid % 100)` — a
per-user port outside claude-mem's `37700` band. If that port is busy, tre-mem
walks forward to the next free one. The background daemon records its pid + port
in `~/.tre-mem/web.pid` (self-healing: a stale pidfile is cleared automatically).

## Views

- **Overview** — a branch graph: every branch with its tagged-observation count,
  pin count, last-active time, and the current `HEAD` highlighted. Click a branch
  to drill in.
- **Grove** — the second-brain view: an Obsidian-style force graph of the repo's
  shared memory (the project trunk + branches + contributors + facts) beside a
  contributor leaderboard. Facts are sized as young shoots (pins) and mature culms
  (graduated facts); contributor node size tracks their value score (pins ×1,
  graduated ×3). Earns playful badges (Gardener of the week, Most rooted, Longest
  streak, First sprout), exports a shareable PNG card, and replays grove growth
  over time. Hover for tooltips; click a branch/fact to drill into **Branch
  detail**, click a contributor to highlight their shoots. When nothing has been
  shared yet, it falls back to `git log` authors so the grove is never empty.
- **Branch detail** — pinned decisions, facts graduated from that branch, and the
  tagged activity timeline.
- **Team memory** — the point of the dashboard: every pinned decision and
  graduated fact across branches, each with its branch context and a
  `shared` / `pending export` marker.
- **Search** — branch-aware retrieval with a per-signal score breakdown
  (semantic · branch · recency · graduated · pin) and a source badge
  (observation / shared-pin / graduated).

## Live updates

The page subscribes to a Server-Sent-Events stream (`/api/events`) and refetches
when:

- you switch branches (`.git/HEAD` changes),
- a teammate's memory lands (`.tre-mem/` changes after `git pull` / `tre import`),
- a pin/graduation is written from another terminal (sidecar poll).

## Without claude-mem (shared-memory-only mode)

If claude-mem isn't installed, the dashboard still works: branches, pins, and
graduated facts come from the sidecar + `.tre-mem/`, and Search degrades to a
substring match over those self-contained snapshots. The header shows a
`shared-only` badge. (Install claude-mem to get full FTS5 semantic search and the
observation timeline.)

## API (read-only)

The SPA is served over a dependency-light `node:http` server. Endpoints, all
`GET`, all returning JSON:

| Route                    | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `/api/health`            | version, mode (`full` / `shared-only`), project |
| `/api/projects`          | known projects + the launched one               |
| `/api/branches`          | branch graph (counts, pins, last-active)        |
| `/api/branch/:branch`    | timeline + pins + graduated for a branch        |
| `/api/pins`              | all pins for the project                        |
| `/api/graduated`         | all graduated facts for the project             |
| `/api/share-status`      | pending export / shared / graduated counts      |
| `/api/contributors`      | contributor leaderboard (value score + badges)  |
| `/api/graph`             | force-graph nodes + edges for the Grove view    |
| `/api/search?q=&branch=` | branch-aware search (full or degraded)          |
| `/api/observation/:id`   | observation detail (`full` mode only)           |
| `/api/events`            | SSE live-update stream                          |

All routes accept `?project=` to scope to a project other than the one the server
was launched in.

## Security

The server binds `127.0.0.1` only and is read-only. Static serving is guarded
against path traversal. There is no authentication because there is no remote
surface — it is a local developer tool, like claude-mem's viewer.

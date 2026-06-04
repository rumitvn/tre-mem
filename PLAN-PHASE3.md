# tre-mem Phase 3 — "See your shared roots" (Team Web Dashboard)

> Sibling plan to [`PLAN.md`](./PLAN.md) (Phase 1 SSOT, v0.1.0) and [`PLAN-PHASE2.md`](./PLAN-PHASE2.md) (Phase 2 SSOT, v0.2.0).
> This file is the **Phase 3 SSOT** (v0.5.x). Status: **planned** — not yet started. Tick `- [x]` per task and commit with the code, same as prior phases.

## Context

Phase 1 (v0.1.x) shipped solo branch-aware retrieval. Phase 2 (v0.2–v0.4.x) shipped git-native team
sharing: `tre export`/`import`, `.tre-mem/*.jsonl`, graduate-on-merge Action, pinned-digest in the
session hook. Current version is **0.4.0**, all gates green.

**The gap:** individual dev UX is good, but **team-shared memory is invisible**. It lives in JSONL
files + a sidecar SQLite DB that nobody _sees_. A teammate can't easily answer: "what has my team
pinned on `feature/payment`? who decided it and why? what graduated to repo-wide?" claude-mem solves
the _observation-viewer_ problem with a local web dashboard (`http://localhost:377xx`, Express +
React SPA + SSE off SQLite). tre-mem needs the equivalent — but aimed at its **unique** data: the
**git-shared team memory** (branch map, pins + notes + authors, graduated facts, export/import
state), **not** raw observations (that remains claude-mem's job).

**Decisions locked with user:**

- **0.5.x = web UI first.** Cross-tool port → **0.6.x** ([`PLAN-PHASE4.md`](./PLAN-PHASE4.md)).
- **Shape = full live dashboard**, claude-mem-style: background daemon + React SPA + SSE live updates.
- **"Live" = team-memory changes** (teammate `git pull`/import landing, new pins/graduations, branch
  switches) — NOT a raw observation stream (tre-mem does not ingest observations).
- **Read-only** for 0.5.0 ("see and view"); UI write-actions are a scoped stretch, off the critical path.
- **Lean stack:** `node:http` (not Express) to keep the "local-first, server-free" ethos; React +
  esbuild as **devDependencies only** → static bundle in `dist/web/`.
- **claude-mem adapter is OPTIONAL here** — dashboard renders fully from sidecar + `.tre-mem/` even
  when claude-mem is absent. Deliberate groundwork for the 0.6.x cross-tool decoupling.

---

## The Phase 3 Story (positioning)

> "Phase 2 made your AI memory travel through git. Phase 3 lets your whole team _see_ it. Run
> `tre web` and watch the shared roots: every branch, every pinned decision and who made it, every
> fact that graduated to repo-wide knowledge — updating live the moment a teammate pushes or you pin.
> No cloud, no account, no central server. Just `localhost`."

What the dashboard shows that no competitor does: **the team's git-shared memory as a first-class
view** — branch-scoped pins with author + note, graduation lineage, and "what's pending export" — all
read straight from the committed `.tre-mem/` + the sidecar. claude-mem shows _your_ observations;
tre-mem shows _the team's decisions_.

vs. the field:
| Tool | Local viewer | Team-shared view | Branch map | Git-sourced authorship | Server-free |
|------|:-:|:-:|:-:|:-:|:-:|
| claude-mem viewer | ✅ (observations) | ❌ | ❌ | ❌ | ✅ |
| mem0 / Letta dashboards | cloud | ✅ | ❌ | ❌ | ❌ |
| Lore web UI | self-host | ✅ | ❌ | ❌ | ❌ (Postgres + server) |
| **tre-mem v0.5** | **✅** | **✅ (from git)** | **✅** | **✅** | **✅** |

---

## Architecture changes from v0.4 (additive — Phase 1/2 untouched)

```
   browser ◀── SSE ──┐
        │ fetch /api │
        ▼            │
   tre web daemon (node:http, read-only, 127.0.0.1)
   ┌──────────────────────────────────────┐
   │ src/web/server.ts  router + static     │
   │ src/web/api.ts     JSON route handlers  │
   │ src/web/sse.ts     event broadcaster    │
   │ src/web/watch.ts   chokidar → events    │
   └───────┬───────────────┬────────────┬───┘
           ▼               ▼            ▼
   TreMemRepo        ClaudeMemAdapter   repo/.tre-mem/*.jsonl
   (sidecar DB)      (OPTIONAL — may    (git-shared, authored)
   pins/grad/branch    be absent)
```

**New module surface:**

- `src/web/server.ts` — node:http server, tiny router, static-asset serving from `dist/web/`.
- `src/web/api.ts` — read-only JSON route handlers (thin wrappers over existing read methods).
- `src/web/sse.ts` — Server-Sent-Events broadcaster (`text/event-stream`).
- `src/web/watch.ts` — chokidar/GitWatcher → `branch-changed` / `team-memory-changed` / `sidecar-changed`.
- `src/web/daemon.ts` — background start/stop/status via pidfile + port-file in `~/.tre-mem/`.
- `src/web/port.ts` — port derivation (`TRE_MEM_WEB_PORT` ?? `38700 + uid%100`, increment if busy).
- `web/` — React SPA source (`index.tsx`, `App.tsx`, `components/*`, `styles/tokens.css`).
- `scripts/build-web.mjs` — esbuild bundle `web/` → `dist/web/` (IIFE bundle + html shell).

**No schema migration needed** — Phase 3 is read-only over the existing v2 schema.

### Live updates (SSE)

`src/web/watch.ts` emits to all connected clients:

- `branch-changed` — reuse `GitWatcher` (`src/git/watcher.ts`) on each open project's `.git/HEAD`.
- `team-memory-changed` — chokidar on the repo's `.tre-mem/` dir → re-read JSONL (teammate pull /
  import / local export landed).
- `sidecar-changed` — daemon emits on its own writes (if write-actions added) + a light 2s poll of
  `countBranchTags` / pin counts to catch CLI writes from another terminal.

### API surface (`src/web/api.ts`)

`/api/health`, `/api/projects`, `/api/branches?project=`, `/api/branch/:branch?project=`
(timeline + pins + graduated), `/api/pins?project=`, `/api/graduated?project=`,
`/api/share-status?project=`, `/api/search?q=&branch=&project=`, `/api/observation/:id`,
`/api/events` (SSE).

### Frontend views (`web/`)

1. **Overview** — project picker; **branch map** (signature viz: branches w/ tag counts, last-active,
   current branch highlighted); share-status banner ("X pins pending export · Y graduated").
2. **Branch detail** — chronological timeline (tags + session summaries + pins + graduated), each row
   showing author/source from JSONL.
3. **Team memory** (core) — all pins + graduated across branches with note, author, source branch,
   shared/pending state. "Who decided this, and why."
4. **Search** — branch-aware box with per-signal score breakdown (sem/branch/rec/pin/grad) + `source`
   badge (observation / shared-pin / graduated).

**Design direction (deliberate, anti-template):** brand "Tre — shared roots." Editorial / light-luxury,
disciplined contrast; the **branch graph is the hero data-viz**, part of the design system. Tokens in
`web/styles/tokens.css` (oklch palette, clamp type scale, motion durations/easings). Compositor-only
motion (`transform`/`opacity`). Light + dark both intentional. Semantic HTML, keyboard-navigable,
reduced-motion respected. Bundle target < 80kb JS gzipped (microsite budget).

### Daemon lifecycle (`tre web`)

- `tre web` — foreground; derive port; auto-open browser (shell `open`/`xdg-open`/`start`, no dep);
  Ctrl-C stops.
- `tre web --background` / `tre web stop` / `tre web status` — daemonize via detached child + pidfile.
- Auto-start on session (`tre setup claude-code --with-web`) — **stretch**, not MVP.

---

## Roadmap — 2 weeks (T5 backend, T6 frontend)

### Week 5 — server + data + live

- [x] **T5D1** `src/web/port.ts` (derivation + busy-increment) + `src/web/daemon.ts` (pidfile self-heal); `tre web start|stop|status` + hidden `__serve` in `src/cli.ts`
- [x] **T5D2** `src/web/server.ts` node:http router (`:param` matching) + static serving (traversal-guarded) + `/api/health`; `openBrowser` helper
- [x] **T5D3** `src/web/api.ts` 9 read routes over `TreMemRepo` (health/projects/branches/branch/pins/graduated/share-status/search/observation)
- [x] **T5D4** claude-mem-OPTIONAL path: `runWebServer` opens adapter only when compatible; observation + search routes degrade to shared-only (`test/web-degrade-no-claudemem.test.ts`)
- [x] **T5D5** `src/web/sse.ts` (hub) + `src/web/watch.ts` (GitWatcher reuse + `.tre-mem/` chokidar + 2s sidecar fingerprint poll); `/api/events`
- [x] **T5D5** **Checkpoint T5 PASSED**: live `tre web` on this repo — every `/api/*` route returns valid JSON (full-mode FTS5 search hits, branch map w/ real counts), SSE streams `hello`+broadcasts, daemon status/pidfile self-heal verified. 36 web tests; suite 243/243 green; lint + typecheck + build clean.

### Week 6 — SPA + design + ship

- [ ] **T6D6** esbuild pipeline (`scripts/build-web.mjs` → `dist/web/`) wired into `pnpm build`; React shell + `tokens.css` design system
- [ ] **T6D7** Overview + branch-map viz; Branch-detail timeline
- [ ] **T6D8** Team-memory view (pins + graduated + authors) + Search view with score breakdown
- [ ] **T6D9** Live wiring (SSE → targeted re-fetch); dark/light; a11y + reduced-motion; Playwright smoke (optional, gated)
- [ ] **T6D10** Polish: `docs/WEB-UI.md`, README + README.vi web section, version bump `0.4.0 → 0.5.0`, CHANGELOG `[0.5.0]`, full pre-push gate, PR
- [ ] **T6D10** **Checkpoint T6 (moment of truth)**: a teammate opens `tre web`, sees the team's shared pins/graduated/branch-map, and the page updates live on a fresh `git pull` + `tre import`

---

## Critical files (modify / create)

**Create:**

- `src/web/server.ts`, `src/web/api.ts`, `src/web/sse.ts`, `src/web/watch.ts`, `src/web/daemon.ts`, `src/web/port.ts`
- `web/index.tsx`, `web/App.tsx`, `web/components/{BranchMap,BranchDetail,TeamMemory,Search}.tsx`, `web/styles/tokens.css` + per-component CSS
- `scripts/build-web.mjs`
- `docs/WEB-UI.md`
- Tests: `test/web-api.test.ts`, `test/web-server.test.ts`, `test/web-port.test.ts`, `test/web-degrade-no-claudemem.test.ts`; optional `e2e/web.spec.ts`

**Modify:**

- `src/cli.ts` — register `tre web [start|stop|status] [--background] [--port N]` (cac)
- `scripts/copy-assets.mjs` / `package.json build` — chain `build-web.mjs` so `dist/web/` ships
- `package.json` — devDeps `esbuild`, `react`, `react-dom`, `@types/react`, `@types/react-dom` (+ optional `@playwright/test`); `build:web` / `dev:web` scripts; version `0.4.0 → 0.5.0`
- `src/version.ts` — `VERSION → 0.5.0`
- `README.md`, `README.vi.md`, `CHANGELOG.md`

**Reuse from v0.1–v0.4 (do not reinvent):**

- `TreMemRepo` reads (`src/store/repo.ts`): `listBranchesForProject`, `listBranchTagsForBranch`, `listPinsForProject`/`listPinsForBranch`, `listGraduated`, `countBranchTags`, `countUnsharedPins`, `listBranchStates`, `getPinById`, `getGraduated`
- `ClaudeMemAdapter` reads (`src/adapter/claude-mem.ts`, optional): `getObservationsByIds`, `getObservations`, `getSessionSummaries`, `fts5SearchObservations`, `listProjects`
- `searchBranchContext` (`src/retrieval/search.ts`) — already surfaces `shared-pin`/`graduated` without local observations (the degraded path)
- `GitWatcher` (`src/git/watcher.ts`), `currentBranch` (`src/git/resolver.ts`)
- sync format/layout/export/import (`src/sync/*`) for authorship + share-status
- path helpers (`src/store/paths.ts`), `VERSION` (`src/version.ts`)

---

## Verification (end-to-end)

1. **Unit/integration** (vitest, TDD-first, suite stays 100% green, target ≥30 new):
   - server on ephemeral port → `fetch` each `/api/*` route against fixture DB → assert JSON shape
   - SSE event mapping; port derivation + busy-increment; daemon pidfile lifecycle
   - **degraded mode** (no claude-mem): branches/pins/graduated render; search still returns shared-pin/graduated hits
2. **Live smoke**: `tre web` in this repo → open dashboard → other terminal `tre pin <id>` / `tre export` → page updates via SSE without reload; `git checkout` flips current branch.
3. **Build**: `pnpm build` produces `dist/web/`; `tre web` serves it; bundle < 80kb JS gzipped.
4. **Frontend** (per web testing rules): Playwright smoke (`/` loads, `h1` visible, keyboard nav, reduced-motion) + screenshots at 768/1440 in light + dark; automated a11y check.
5. **Pre-push gate** (must match CI, Node 20 + 22): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` (`format:check` covers Markdown — run `pnpm format` first).

---

## Out of scope (Phase 3)

- Raw observation _ingest_ / parallel vector store — still claude-mem's job; reuse only.
- Auth / remote hosting — dashboard is **localhost-only, read-only** (binds 127.0.0.1).
- Write-heavy admin UI; multi-repo aggregation across unrelated projects.
- Cross-tool integration — that is Phase 4 ([`PLAN-PHASE4.md`](./PLAN-PHASE4.md)).

---

## Risks & mitigations

| Risk                                              | Mitigation                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Daemon lifecycle bugs (zombie/port leak)          | pidfile + port-file in `~/.tre-mem/`; `tre web status` reconciles; bind 127.0.0.1 only; idempotent start.    |
| Frontend bundle bloat                             | esbuild minify; React only; enforce < 80kb gzipped budget in CI; no UI component library.                    |
| Watching SQLite for external writes is unreliable | Don't watch the DB file; emit on own writes + light 2s count-poll; `.tre-mem/` + `.git/HEAD` use chokidar.   |
| claude-mem absent breaks the dashboard            | Adapter is optional from day one; observation views degrade to "not available", tested explicitly.           |
| Adding React/esbuild balloons install size        | All web build tooling is **devDependencies**; runtime ships only the static bundle + node:http (no Express). |
| Design ends up generic "dashboard-by-numbers"     | Deliberate direction + branch-graph hero viz + design tokens; component checklist from design-quality rule.  |

---

## Changelog (decisions & pivots)

- **2026-06-04** — Phase 3 plan drafted. User chose: web UI first (0.5.x), cross-tool → 0.6.x; full
  live-dashboard shape (daemon + React SPA + SSE); "live" reframed from claude-mem's observation
  stream to **team-memory changes** (tre-mem doesn't ingest). Stack: node:http + React/esbuild
  devDeps; claude-mem made optional as groundwork for Phase 4.

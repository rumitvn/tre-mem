# tre-mem — Branch-Aware Memory Layer (MVP Plan)

> Tagline: **"Tre — shared roots for your codebase."**
> Tre-mem là tầng memory branch-aware, local-first, build *trên* claude-mem để AI hiểu đúng *feature đang làm*, không chỉ *repo đang ở*.

> **Đây là single source of truth.** Mọi tiến độ, quyết định, đổi scope đều cập nhật vào file này và commit cùng code.

---

## Context

**Vấn đề (đã verify bằng schema thật của claude-mem):**
- claude-mem ingest rất tốt: SessionStart/UserPromptSubmit/PostToolUse/Stop/SessionEnd hooks → `observations` table với `project`, `cwd`, `created_at_epoch`, `files_read/modified`, FTS5 + Chroma vector.
- **Thiếu**: cột `branch`. Toàn bộ memory flat theo thời gian trong scope `project`. Developer làm việc theo feature/branch nhưng retrieval không phân biệt được.
- Hệ quả: hỏi "context của feature payment" → trả về cả fact từ feature khác cùng repo, lẫn fact stale từ branch đã merge tháng trước.

**Tre-mem giải quyết bằng cách:**
1. Quan sát git HEAD (cwd → branch hiện tại) và tag mọi observation mới với branch.
2. Backfill branch cho observation cũ bằng git reflog (timestamp → branch transitions).
3. Thay search semantic thuần bằng **3-signal retrieval**: semantic + branch locality + recency-trong-branch.
4. Expose qua MCP server để Claude Code / Cursor / Gemini CLI đều dùng được.

**Định vị:** KHÔNG fork, KHÔNG thay claude-mem. Sidecar database (`tre-mem.db`) read-only adapter trên `~/.claude-mem/claude-mem.db`.

**Decisions đã chốt:**
- Stack: **TypeScript / Node 20+** (match claude-mem, share SQLite driver, MCP SDK TS chính chủ).
- Scope MVP: **2 tuần tight** — branch tag + retrieval + MCP. Sync team / dashboard UI defer V2.
- Storage strategy: **Sidecar SQLite** (`~/.tre-mem/tre-mem.db`) với FK logic vào `observations.id` của claude-mem. Không ALTER TABLE upstream.

---

## Architecture

```
   Claude Code / Cursor / Gemini CLI
              │ (MCP stdio)
              ▼
   ┌───────────────────────────────────┐
   │  tre-mem MCP server (TS)            │
   │   • get_branch_context(query)      │
   │   • get_branch_timeline(branch)    │
   │   • pin_fact / graduate_fact       │
   │   • list_branches                  │
   └───────────────────────────────────┘
              │
   ┌──────────┴──────────────┐
   │  Retrieval engine        │   3-signal rerank
   │  (semantic + branch + recency)
   └──────┬──────────────┬────┘
          │              │
   ┌──────▼─────┐  ┌─────▼────────────┐
   │ tre-mem.db │  │ claude-mem.db     │  ← READ-ONLY
   │ (sidecar)  │  │ observations, FTS5│
   │ branch_tag │  │ session_summaries │
   │ branch_pin │  └───────────────────┘
   │ graduated  │
   └────────────┘
          ▲
   ┌──────┴───────────┐
   │  Git watcher      │  chokidar on .git/HEAD per repo
   │  + reflog backfill│  → upsert branch_tag
   └───────────────────┘
```

**Chia module:**
1. `adapter/` — read claude-mem (SQLite + Chroma client). Pluggable interface để sau mở thêm source.
2. `git/` — watcher + reflog parser + branch resolver.
3. `retrieval/` — 3-signal scoring + rerank + dedupe.
4. `mcp/` — MCP server (stdio transport) + tool handlers.
5. `cli/` — `tre` command (init, status, backfill, search, pin).

---

## Critical Files / Layout

```
tre-mem/
├── PLAN.md                         # ← SSOT (this file)
├── CLAUDE.md                       # codebase guide for Claude Code
├── package.json                    # bin: { "tre": "./dist/cli.js" }
├── tsconfig.json                   # NodeNext, strict
├── src/
│   ├── cli.ts                      # cac
│   ├── mcp/
│   │   ├── server.ts               # @modelcontextprotocol/sdk stdio
│   │   └── tools.ts                # tool handlers
│   ├── adapter/
│   │   ├── claude-mem.ts           # better-sqlite3 read-only on claude-mem.db
│   │   └── types.ts                # Observation, SessionSummary
│   ├── git/
│   │   ├── watcher.ts              # chokidar on <cwd>/.git/HEAD
│   │   ├── reflog.ts               # git reflog --date=iso parser
│   │   └── resolver.ts             # cwd+epoch → branch
│   ├── store/
│   │   ├── schema.sql              # tre-mem.db DDL
│   │   ├── migrate.ts              # apply schema_versions
│   │   └── repo.ts                 # branch_tag / pin / graduated CRUD
│   ├── retrieval/
│   │   ├── signals.ts              # semantic / branch / recency scorers
│   │   └── rerank.ts               # weighted merge + dedupe
│   └── hooks/
│       └── session-start.ts        # claude-code hook
├── test/
│   ├── adapter.test.ts
│   ├── git-resolver.test.ts
│   ├── retrieval.test.ts
│   └── mcp.test.ts
└── README.md
```

**Sidecar schema (`~/.tre-mem/tre-mem.db`):**

```sql
CREATE TABLE branch_tag (
  observation_id  INTEGER PRIMARY KEY,   -- FK logic → claude-mem observations.id
  project         TEXT NOT NULL,
  branch          TEXT NOT NULL,
  tagged_at_epoch INTEGER NOT NULL,
  source          TEXT NOT NULL          -- 'live' | 'reflog-backfill' | 'manual'
);
CREATE INDEX idx_branch_tag_branch  ON branch_tag(project, branch);

CREATE TABLE branch_pin (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project     TEXT NOT NULL,
  branch      TEXT NOT NULL,
  observation_id INTEGER,                -- nullable: pin có thể là free-text
  note        TEXT,
  created_at_epoch INTEGER NOT NULL
);

CREATE TABLE graduated (                 -- branch → repo facts
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project     TEXT NOT NULL,
  observation_id INTEGER NOT NULL,
  graduated_from_branch TEXT NOT NULL,
  graduated_at_epoch    INTEGER NOT NULL
);

CREATE TABLE branch_state (              -- live cache cho watcher
  project       TEXT NOT NULL,
  cwd           TEXT PRIMARY KEY,
  current_branch TEXT NOT NULL,
  updated_at_epoch INTEGER NOT NULL
);

CREATE TABLE schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at_epoch INTEGER NOT NULL
);
```

---

## Reused / Existing artefacts

- **claude-mem store** (`~/.claude-mem/claude-mem.db`) — tables `observations`, `session_summaries`, `sdk_sessions`, `user_prompts`. Read-only via better-sqlite3 (`readonly: true`).
- **Chroma vector store** (`~/.claude-mem/chroma/`) — query via `chromadb` npm client.
- **MCP SDK** — `@modelcontextprotocol/sdk` (TypeScript, official).
- **better-sqlite3** — sync API, readonly mode, WAL-friendly.
- **chokidar** — watch `.git/HEAD`.
- **simple-git** — parse `git reflog --date=iso`.

Không reinvent: vector store, ingest pipeline, embed model.

---

## 3-Signal Retrieval (core innovation)

```ts
async function getBranchContext(query: string, opts: { project: string; branch?: string; k?: number }) {
  const branch = opts.branch ?? await resolver.currentBranch(opts.project);
  const k = opts.k ?? 12;

  const semantic   = await chroma.query(query, { project: opts.project, k: k * 2 });
  const branchHits = await repo.observationsByBranch(opts.project, branch, k * 2);
  const recent     = await repo.recentByBranch(opts.project, branch, /*days*/ 3, k);
  const pins       = await repo.pinsForBranch(opts.project, branch);

  return rerank([
    ...semantic.map(o => ({ obs: o, score: o.similarity * 0.4 })),
    ...branchHits.map(o => ({ obs: o, score: 0.4 })),
    ...recent.map(o => ({ obs: o, score: 0.2 })),
    ...pins.map(o => ({ obs: o, score: 1.0 })),  // always top
  ]).slice(0, k);
}
```

Trọng số 0.4 / 0.4 / 0.2. Pin = boost 1.0 để user tự chống "memory rác".

---

## Git Branch Resolution

**Live (watcher):**
```ts
chokidar.watch(`${cwd}/.git/HEAD`).on('change', async () => {
  const branch = await simpleGit(cwd).revparse(['--abbrev-ref', 'HEAD']);
  await repo.upsertBranchState({ project, cwd, branch, updated_at_epoch: Date.now()/1000 });
});
```

**Backfill (reflog):**
```bash
git reflog --date=iso --all   # parse: ts → ref → branch
```
Với mỗi observation cũ: lấy `cwd`, `created_at_epoch` từ pending_messages join sdk_sessions → parse reflog → tìm transition gần nhất *trước* epoch → branch → insert `branch_tag` source='reflog-backfill'.

Edge cases:
- `cwd` không còn tồn tại → skip, log warning.
- Detached HEAD → record `branch='(detached:<sha>)'`.
- Repo chưa init git → record `branch='(no-git)'`.

---

## MCP Tools (expose ra Claude Code)

| Tool | Input | Output |
|------|-------|--------|
| `get_branch_context` | `query`, `project?`, `branch?`, `k?` | Top-K observations rerank theo 3-signal |
| `get_branch_timeline` | `branch`, `project?`, `limit?` | Chronological list (session_summaries + observations) trong branch |
| `list_branches` | `project?` | Branches có memory, kèm fact count + last_active |
| `pin_fact` | `observation_id`, `branch?`, `note?` | Đánh dấu fact quan trọng cho branch |
| `graduate_fact` | `observation_id` | Promote branch fact → repo-level |

Đăng ký MCP vào `~/.claude.json`:
```json
"mcpServers": { "tre-mem": { "command": "tre", "args": ["mcp"] } }
```

---

## CLI surface

```bash
tre init                          # tạo ~/.tre-mem/, run migration, register hook
tre status                        # cwd hiện tại → project / branch / observation count
tre backfill [--project PATH]     # quét reflog, gán branch cho obs cũ
tre search "<query>" [--branch X] # gọi 3-signal locally
tre pin <obs_id> [--note "..."]
tre graduate <obs_id>
tre mcp                           # start MCP server (stdio)
```

Parser: `cac` (nhẹ, đủ).

---

## Single source of truth & progress tracking

- **File chính:** `/Users/rumnv/Documents/tre-mem/PLAN.md` — commit cùng code, mọi session sau load đúng state.
- **Commit convention:** `<type>(<scope>): T<week>D<day> <subject>` — vd `feat(adapter): T1D2 read-only claude-mem.db reader`.
- **Update flow:** tick `- [x]` ngay sau khi task xong, commit kèm code change.

---

## Roadmap — 2 tuần (checklist)

### Tuần 0 — Bootstrap
- [x] **T0D0.1** Tạo `PLAN.md` (SSOT) trong project
- [x] **T0D0.2** Tạo `CLAUDE.md` — codebase guide cho Claude Code
- [x] **T0D0.3** Tạo `.gitignore` (node_modules, dist, .env, *.db, .DS_Store)
- [x] **T0D0.4** `git init` + first commit `chore: initial PLAN.md + CLAUDE.md`
- [x] **T0D0.5** GitHub repo `rumitvn/tre-mem` (private) + push: https://github.com/rumitvn/tre-mem
- [ ] **T0D0.6** Reserve npm package name `tre-mem` — defer cho cuối T2

### Tuần 1 — Adapter + branch tagging + backfill
- [x] **T1D1** Scaffolding: `package.json` (bin `tre`), tsconfig (NodeNext, strict), ESLint, Prettier, Vitest
- [x] **T1D1** `tre init` tạo `~/.tre-mem/tre-mem.db` + apply schema migration v1
- [x] **T1D2** Adapter `claude-mem.ts`: better-sqlite3 readonly, `getObservations({project, sinceEpoch})`, `getSessionSummaries({project})`, `getPendingMessages({project})`
- [x] **T1D2** Unit test adapter với fixture DB
- [x] **T1D3** Git resolver: `currentBranch(cwd)` via simple-git, handle detached HEAD / no-git
- [x] **T1D3** Watcher: chokidar trên `.git/HEAD`, upsert `branch_state`
- [x] **T1D4** Reflog parser: `git reflog show HEAD --date=unix`, map (epoch → branch transition)
- [x] **T1D4** Backfill engine: resolve branch cho obs cũ, insert `branch_tag` source='reflog-backfill'
- [x] **T1D4** CLI `tre backfill [--project PATH]` + `tre status`
- [x] **T1D5** Hook `session-start.ts`: ghi branch hiện tại vào `branch_state`
- [x] **T1D5** Doc cách register hook vào `.claude/settings.json`
- [x] **T1D5** **Checkpoint T1**: `tre status` trên 1 repo thật trả đúng project + branch + tagged count > 0

### Tuần 2 — Retrieval engine + MCP server + demo
- [x] **T2D6** Semantic searcher (FTS5 over `observations_fts` BM25) — Chroma client deferred (chromadb npm v3 needs server)
- [x] **T2D6** `signals.ts`: 3 scorer độc lập (semantic, branch, recency) — test fixture cố định
- [x] **T2D7** `rerank.ts`: weighted merge (0.4/0.4/0.2), dedupe theo observation_id, pin boost = 1.0
- [x] **T2D7** CLI `tre search "<q>" [--branch X]` in ra top-10 + score breakdown
- [x] **T2D7** CLI `tre pin <id>`, `tre graduate <id>`, `tre list-branches`
- [x] **T2D8** MCP server `server.ts` (`@modelcontextprotocol/sdk` stdio), 5 tool handlers
- [x] **T2D8** Test với `npx @modelcontextprotocol/inspector`
- [x] **T2D9** Đăng ký `mcpServers.tre-mem` vào `~/.claude.json` — registered via `claude mcp add -s user tre-mem -- node /Users/rumnv/Documents/tre-mem/dist/cli.js mcp`; `/mcp` shows status=connected, 5 tools; SessionStart hook fires on real project (multigo-android-dev) and reports correct branch on checkout
- [x] **T2D9** E2E: trong repo có ≥2 branch memory → checkout từng branch → ask Claude → assert khác nhau & đúng feature — verified on `multigo-android-dev` with `feature/test_tre_mem` / `feature/test_tre_mem_2`; same query "AccountManager region scope" flips top-1 from #1033 (1.000) to #1034 (0.600) when branch changes, branch-boost 0.40 applied to the correct branch-owned observation in each case (CLI + MCP `get_branch_context` agree)
- [x] **T2D9** A/B precision@10: so `tre-mem.get_branch_context` vs `claude-mem.search`; ghi vào `BENCHMARK.md` (harness `scripts/benchmark.mjs`)
- [x] **T2D10** Polish: README (install 3 lệnh + cách register MCP), CHANGELOG, version bump 0.0.0 → 0.1.0 (README.md, CHANGELOG.md, LICENSE MIT, `tre --version` → `tre/0.1.0`); `npm publish` deferred to user action
- [ ] **T2D10** Demo: screen-record 2 phút "đổi branch → AI hiểu đúng feature"
- [ ] **T2D10** **Checkpoint T2 (moment of truth)**: ≥1 dev ngoài cài thử + xác nhận "cảm nhận khác biệt rõ"

---

## Verification (end-to-end)

1. **Unit tests** (`vitest run`):
   - `adapter.test.ts`: mock claude-mem.db fixture, đọc đúng observation.
   - `git-resolver.test.ts`: temp git repo, switch branch, assert resolver.
   - `retrieval.test.ts`: 3 signal độc lập có score đúng; rerank đặt pin top; cùng query 2 branch → output khác nhau.
   - `mcp.test.ts`: spawn server, list_tools → 5 tool, call get_branch_context → structured response.

2. **Integration smoke**:
   ```bash
   cd /Users/rumnv/Documents/tre-mem
   pnpm build && pnpm link --global
   tre init && tre backfill --project /path/to/real/repo
   tre status
   tre search "stripe webhook" --branch feature/payment
   ```

3. **MCP integration với Claude Code**:
   - Thêm vào `~/.claude.json`: `mcpServers.tre-mem`.
   - Mở Claude Code trong 1 repo có ≥2 branch memory.
   - `git checkout feature/payment` → "What were we doing?" → kỳ vọng nhắc Stripe/webhook.
   - `git checkout fix/auth-jwt-expiry` → tương tự → kỳ vọng nhắc JWT, KHÔNG nhắc Stripe.

4. **A/B baseline so với claude-mem trực tiếp**:
   - Cùng query, gọi `claude-mem.search` vs `tre-mem.get_branch_context`.
   - Ghi lại: token count, tỉ lệ result thuộc đúng branch (precision@10).
   - Mục tiêu: ≥80% top-10 thuộc branch hiện tại (claude-mem thuần thường <50%).

---

## Out of scope (V2+)

- Team sync (git-based hoặc cloud) → V2 sau khi validate cá nhân.
- Dashboard UI React → V2; MVP dùng `tre` CLI là đủ.
- Ingest từ Cursor / Gemini CLI / Codex độc lập → adapter interface đã tách module.
- Auto fact-graduation khi merge PR → V2.
- Related-branch auto-linking, "lineage" theo parent branch → V2.
- Fine-tune model, enterprise SSO, payment → sau khi có ≥10 paying user.

---

## Risks & mitigation

| Risk | Mitigation |
|------|-----------|
| claude-mem update schema → adapter vỡ | Pin claude-mem version trong README; viết schema sanity check khi `tre init`. |
| Reflog backfill kém chính xác cho commit cũ (>90 ngày) | Reflog default expire 90d. Best-effort, mark `source='reflog-backfill'`. |
| File lock conflict SQLite | better-sqlite3 `readonly: true` + WAL mode (claude-mem đã WAL) → đọc concurrent an toàn. |
| Chroma client version drift | Bám version Chroma claude-mem dùng; fallback FTS5 qua MCP `search`. |
| Branch name có dấu `/` `:` → SQL/path edge cases | Validate + escape; test fixture có `feature/payment`, `release/1.2.3`, `(detached:abc)`. |

---

## Changelog (decisions & pivots)

- **2026-05-31** — Plan v1 approved. Stack: TypeScript. Scope: 2-tuần MVP. Strategy: sidecar adapter trên claude-mem.
- **2026-05-31** — T0 bootstrap done. Repo: `rumitvn/tre-mem` private (SSH). gh CLI v2.93.0 installed as primary GitHub workflow tool.
- **2026-05-31** — T1D1 done. Scaffolding (pnpm workspace, TS 6 NodeNext strict, ESLint 10 flat config, Prettier 3, Vitest 4) + `tre init` migration v1 with 4-test vitest suite green. Native build of better-sqlite3 12 enabled via `pnpm-workspace.yaml`. Schema assets copied to dist via `scripts/copy-assets.mjs` post-tsc.
- **2026-05-31** — T1D2 done. `ClaudeMemAdapter` (readonly + `PRAGMA query_only`) exposes `listProjects`, `getObservations`, `getSessionSummaries`, `getPendingMessages` with `sinceEpoch`/`untilEpoch`/`limit` filters and join to `sdk_sessions` for project scoping on `pending_messages`. Schema sanity check fails fast if the 4 upstream tables are missing. 9 new adapter tests against an in-tree fixture DB; total suite 13/13 green.
- **2026-05-31** — T1D3 done. `currentBranch(cwd)` via simple-git: returns `(no-git)` for missing dir / non-repo, `(detached:<sha12>)` when HEAD is detached, raw branch name (including `feature/payment`) otherwise. `TreMemRepo` adds `upsertBranchState` / `getBranchState` / `listBranchStates` (writable handle, FK on). `GitWatcher` does an initial `sync()` on `start()` and then chokidar-watches `.git/HEAD` (awaitWriteFinish 50ms) for change/add events. 9 new tests across resolver + watcher with ephemeral git repos; suite 22/22 green.
- **2026-05-31** — T1D4 done. `readHeadReflog(cwd)` runs `git reflog show HEAD --date=unix --pretty=format:%gd|%gs`, parses checkout transitions oldest-first (avoids same-second tie reversal), exposes `parseHeadReflog()` for pure-fn testing. `resolveBranchAt(transitions, epoch)` walks chronologically, falls back to the earliest transition's `from_branch` for pre-history queries. `backfill()` joins adapter observations with the resolver, idempotent via `branch_tag.observation_id` PK, reports `scanned/tagged/skippedAlreadyTagged/skippedNoBranch/transitions`. Extension beyond strict PLAN scope: optional `fallbackBranch` for single-branch repos (CLI fills it from `currentBranch(cwd)` skipping `(no-git)` / detached); validated on the tre-mem repo itself (22 observations tagged `main`). `tre status [path]` and `tre backfill [path]` CLI commands auto-run `migrate()` for first-touch UX. 13 new tests (reflog, backfill, repo CRUD); suite 41/41 green.
- **2026-05-31** — T1D5 done. `runSessionStartHook(input, opts)` (in `src/hooks/session-start.ts`) reads `cwd` from the Claude Code SessionStart payload (falls back to `process.cwd()`), resolves branch via the existing resolver, upserts `branch_state`, and returns counts of `tagged_on_branch` / `tagged_on_project` + a human-readable `message`. CLI exposes it as `tre hook <event>` — `cac` does not match multi-word command names, so the event is a positional arg (only `session-start` is wired today). Stdin parser is JSON-only, treats empty/non-JSON input as `{}`, never throws; errors fall back to `{"continue": true}` so a broken hook never blocks a Claude session. Hook output is a single line of JSON with `hookSpecificOutput.additionalContext` so Claude sees `tre-mem: project=X branch=Y tagged_on_branch=N …` at session top. Registration doc lives at `docs/HOOKS.md` (global + per-project examples + troubleshooting matrix). **Checkpoint T1 passed** on this repo: `tre status` → project=tre-mem, branch=main, branch_tag rows=22, claude-mem observations visible. Tests: 5 new (`session-start-hook.test.ts`); suite 46/46 green; lint + typecheck + build clean.
- **2026-05-31** — T2D6 done. Semantic signal sourced from claude-mem's FTS5 (`observations_fts` + BM25) instead of Chroma vector store — `chromadb` v3 npm client requires an HTTP server we don't want to introduce in MVP. `SemanticSearcher` interface in `src/retrieval/semantic.ts` keeps the swap-in point open; `Fts5SemanticSearcher` is the default impl. `ClaudeMemAdapter.fts5SearchObservations({match, project, k})` returns `(id, rank)` with BM25 (smaller = better); searcher normalizes to similarity in `(0, 1]` via `1/(1+(rank-bestRank))`. Query sanitization: tokens stripped to `[A-Za-z0-9_]`, wrapped in double quotes, joined with ` OR ` — defeats FTS5 operator injection (`AND`, `*`, `NEAR(`) and is verified by a fuzz-ish test. `src/retrieval/signals.ts` ships 3 pure scorers: `semanticSignal` passes through, `branchSignal` emits 1.0 only for tags on the current branch, `recencySignal` uses `0.5^(age/halfLife)` with default 3-day half-life and clamps future-dated rows to 1.0. Decision: keep this code path even after a future Chroma adapter lands — FTS5 is the fallback when Chroma is unavailable, per the Risks matrix. 17 new tests across 2 files; suite 63/63 green; lint + typecheck clean.
- **2026-05-31** — T2D7 done. `rerank()` in `src/retrieval/rerank.ts` is pure: per-signal max-dedupe (defensive against bug-upstream duplicates), then weighted sum with `DEFAULT_RERANK_WEIGHTS = {semantic: 0.4, branch: 0.4, recency: 0.2, pin: 1.0}`, sorted by `total DESC` with `observationId ASC` as the stable tiebreak. Pin is additive (not multiplicative or replacement) so a pinned obs with full signals can total >1.0 and stay top. `RerankBreakdown` is returned alongside `total` so the CLI / future MCP can show why something ranked. `src/retrieval/search.ts` orchestrates the full pipeline (`searchBranchContext`) and is reused by both CLI and the next-up MCP server; it pulls `fetchK = k * 4` candidates per signal, then narrows to top-K. **Real-data smoke surfaced a unit-mismatch bug**: claude-mem stores `created_at_epoch` in **milliseconds**, my code assumed seconds → every "recent" observation collapsed to age=0 and `recencySignal` returned 1.0 uniformly. Fixed at the adapter boundary: `ClaudeMemAdapter.upstreamEpochUnit` is auto-detected once per connection by sampling the newest row; reads normalize outgoing rows to seconds, writes (sinceEpoch/untilEpoch filters) convert back to ms when needed. `toSecondsEpoch(epoch)` exported from `src/adapter/types.ts` uses `epoch >= 10_000_000_000` as the ms-vs-seconds threshold. Existing tests use tiny fixture epochs → detected as `seconds` mode → fully backwards-compatible (zero test changes). Four new `tre` subcommands wired: `search "<q>" [--cwd P] [--project S] [--branch B] [--k N]`, `pin <id> [--note T]`, `graduate <id>`, `list-branches`. Search output prints `[total] #id  title` with `sem / branch / rec / pin` breakdown. PLAN slight deviation: recency window is project-scoped + 14-day fetch ceiling instead of branch-scoped 3-day; the 3-day half-life decay still does the heavy lifting and project scope is a more forgiving fallback when backfill missed a branch tag. 23 new tests across `retrieval-rerank`, `retrieval-search`, additional `repo` + `adapter` cases; suite 86/86 green; lint + typecheck clean; live smoke against real `~/.tre-mem/tre-mem.db` confirms semantic + branch + recency + pin all stack correctly (`#938` pinned → total 1.800, branch-only `#947` → 0.47, semantic-only newest `#999` → 0.55).
- **2026-05-31** — **T2D9 fully closed (live E2E passed)**. Demo repo `/Users/rumnv/Documents/source/android/multigo-android-dev` with two fresh test branches (`feature/test_tre_mem`, `feature/test_tre_mem_2`). After seeding one Claude session per branch (AccountManager Q on test_tre_mem, BMOtpTextView Q on test_tre_mem_2) and running `tre backfill` twice, `list-branches` showed `develop=36, feature/test_tre_mem=1, feature/test_tre_mem_2=1`. The cross-branch assertion: same query `"AccountManager region scope"`, `k=5`. On `feature/test_tre_mem` top-1 = **#1033 total 1.000** (sem 0.40 + branch 0.40 + rec 0.20) and #1034 sits at rank 2 with 0.200. On `feature/test_tre_mem_2` top-1 = **#1034 total 0.600** (branch 0.40 + rec 0.20) and #1033 drops to rank 2 with 0.600 (sem 0.40 + rec 0.20, no branch boost). The branch boost is correctly applied to whichever observation was authored on the active branch — exactly the branch-aware behavior the project promised. The same flip reproduces through the MCP path: an in-Claude-Code call to `tre-mem.get_branch_context` returned identical rankings. Caveat: top-K *set* is the same across branches in this run because the multigo-android-dev pool is only ~38 observations and the candidate fetch grabs the whole tail; the discriminating signal is scoring + ordering, set divergence will appear at larger pools or smaller k. Step 0 also added a dev-time `tre` shim via symlink into the Homebrew bin (no global `pnpm setup` needed). T2D9 checklist now fully checked.
- **2026-05-31** — T2D9 (MCP registration) done. User-side `claude mcp add -s user tre-mem -- node /Users/rumnv/Documents/tre-mem/dist/cli.js mcp` wrote the entry to `~/.claude.json`; restart of Claude Code shows `/mcp` → **tre-mem · connected · 5 tools** alongside the existing `atlassian-jira` and the plugin servers. SessionStart hook fires on a real project (`multigo-android-dev`) and reports the correct branch across checkouts (`feature/test_tre_mem` → `feature/test_tre_mem_2`). `tagged_on_branch=0 tagged_on_project=0` for that project because `tre backfill /path/to/multigo-android-dev` has not been run yet — once backfilled, the 3-signal rerank will kick in there too. Live two-branch E2E with real memory and cross-branch precision deltas waits on that backfill (deferred to T2D10 polish window per plan).
- **2026-05-31** — T2D9 (A/B harness) done. `scripts/benchmark.mjs` runs a fixed 10-query set against both **(A) `Fts5SemanticSearcher` baseline** (the closest in-process proxy for raw `claude-mem.search` since claude-mem itself indexes through the same FTS5 table) and **(B) `searchBranchContext`** (full 3-signal rerank), computes `precision@K_branch` (fraction of top-K whose `branch_tag.branch == target`), `Jaccard(A,B)` of top-K id sets, and the B-top-1 score breakdown — then writes `BENCHMARK.md` with per-query table + aggregate. Live numbers on the tre-mem repo (project=`tre-mem`, branch=`main`, K=10, 22 branch-tagged observations): **mean A precision@10 = 0.190, mean B precision@10 = 0.970, mean Jaccard = 0.134**. Interpretation: tre-mem concentrates branch-tagged observations at the top (0.19 → 0.97) and actually re-orders results (low Jaccard = rerank is not a no-op). Single-branch caveat is annotated in the report: precision here measures "fraction branch-tagged in top-K"; once a second branch is backfilled the same metric also captures cross-branch precision. Two T2D9 sub-tasks deferred: (1) `mcpServers.tre-mem` registration into `~/.claude.json` — Claude Code auto-mode blocked the edit (self-modification of CC config); proposed entry is `{type:"stdio", command:"node", args:["<repo>/dist/cli.js", "mcp"], env:{}}`, manual `~/.claude.json` backup already captured at `~/.claude.json.bak.tre-mem-1780243463`; (2) live two-branch E2E pending real multi-branch dataset. Lint + typecheck clean.
- **2026-05-31** — T2D10 polish (docs + version) done. Added `README.md` (one-liner + why + 3-step install + MCP registration via `claude mcp add -s user tre-mem -- tre mcp` + SessionStart hook + CLI surface + MCP tool table + architecture diagram + status), `CHANGELOG.md` in Keep-a-Changelog format with a single `[0.1.0] — 2026-05-31` entry covering sidecar store, read-only adapter, branch resolver/watcher, reflog backfill, 3-signal rerank, MCP server, SessionStart hook, CLI, benchmark harness, docs. Added MIT `LICENSE`. Bumped `package.json` version `0.0.0 → 0.1.0` and synced `getPackageVersion()` in `src/cli.ts` so `tre --version` prints `tre/0.1.0`. All quality gates remain green (typecheck + lint + 96/96 tests + build). `npm publish v0.1.0`, demo screen-record, and external-dev validation deliberately deferred to user action — those require credentials / hands / a second human and cannot be automated from this session.
- **2026-05-31** — T2D8 done. `src/mcp/tools.ts` exposes 5 pure tool functions (`getBranchContext`, `getBranchTimeline`, `listBranches`, `pinFact`, `graduateFact`) plus a `callTool(name, args)` dispatcher and a frozen `TOOL_DEFINITIONS` array carrying name/description/JSON-Schema for each. Tools resolve `project`/`branch` defaults via injectable `ToolDeps.defaultCwd` + `ToolDeps.resolveBranch` (defaults to `process.cwd()` + `currentBranch()`), and `now` is injectable for deterministic tests. `src/mcp/server.ts` uses the lower-level `@modelcontextprotocol/sdk` `Server` (not `McpServer`) because we don't want a zod dependency: `ListToolsRequestSchema` returns `TOOL_DEFINITIONS` 1:1; `CallToolRequestSchema` dispatches to `callTool`, JSON-stringifies into `content[0].text` AND mirrors structured into `structuredContent` so both old + new MCP clients work, and converts thrown errors to `{isError: true}`. `runMcpServer()` runs `migrate()`, opens adapter + repo, wires `StdioServerTransport`, and closes handles on SIGINT/SIGTERM. CLI gains `tre mcp` command. **Live MCP handshake smoke (real `~/.tre-mem/tre-mem.db`)**: `initialize` → `notifications/initialized` → `tools/list` returns all 5 tool descriptors; `tools/call list_branches {project:"tre-mem"}` returns `{branches: [{branch:"main", count:22}]}` — i.e. the same 22-tag count `tre status` shows, proving the full stack works through stdio. 10 new tests (`mcp-tools.test.ts` × 9, `mcp-server.test.ts` × 1); suite 96/96 green; lint + typecheck + build clean.

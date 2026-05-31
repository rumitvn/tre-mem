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
- [ ] **T0D0.5** Tạo GitHub repo `tre-mem` (private trước), `git remote add origin`, push
- [ ] **T0D0.6** Reserve npm package name `tre-mem` — defer cho cuối T2

### Tuần 1 — Adapter + branch tagging + backfill
- [ ] **T1D1** Scaffolding: `package.json` (bin `tre`), tsconfig (NodeNext, strict), ESLint, Prettier, Vitest
- [ ] **T1D1** `tre init` tạo `~/.tre-mem/tre-mem.db` + apply schema migration v1
- [ ] **T1D2** Adapter `claude-mem.ts`: better-sqlite3 readonly, `getObservations({project, sinceEpoch})`, `getSessionSummaries({project})`, `getPendingMessages({project})`
- [ ] **T1D2** Unit test adapter với fixture DB
- [ ] **T1D3** Git resolver: `currentBranch(cwd)` via simple-git, handle detached HEAD / no-git
- [ ] **T1D3** Watcher: chokidar trên `.git/HEAD`, upsert `branch_state`
- [ ] **T1D4** Reflog parser: `git reflog --date=iso --all`, map (epoch → branch transition)
- [ ] **T1D4** Backfill engine: resolve branch cho obs cũ, insert `branch_tag` source='reflog-backfill'
- [ ] **T1D4** CLI `tre backfill [--project PATH]` + `tre status`
- [ ] **T1D5** Hook `session-start.ts`: ghi branch hiện tại vào `branch_state`
- [ ] **T1D5** Doc cách register hook vào `.claude/settings.json`
- [ ] **T1D5** **Checkpoint T1**: `tre status` trên 1 repo thật trả đúng project + branch + tagged count > 0

### Tuần 2 — Retrieval engine + MCP server + demo
- [ ] **T2D6** Chroma client wrapper (point vào `~/.claude-mem/chroma/`)
- [ ] **T2D6** `signals.ts`: 3 scorer độc lập (semantic, branch, recency) — test fixture cố định
- [ ] **T2D7** `rerank.ts`: weighted merge (0.4/0.4/0.2), dedupe theo observation_id, pin boost = 1.0
- [ ] **T2D7** CLI `tre search "<q>" [--branch X]` in ra top-10 + score breakdown
- [ ] **T2D7** CLI `tre pin <id>`, `tre graduate <id>`, `tre list-branches`
- [ ] **T2D8** MCP server `server.ts` (`@modelcontextprotocol/sdk` stdio), 5 tool handlers
- [ ] **T2D8** Test với `npx @modelcontextprotocol/inspector`
- [ ] **T2D9** Đăng ký `mcpServers.tre-mem` vào `~/.claude.json`
- [ ] **T2D9** E2E: trong repo có ≥2 branch memory → checkout từng branch → ask Claude → assert khác nhau & đúng feature
- [ ] **T2D9** A/B precision@10: so `tre-mem.get_branch_context` vs `claude-mem.search`; ghi vào `BENCHMARK.md`
- [ ] **T2D10** Polish: README (install 3 lệnh + cách register MCP), CHANGELOG, npm publish v0.1.0
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

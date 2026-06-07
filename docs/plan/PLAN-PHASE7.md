# PLAN — Phase 7 (v0.10.x): Agent-driven export + cross-clone memory

> Phase SSOT, chained from [`PLAN.md`](../../PLAN.md). Status: **done (v0.10.0)**.

## Why

Two gaps surfaced from daily use:

1. **The assistant couldn't close the share loop.** `pin_fact` / `graduate_fact`
   only write the sidecar; publishing required dropping to a terminal for
   `tre share`. That one manual hop broke the "let the agent do it" flow.
2. **Memory didn't cross clones of one repo.** Identity was `basename(cwd)`, so
   `app`, `app-2`, `app-3` (parallel clones) were three isolated projects.

User decisions: MCP tool = **export + local commit, no push**; cross-clone =
**default-on + `TRE_MEM_CROSS_CLONE=0` kill-switch**; plus three small UX extras
(pending-share status tool, `tre status` clone visibility, `graduate_fact` hint).

## A — Agent-driven export (MCP)

- **`export_memory`** — reuses `exportSync` (`src/sync/export.ts`) +
  `shareToGit({commit:true, push:false})` (`src/sync/share.ts`). Writes `.tre-mem/`
  and makes a **local commit**; never pushes. Returns `{ files, total_added,
graduated_added, committed, pushed:false, commit_hint, note }`. Fail-closed on
  secrets: a `RedactionError` returns `redaction_blocked { categories, count,
instruction }` — never the secret values, no files written.
- **`get_share_status`** — `{ pending_export, shared_pins, total_pins, graduated,
has_sync_dir }` (mirrors `/api/share-status`). Lets the agent nudge the user.
- **`graduate_fact`** — result gains a `hint` field pointing at `export_memory`.

Both new tools use the **write key** (`basename(cwd)` / `--project`), since
publishing and pending-share are per-clone.

## B — Cross-clone memory by git remote

**Approach: read-time alias union, never a stored-key rewrite.** Writes keep using
`basename(cwd)`; reads expand to `project IN (alias set)`. Forced by constraints:
claude-mem observations are permanently basename-keyed (read-only upstream),
historical sidecar rows can't be reliably re-keyed, and committed `.tre-mem/` JSONL
carries `project`. Payoff: **on-disk format + `SYNC_SCHEMA_VERSION` unchanged, zero
teammate impact**, and only one additive schema column.

- `src/git/remote.ts` — `canonicalizeRemoteUrl(url)` (pure: ssh scp / ssh-url /
  https-with-creds / `git://`, strip `.git` + trailing slash, lowercase →
  `host/org/repo`); `remoteSlug(cwd)` reads `remote.origin.url`, never throws.
- `src/store/aliases.ts` — `resolveProjectIdentity(repo, cwd, opts) → { project,
remote, aliases }`; `crossCloneEnabled(env)` (`TRE_MEM_CROSS_CLONE` off-switch).
- Schema **v3** (`src/store/migrate.ts` + `schema.sql`): nullable
  `branch_state.remote` + `idx_branch_state_remote`, idempotent self-heal mirroring
  v2. No backfill; rows self-heal on next session-start / git-watch write.
- `src/store/repo.ts` — `projectAliases(project, remote)` (= `SELECT DISTINCT
project FROM branch_state WHERE remote = ?` ∪ `{project}`, else `[project]`) and
  `*Across(projects[])` readers (`countBranchTagsAcross`,
  `listBranchTagsForBranchAcross`, `listPinsForBranchAcross`,
  `listPinsForProjectAcross`, `listGraduatedAcross`, `listBranchesForProjectAcross`,
  `listPinBranchesAcross`). Single-element array == prior behavior.
- Adapter/retrieval refactored `project: string → projects: string[]`,
  `= @project → IN (…)`: `src/adapter/claude-mem.ts`, `src/adapter/types.ts`
  (`ListQuery`), `src/retrieval/semantic.ts`, `src/retrieval/search.ts`.
- Entry points resolve identity (writes use `project`, reads use `aliases`):
  `src/mcp/tools.ts`, `src/hooks/session-start.ts`,
  `src/hooks/user-prompt-submit.ts`, `src/web/server.ts` + `api.ts`, `src/cli.ts`.
  `branch_state.remote` is persisted by session-start and the git watcher.

## C — Visibility

- `tre status` prints `remote:` and, when >1 clone shares it,
  `linked clones (N): …`.
- `/api/health` carries `remote` + `linked_clones`; dashboard topbar shows a
  `🔗 N clones` chip (`web/app.tsx`, `Health` type in `web/lib.tsx`).

## Tests

`test/git-remote.test.ts`, `test/store-aliases.test.ts`,
`test/mcp-export-crossclone.test.ts` (export commit-no-push, redaction fail-closed,
share-status, graduate hint, cross-clone surfacing + isolation), plus v3 migration
cases (`test/migrate.test.ts`), repo alias/`*Across` cases (`test/repo.test.ts`),
and the `projects[]` migration across adapter/retrieval/web/mcp test fixtures.
Full gate green: format · lint · typecheck · 364 tests · build.

## Out of scope (deferred)

- Monorepo sub-path identity (one remote, many logical projects) — kill-switch is
  the escape hatch for now.
- Cross-clone for the per-clone "pending share" view (kept per-clone by design).
- Auto-export-on-graduate (the user prefers an explicit `export_memory` call).

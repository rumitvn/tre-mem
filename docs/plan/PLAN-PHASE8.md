# PLAN — Phase 8 (v0.11.x): Forget/correct facts + onboarding & banner polish

> Phase SSOT, chained from [`PLAN.md`](../../PLAN.md). Status: **done (v0.11.0)**.

## Why

Three gaps surfaced from daily use:

1. **Memory was append-only — facts could never be removed or corrected.** A
   graduated/pinned fact routinely goes wrong: a leader's PR feedback, a bug found
   in QC, a changed approach. There was **zero** delete capability anywhere. And a
   shared fact lives in `.tre-mem/*.jsonl` — append-only, content-hash-deduped,
   git-committed, auto-imported — so deleting the local row alone leaves every
   teammate's clone holding the stale fact forever.
2. **Onboarding was terse; `tre status` was a wall of text.**
3. **The SessionStart banner duplicated and rendered above claude-mem.**

User decisions: forget = **local delete + propagating tombstone**; API = **granular
`unpin_fact` / `ungraduate_fact`** (mirror `pin_fact` / `graduate_fact`); banner =
**dedup + sit below claude-mem**; all three ship together as **v0.11.0**.

## A — Forget / correct facts (tombstone propagation)

"Update" is not a separate method: correcting a fact = `ungraduate_fact` (tombstone
the old content_hash) then `graduate_fact` the fixed observation (new content → new
hash → new line).

- **Tombstone sync record** (`src/sync/format.ts`) — new `kind: 'tombstone'`
  carrying the removed fact's `content_hash` + `target_kind`. Stays at
  `SYNC_SCHEMA_VERSION = 1`; pre-v0.11 clients skip it via the existing unknown-kind
  `catch` (graceful, the fact just lingers for them until they upgrade).
- **Store deletes** (`src/store/repo.ts`) — `deletePinById`,
  `deletePinsByObservation`, `deletePinsByContentHash`,
  `deleteGraduatedByObservation`, `deleteGraduatedByContentHash`.
- **Two-pass import** (`src/sync/import.ts`) — pass 1 collects tombstoned hashes;
  pass 2 inserts only non-tombstoned facts and deletes any the tombstones target.
  Order-independent within a file, idempotent across re-imports (a removal can never
  be resurrected by an earlier line). `ImportResult` gains `tombstoned`.
- **Forget flow** (`src/sync/forget.ts`) — `forgetPin` / `forgetGraduated` write the
  tombstone to `.tre-mem/` **at call time** (before deleting the row — once the row
  is gone there is nothing left for `export_memory` to emit), then delete locally.
  Unshared facts (no `content_hash`) are deleted with no tombstone. Tombstone append
  is idempotent (dedup by `kind:'tombstone'` + hash). `readLiveSyncRecords`
  (`src/sync/read.ts`) applies tombstones so the web layer never surfaces a forgotten
  fact.
- **MCP tools** (`src/mcp/tools.ts`, 7 → **9**) — `unpin_fact` (`observation_id`,
  `branch?`, `project?`, `cwd?`) and `ungraduate_fact` (`observation_id`, `project?`,
  `cwd?`). Both use the write key (`basename(cwd)`). Hints point at `export_memory`.
- **CLI** (`src/cli.ts`) — `tre unpin <id>` / `tre ungraduate <id>`.

## B — Onboarding & `tre status`

- **`tre init [--all] [--verbose]`** (`src/cli.ts`) — guided first run: quiet
  migration, claude-mem mode line, and a numbered "Next steps" block. `--all` chains
  `setupAll(cwd)` + `backfill` in one step. Reuses `diagnoseClaudeMem`,
  `setupAll`, `backfill`.
- **`tre status`** — regrouped into **Identity / Memory / Tools / claude-mem**
  sections with a headline `full` / `shared-only` mode. Same data, no new sources;
  freshness now via `probeClaudeMemIngest`.

## C — SessionStart banner: dedup + below claude-mem

Root cause of duplication: the tre-mem hook was registered in **two** settings files
(project `.claude/settings.json` and global `~/.claude/settings.json`) → fired twice.

- **Detection + fix** (`src/setup.ts`) — `scanSessionStartHooks(cwd, files?)` counts
  tre-mem SessionStart hooks per file (predicate: command matches `hook
session-start`); `dedupeSessionStartHooks(cwd, keep, files?)` collapses to one
  (keeps the global copy by default). Both take an injectable file list for tests.
- **`tre doctor [--fix-hooks]`** — reports the duplicate (naming each file) and, with
  the flag, collapses it.
- **Ordering** (`src/cli.ts` `runSessionStartHookCli`) — defers the banner by
  `sessionHookDelayMs(format)`: env `TRE_MEM_HOOK_DELAY_MS`, default **250 ms** when
  claude-mem is present on Claude Code, else 0. Best-effort so tre-mem renders below
  claude-mem (which renders in completion order); fully tunable.

## Compatibility

- On-disk format + `SYNC_SCHEMA_VERSION` **unchanged** (tombstone is a new kind, not
  a new schema). Old clients skip tombstones; new clients honor them.
- No claude-mem schema changes (read-only as always).

## Verification

- Pre-push gate green (format/lint/typecheck/test/build), Node 20 + 22.
- Live: `graduate` → `share` → `ungraduate` (tombstone appended + local row gone) →
  second clone `import` drops the fact. MCP: `graduate_fact` then `ungraduate_fact`.
- Onboarding: fresh `~/.tre-mem` → `tre init --all`; sectioned `tre status`.
- Banner: `tre doctor` flags the duplicate; `--fix-hooks` collapses to one.

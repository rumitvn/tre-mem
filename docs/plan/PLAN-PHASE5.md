# tre-mem Phase 5 — "Share, made obvious" (git-native team memory, provider-agnostic)

> Sibling plan to [`PLAN.md`](../../PLAN.md) (v0.1), [`PLAN-PHASE2.md`](./PLAN-PHASE2.md) (v0.2–v0.4),
> [`PLAN-PHASE3.md`](./PLAN-PHASE3.md) (v0.5), [`PLAN-PHASE4.md`](./PLAN-PHASE4.md) (v0.6).
> This file is the **Phase 5 SSOT** (v0.7.x). Tick `- [x]` per task and commit with the code.

## Context

Through v0.6, tre-mem is branch-aware (P1), git-shared (P2), web-visible (P3), and cross-tool
(P4). But the product owner's verdict is sharp: **"Team Shared" is the real differentiator and it
isn't legible.** Three concrete problems, confirmed in the code:

1. **Sharing is a manual, jargon-heavy dance.** `tre export` writes `.tre-mem/*.jsonl` but does
   **not** touch git — the user must then `git add/commit/push` by hand (`src/cli.ts:452-565`,
   success msg `:551`). Status/web say _"pending export"_ with zero explanation, and the same act is
   called "export"/"share"/"push" across CLI, docs, and web.
2. **Graduation is needlessly GitHub-locked + CI-dependent** (owner: "GitHub Action… not
   effective"). Coupling is isolated to 3 spots: `prHeadBranch()` via `gh` (`src/git/github.ts`),
   the composite action (`actions/graduate-on-merge/action.yml`), and the `--with-action` scaffold
   (`src/setup.ts:59-76,136-143`). The core `graduateBranch()` (`src/sync/graduate.ts`) is already
   provider-agnostic, and the sharing channel itself (`.tre-mem/` committed to the repo) is 100%
   provider-neutral.
3. **No conflict strategy.** No `.gitattributes`; two devs appending to the same `.tre-mem/*.jsonl`
   hit a real git conflict. But the format is append-only and `import` dedupes by content-hash
   (`src/sync/format.ts:93-123`, `import.ts:81-82`), so "keep both" is nearly free.

**Goal:** make _"push your memory to your git"_ the bold, obvious hero flow — one command, any git
provider, CI-free graduation, "keep both" conflicts.

**Decisions locked with owner:**

- **One command: `tre share`** = `export` → `git add .tre-mem` → commit → push (with escapes).
  Receive side stays automatic (SessionStart hook already auto-imports on `git pull`). `tre export`
  kept as the low-level primitive `tre share` calls.
- **Defer model-powered curation** (distilling notes via Gemini/Codex/Antigravity subs). Pins +
  graduated facts are human-authored = already curated; a model-call pipeline contradicts the
  sidecar philosophy. Its own future phase.
- **Conflicts = "keep both"** via git union-merge; no resolver this phase. When two same-branch
  edits collide, keep both lines; `import`'s content-hash dedupe collapses any duplicates.

---

## The Phase 5 Story (positioning)

> "Pin a decision, run `tre share`, and it's in your team's git. Your teammate runs `git pull` and
> their AI already knows — Claude Code, Codex, Gemini, Cursor, whatever. No CI to set up, no GitHub
> required: GitLab, Bitbucket, a bare remote on a server — if it's git, it works. The repo is the
> memory."

| Capability                       | Before (v0.6)                      | After (v0.7)                        |
| -------------------------------- | ---------------------------------- | ----------------------------------- |
| Publish memory                   | `tre export` + manual git (3 cmds) | `tre share` (1 command)             |
| Git provider                     | GitHub-leaning (Action + `gh`)     | Any git remote (provider-agnostic)  |
| Graduate on merge                | GitHub Action only                 | Local post-merge hook **or** any CI |
| Concurrent edits to shared files | manual conflict resolution         | `merge=union` auto "keep both"      |
| "What's shared vs not" clarity   | "pending export" jargon            | plain language + exact next command |

---

## Architecture changes from v0.6 (additive)

```
   pin/graduate (curate)            git remote (any provider)
        │                                   ▲
        ▼                                   │ tre share = export + add + commit + push
   ~/.tre-mem (sidecar) ──exportSync──▶ .tre-mem/*.jsonl ──git──▶ teammate clone
                                            │  (merge=union: keep both)
                                            ▼
                                   git pull → SessionStart hook → importDir (auto)
```

**1. `tre share`** — new `src/sync/share.ts` orchestrates `exportSync()` (reused, not
reimplemented) then runs `git add .tre-mem && git commit && git push` via **`simple-git`** (already
a dep; pattern in `src/git/watcher.ts`). Plain git only → GitHub/GitLab/Bitbucket/bare-remote all
work. Git ops behind an injectable runner so tests never touch a real remote.

**2. Provider-agnostic graduation** — `graduate-pr` degrades gracefully when `gh` is absent (already
returns null at `github.ts:16`; CLI must stop `exit(2)` and infer branch from `--branch`/CI env). A
local **post-merge git hook** (`tre setup … --with-hook`) graduates + shares without any CI. The
GitHub Action becomes one optional example among generic CI snippets.

**3. "Keep both" conflicts** — `ensureSyncScaffold()` also writes `.tre-mem/.gitattributes` with
`*.jsonl merge=union`. `tre share` backfills it for already-initialized repos.

**4. Legibility** — unify vocabulary to "share"; rewrite `tre status`, web `TeamMemory`/`Overview`
copy; reposition README/docs around the 1-command loop.

**No schema migration** — Phase 5 is sharing UX + git plumbing over existing data.

---

## Roadmap — 2 weeks (T9 share + conflicts, T10 graduation + hero polish + ship)

### Week 9 — `tre share` + conflicts + CLI legibility

- [x] **T9D1** `PLAN-PHASE5.md` SSOT; chain from `PLAN.md`; dogfood decision (below).
- [x] **T9D2** `src/sync/share.ts` + `tre share [--branch|--all] [--message] [--no-push] [--no-commit] [--dry-run]` (export + git add/commit/push via injectable git runner; honest output; never crash on push failure). Tests: `test/sync-share.test.ts`.
- [x] **T9D3** `.tre-mem/.gitattributes` (`*.jsonl merge=union`) in `ensureSyncScaffold`; backfill on `tre share`. Tests: `test/sync-union-merge.test.ts` (3-way append conflict → union → re-import no dupes).
- [x] **T9D4** Legibility pass 1 (CLI): rewrite `tre status` share line (no unexplained "pending export"); unify "share" vocabulary; every not-shared surface prints the exact next command.
- [x] **T9D5** **Checkpoint T9**: scriptable local — `tre pin → tre share` pushes `.tre-mem/` in one command to a **bare** remote; second clone `git pull` + SessionStart auto-import shows the pin; simulated same-file conflict auto-resolves.

### Week 10 — provider-agnostic graduation + hero polish + ship

- [x] **T10D6** `graduate-pr` graceful degrade without `gh` (branch/CI-env inference, clear message, no `exit 2` when no provider API).
- [x] **T10D7** Local post-merge hook: `tre setup <tool> --with-hook` installs `.git/hooks/post-merge` (merged-branch detection via reflog/ORIG_HEAD; reuse `src/git/reflog.ts`); reframe `--with-action` help as optional.
- [x] **T10D8** Generic CI docs (GitLab/Bitbucket snippets) + reframed GitHub-Action section; resolve dogfood workflow file.
- [x] **T10D9** Legibility pass 2 (web): `TeamMemory.tsx` + `Overview.tsx` copy/badges (`not shared yet` / `shared via git ✓`); "how sharing works" affordance + per-pin share command.
- [x] **T10D10** Polish: README + README.vi hero repositioning, `docs/TEAM-WORKFLOW.md`, version `0.6.0 → 0.7.0`, CHANGELOG `[0.7.0]`, full gate, PR.
- [ ] **T10D10** **Checkpoint T10 (moment of truth, user-gated)**: owner runs `tre share` against a **non-GitHub** remote and confirms a teammate sees the pin — proving provider-agnostic, CI-free sharing.

---

## Critical files (create / modify)

**Create:** `src/sync/share.ts` · `test/sync-share.test.ts` · `test/sync-union-merge.test.ts` ·
docs sections (generic CI + post-merge hook).

**Modify:** `src/cli.ts` (`tre share`, status copy, `graduate-pr` degrade, `--with-hook`) ·
`src/sync/layout.ts` (`.gitattributes` scaffold) · `src/git/github.ts` (gh-optional path) ·
`src/setup.ts` (post-merge hook installer, reframe `--with-action`) · `web/views/TeamMemory.tsx` ·
`web/views/Overview.tsx` · `README.md` · `README.vi.md` · `docs/TEAM-WORKFLOW.md` ·
`package.json` + `src/version.ts` (`0.6.0 → 0.7.0`) · `CHANGELOG.md`.

**Reuse (do not reinvent):** `exportSync()` (`src/sync/export.ts`) · `graduateBranch()`
(`src/sync/graduate.ts`) · `simpleGit` git-op pattern (`src/git/watcher.ts`, `src/git/identity.ts`) ·
`parseHeadReflog`/reflog (`src/git/reflog.ts`) · `importDir()` (`src/sync/import.ts`) · content-hash
dedupe (`src/sync/format.ts`) · `ensureSyncScaffold` / `writeFileAtomic` (`src/sync/layout.ts`).

---

## Verification (end-to-end)

1. **Unit/integration (vitest, ≥15 new):** `tre share` via injected git runner — export+add+commit+push
   order, `--no-push`/`--no-commit`/`--dry-run`, nothing-to-share no-op, push-failure message;
   `.gitattributes` scaffold + backfill; union-merge conflict → clean `import` (no dupes);
   `graduate-pr` without `gh`.
2. **Local two-clone E2E** (extend `scripts/two-dev-e2e.sh`): alice `tre pin && tre share`, bob
   `git pull` + SessionStart auto-import sees the pin; force a same-file append conflict and confirm
   `merge=union` + `import` resolve cleanly. **Bare-remote only — no GitHub, no `gh`** (proves
   provider-agnostic).
3. **Legibility check:** `tre status` and the web Team-Memory view never show unexplained "pending
   export"; every unshared state prints/links the exact command.
4. **Pre-push gate** (Node 20 + 22): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

---

## Out of scope (Phase 5)

- Model-powered note curation across Gemini/Codex/Antigravity subs (deferred — own future phase).
- Real-time/automatic publish (sharing stays an explicit `tre share`, not a daemon).
- Conflict-resolution UI / 3-way semantic merge (union "keep both" is the v0.7 answer).
- Per-provider API integrations beyond plain git (no GitLab/Bitbucket REST clients).

---

## Risks & mitigations

| Risk                                                | Mitigation                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tre share` pushes to the wrong remote/branch       | Push current branch to its tracking upstream only; on no-upstream, print the exact `git push -u …` and stop (never guess). |
| Commit/push fails (auth, no remote) mid-share       | Export is already committed to disk; git steps are best-effort and report the manual fallback. Never crash.                |
| `merge=union` keeps malformed/conflict-marker lines | `import` skips unparseable lines and dedupes by content-hash; lines are independent JSON.                                  |
| Users expect `tre share` to also pull               | `tre share` is publish-only by design; receive stays automatic via SessionStart. Documented.                               |
| Post-merge hook noisy or slow                       | Hook runs `graduate-pr` + `tre share --no-push` (local only), silent on no-op, never blocks git.                           |

---

## Changelog (decisions & pivots)

- **2026-06-06** — Phase 5 planned + started. Theme: make team-share the bold, clear, hero feature.
  One-command `tre share`; provider-agnostic + CI-free graduation; union-merge "keep both"
  conflicts. Model-powered curation deferred. **Dogfood decision:** keep the GitHub Action workflow
  (`.github/workflows/tre-mem-graduate.yml`) committed for this repo as the _documented optional-CI
  example_, but demote it from "the" graduation path to one option among local-hook + generic CI.
- **2026-06-06 (v0.7.1)** — **Reversed the dogfood decision: removed the GitHub Action entirely.**
  Per owner ("never GitHub Action — too locked-in, hard to scale"), deleted `actions/graduate-on-merge/`,
  the `--with-action` flag + workflow scaffold, and the dogfood workflow. Graduation is now git-native
  only (local `post-merge` hook) or provider-neutral CI snippets calling `tre graduate-pr`.

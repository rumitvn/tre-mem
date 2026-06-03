# tre-mem Phase 2 — "Git for AI Memory"

> Sibling plan to [`PLAN.md`](./PLAN.md) (Phase 1 SSOT, v0.1.0 shipped).
> This file is the Phase 2 SSOT. Not started yet — kicks off after teammate dogfeeding feedback on v0.1.0 (T2D10 demo).

## Context

Phase 1 MVP (v0.1.0) shipped a branch-aware, local-first AI memory layer: 3-signal retrieval (semantic + branch + recency), MCP server with 5 tools, CLI surface, SessionStart hook. Validated end-to-end on a real multi-branch repo: same query flips top-1 result when you `git checkout` a different branch (precision@10 jumped 0.19 → 0.97 vs flat FTS5 baseline).

Today the user starts dogfooding with a teammate. Phase 1 is "solo dev, branch-aware." Phase 2 must answer **why a team would adopt this over claude-mem, mem0, Lore, or just-use-Cursor**.

**USP for Phase 2: "git push your AI memory."** Tre-mem becomes the first memory layer that travels through git itself — committed alongside code, reviewable in PRs, auto-graduated when PRs merge, inherited by new teammates the moment they `git clone`. No cloud, no central server, no lock-in. Branch-awareness (Phase 1) + team-share (Phase 2) is a combination no competitor has.

**Decisions locked with user:**
- Storage: `.tre-mem/` committed dir, JSONL files (human-readable diffs in PRs).
- Share scope: pins + graduated facts only (raw observations stay private in each dev's `~/.claude-mem/`).
- Graduation trigger: GitHub Action on merged PR (with manual CLI fallback for non-GH flows).

---

## The Phase 2 Story (positioning)

> "Tre-mem is git for AI memory. Pin a decision on `feature/payment`, push, and your teammate's Claude Code already knows it tomorrow. Merge the PR, and the decision automatically graduates to repo-wide knowledge. No cloud. No central server. Just git."

Three differentiators stacked:
1. **Branch-aware** (Phase 1, already shipped)
2. **Team-shared via git** (Phase 2, new) — network effect: 2 devs = 2x value, 10 devs = 10x
3. **Auto-lifecycle** (Phase 2, new) — PR merge graduates pins, no manual curation tax

vs. the field:
| Tool | Branch-aware | Team-shared | Git-native | Local-first | Server-free |
|------|:-:|:-:|:-:|:-:|:-:|
| claude-mem | ❌ | ❌ | ❌ | ✅ | ✅ |
| mem0 / Letta | ❌ | cloud only | ❌ | ❌ | ❌ |
| Cursor/Cline | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Lore** (agentkitai/lore) | partial (via `github_sync`) | server-shared (Postgres + workspaces) | ❌ | self-host only | ❌ (needs Postgres + server) |
| **tre-mem v0.2** | **✅** | **✅ (via git)** | **✅** | **✅** | **✅** |

**Lore is our nearest neighbor — explicit positioning vs them:**
> "Lore is server-shared. Tre-mem is git-shared. If your code lives in git, so does your AI memory — no Postgres, no API keys, no workspace setup, no central server. Clone the repo, you've cloned the memory."

Lore validates the "shared AI memory" category (Docker Compose, pgvector, REST API, knowledge graph UI, workspace + RBAC, plugin SDK). We deliberately do not chase that surface — surface area is their bet, focus is ours. Our wedge is **the git workflow itself as the distribution mechanism**, not a server you have to stand up.

---

## Architecture changes from v0.1

```
   alice@laptop                       bob@laptop
   ~/.claude-mem/   (private)         ~/.claude-mem/    (private)
   ~/.tre-mem/      (private sidecar) ~/.tre-mem/       (private sidecar)
        │                                   ▲
        │ tre export (writes pins+grad)     │ tre import (reads pins+grad)
        ▼                                   │
   repo/.tre-mem/  ──── git push ──── git pull ──── repo/.tre-mem/
        │
        │ on PR merge
        ▼
   .github/workflows/tre-mem-graduate.yml → appends to .tre-mem/graduated.jsonl
```

**New module surface** (additive — keeps v0.1 architecture intact):
- `src/sync/` — export/import JSONL ↔ sidecar DB, content-hash dedupe, redaction filter
- `src/sync/format.ts` — JSONL schema (versioned: `{schema:1, kind:'pin'|'graduated', ...}`)
- `src/sync/redact.ts` — secret detection (regex pack: API keys, tokens, private keys, emails opt-in)
- `actions/graduate-on-merge/` — composite GitHub Action, published as `rumitvn/tre-mem-action@v1`

**Schema v2 migration** (`schema.sql` → v2):
- Add `branch_pin.shared_at_epoch` (nullable; non-null = exported to .tre-mem/)
- Add `branch_pin.content_hash` (SHA-256 of normalized payload, for dedupe across devs)
- Add `graduated.shared_at_epoch`, `graduated.content_hash`
- Add `import_state` table: `(file_path PK, last_sha, imported_at_epoch)` so `tre import` is idempotent

**JSONL on-disk format** (committed to repo):
```
.tre-mem/
├── README.md                          # auto-generated, explains the dir to humans
├── .shareignore                       # regex patterns to block from export (gitignore-style)
├── branches/
│   └── <branch-slug>.jsonl            # one row per pinned observation
└── graduated.jsonl                    # one row per graduated fact, append-only
```

Each JSONL row carries content_hash (dedupe key), author, branch, tagged_at_epoch, title, body, and a `schema` version field. Append-only semantics → git merges are union-merges, no real conflicts.

---

## Roadmap — 2 weeks (T3 + T4)

### Week 3 — Sync foundation
- [x] **T3D1** Schema v2 migration + `tre migrate` re-runs cleanly on existing v0.1 DBs
- [x] **T3D1** JSONL format spec frozen in `docs/SYNC-FORMAT.md` (versioned schema)
- [ ] **T3D2** `src/sync/export.ts` — `exportBranch(branch)` writes pins to `.tre-mem/branches/<slug>.jsonl`
- [ ] **T3D2** `tre export [--branch X] [--all]` CLI, idempotent, dry-run mode
- [ ] **T3D3** `src/sync/import.ts` — `importDir(path)` reads `.tre-mem/`, upserts via content_hash, populates local sidecar
- [ ] **T3D3** `tre import [--from .tre-mem]` CLI; auto-skips already-imported files via `import_state`
- [ ] **T3D4** `src/sync/redact.ts` — regex pack (AWS keys, OpenAI keys, JWTs, private SSH keys); `tre export` blocks + reports any match unless `--force`
- [ ] **T3D4** `.tre-mem/.shareignore` parser (gitignore syntax, applied to observation title+body)
- [ ] **T3D5** Two-dev E2E rehearsal: alice pins → `tre export` → `git commit/push` → bob `git pull` → `tre import` → `tre search` returns alice's pin
- [ ] **T3D5** **Checkpoint T3**: above E2E passes on real shared repo (use `multigo-android-dev` if your teammate is on it, else `tre-mem` itself)

### Week 4 — Auto-lifecycle + polish
- [ ] **T4D6** GitHub Action `actions/graduate-on-merge/action.yml` (composite, Node 20) — checkout, read merged branch's pins, append to `graduated.jsonl`, commit back to base branch
- [ ] **T4D6** Action config: `pin-filter` (default: all pins; alt: only pins with `[graduate]` in note), `commit-message` template, `dry-run` flag
- [ ] **T4D7** `tre graduate-pr <PR#> [--repo owner/name]` CLI fallback for non-GH or local dry-runs (uses `gh pr view` to fetch merge metadata)
- [ ] **T4D8** SessionStart hook v2 — runs `tre import .tre-mem` (silent, fast) if `.tre-mem/` mtime changed since last session
- [ ] **T4D8** Optional `UserPromptSubmit` hook (inspired by Lore) — inject top-K relevant pins+graduated into every prompt, scoped to current branch; gated behind `tre setup claude-code --auto-inject` so default behaviour stays conservative
- [ ] **T4D8** `tre status` v2 — adds "shared: X pins exported / Y pending import / Z redacted" line
- [ ] **T4D8** `tre setup <tool>` command (borrowed from Lore's `lore setup` UX) — `tre setup claude-code` writes the SessionStart hook to `.claude/settings.json` and (optionally) the GitHub Action workflow; ship `claude-code` first, leave `cursor` / `codex` as stubs returning "coming in V3"
- [ ] **T4D9** Retrieval v2 — graduated facts surface as their own signal in `searchBranchContext` (`graduatedSignal`, weight 0.3) so cross-branch knowledge flows naturally
- [ ] **T4D9** Demo screen-record: 2-dev split-screen, "alice pins decision → 30s later bob's Claude Code references it"
- [ ] **T4D10** Polish: README v0.2 with team workflow + GIF, `docs/MIGRATION-v1-v2.md`, version bump → `0.2.0`, CHANGELOG
- [ ] **T4D10** **Checkpoint T4 (moment of truth)**: ≥1 real team of 2+ devs uses shared memory for ≥3 days, qualitative win documented

---

## Critical files (modify / create)

**Modify:**
- `src/store/schema.sql` — schema v2 columns + `import_state` table
- `src/store/migrate.ts` — apply v1→v2 migration
- `src/store/repo.ts` — `addPin` / `graduateFact` accept content_hash, expose `listPinsForExport`, `listGraduatedForExport`, `upsertImported*`
- `src/cli.ts` — add `export`, `import`, `graduate-pr` commands; extend `status`
- `src/hooks/session-start.ts` — call `importDir` if `.tre-mem/` changed
- `src/retrieval/search.ts` + `signals.ts` — add `graduatedSignal`
- `src/mcp/tools.ts` — new MCP tool `share_status` (returns sync state for Claude Code to surface)
- `README.md`, `README.vi.md`, `CHANGELOG.md`, `package.json` (0.1.0 → 0.2.0)

**Create:**
- `src/sync/format.ts`, `src/sync/export.ts`, `src/sync/import.ts`, `src/sync/redact.ts`, `src/sync/shareignore.ts`
- `actions/graduate-on-merge/action.yml`, `actions/graduate-on-merge/src/index.ts`, `actions/graduate-on-merge/README.md`
- `docs/SYNC-FORMAT.md`, `docs/TEAM-WORKFLOW.md`, `docs/MIGRATION-v1-v2.md`
- Test files: `test/sync-export.test.ts`, `test/sync-import.test.ts`, `test/sync-redact.test.ts`, `test/sync-roundtrip.test.ts`, `test/action-graduate.test.ts`

**Reuse from v0.1 (do not reinvent):**
- `TreMemRepo.addPin/listPinsForBranch/graduateFact/listGraduated` (`src/store/repo.ts`)
- `currentBranch()` for branch slug resolution (`src/git/resolver.ts`)
- `searchBranchContext()` orchestration — only add graduated signal, don't rewrite (`src/retrieval/search.ts`)
- `runSessionStartHook` — extend, don't replace (`src/hooks/session-start.ts`)
- JSON-line stdin parsing pattern from `runSessionStartHook` for the GitHub Action input

---

## Verification (end-to-end)

1. **Unit tests** (target ≥30 new, suite stays 100% green):
   - export round-trip: pin → export JSONL → import to fresh DB → query returns identical pin
   - redaction: each regex in the pack triggers + each false-positive case passes
   - shareignore: gitignore-style patterns block matching observations
   - import idempotency: importing same file twice does not duplicate
   - schema migration: v0.1 fixture DB migrates to v2 without data loss

2. **Two-dev integration test** (manual, scripted in `scripts/two-dev-e2e.sh`):
   ```bash
   # alice
   cd /tmp/repoA && tre pin <obs> --note "use Stripe webhook v3"
   tre export && git add .tre-mem && git commit -m "share pin" && git push
   # bob
   cd /tmp/repoB && git pull && tre import
   tre search "stripe webhook" --branch feature/payment  # expects alice's pin in top-3
   ```

3. **GitHub Action E2E** (in this repo's own CI):
   - Test repo with seeded `.tre-mem/branches/feature-x.jsonl`
   - Open PR feature-x → main, merge it
   - Assert next commit on main contains `.tre-mem/graduated.jsonl` with the pins from feature-x
   - Assert action runs in <30s, posts a comment on the merged PR summarizing what graduated

4. **Privacy / safety**:
   - Seed a pin containing `sk-` prefix → `tre export` exits non-zero, prints redaction report, writes nothing
   - `tre export --force --redact-as=SECRET` replaces matches with `[REDACTED:apikey]` placeholder

5. **MCP integration** (Claude Code):
   - After `tre import`, ask Claude Code "what did alice decide about Stripe?" — expects pin content + author attribution in response

6. **Adoption metric (moment of truth)**:
   - Real team of ≥2 devs, ≥1 week usage, ≥1 documented "I knew that because of tre-mem" moment from the second dev

---

## Out of scope (V3+)

- GitLab / Bitbucket equivalents of the GitHub Action (after V2 validated)
- Web dashboard for memory observability (separate USP, not Phase 2)
- Multi-tool memory bridge (Cursor / Gemini / Codex) full integration — adapter interface partially sketched + `tre setup` stub shipped in V2, full ingest is V3
- Encrypted memory for sensitive repos (BYO-key) — wait for paid-tier signal
- LLM-distilled branch summaries — interesting but doesn't ship the team-sync moat
- Conflict-aware retrieval beyond simple "both surfaced" — defer until we see real conflicts in dogfooding

**Consciously NOT chasing Lore's surface area** (their bet, not ours):
- Postgres + pgvector + Docker Compose server stack — kills local-first
- Knowledge graph + entity extraction + D3 web UI — adds an LLM + frontend dependency for marginal demo value
- Multi-tenant workspaces + RBAC + API keys — replaced by "the repo is the workspace, git is the access control"
- Plugin SDK with lifecycle hooks — premature; we have <20 users
- SLO dashboards + Prometheus metrics + alerting — overkill for solo/small-team usage
- LLM-driven `enrich` / `consolidate` / `suggest` — cost + dependency we don't want yet
- Adaptive retrieval profiles (coding/incident/research) — branch already IS the profile in our model

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Pin leaks a secret to public repo | Redaction regex pack runs by default; `tre export` is fail-closed; `.shareignore` provides per-repo control. |
| Solo devs see no value in team features | Position v0.2 as "solo-first, team-multiplier" — every Phase 1 capability still works untouched; team features are opt-in via `tre export`. |
| JSONL merge conflicts | Append-only + content_hash as dedupe key means git's union-merge "just works"; document the one edge case (two devs edit same pin's note) with explicit resolution policy (latest tagged_at_epoch wins). |
| GitHub Action friction (yaml fatigue) | Ship a 5-line copy-paste snippet in README + a `tre init --with-action` flag that writes the workflow file. |
| Schema v1 → v2 migration breaks existing v0.1 users | Migration is additive (only new columns + new table), tested against a fixture v0.1 DB; release notes flag the upgrade explicitly. |
| Bob can't read alice's claude-mem observation body (it's on alice's laptop only) | This is by design — only pins+graduated carry their content into the shared `.tre-mem/`. The user explicitly chose this scope for privacy. Document clearly in `docs/TEAM-WORKFLOW.md`. |

---

## After Phase 1 feedback (today's dogfeeding session)

Before starting T3D1, capture feedback from teammate dogfeeding into `docs/PHASE1-FEEDBACK.md`. If feedback surfaces a critical Phase 1 bug or UX gap that would undermine Phase 2's "team adoption" story, fix it in v0.1.x patches first — don't paper over with Phase 2.

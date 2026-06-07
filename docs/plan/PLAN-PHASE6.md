# tre-mem Phase 6 — "The Grove" (contributor graph, leaderboard & viral share)

> Sibling plan to [`PLAN.md`](../../PLAN.md) (v0.1), [`PLAN-PHASE2.md`](./PLAN-PHASE2.md) (v0.2–v0.4),
> [`PLAN-PHASE3.md`](./PLAN-PHASE3.md) (v0.5), [`PLAN-PHASE4.md`](./PLAN-PHASE4.md) (v0.6),
> [`PLAN-PHASE5.md`](./PLAN-PHASE5.md) (v0.7.x). This file is the **Phase 6 SSOT** (v0.9.0;
> rebased onto the v0.8.0 bamboo identity).

## Context

Through v0.7, tre-mem makes a team's git-shared memory _legible_ (`tre web`: Overview / Team
memory / Search). Phase 6 makes it **emotional and viral**: a second-brain, Obsidian-style force
graph of the repo — the trunk (graduated repo-wide facts), the branches, and the **contributors**
who grew them — plus a "best contributor" leaderboard with playful bamboo badges and a one-click
shareable grove card.

**Why it was feasible with no migration:** every committed `.tre-mem/` JSONL record
(`PinRecord` / `GraduatedRecord` in `src/sync/format.ts`) already carries `author`, populated from
`git config user.name` at `tre share` / graduate time. The sidecar DB has no author column and the
web layer read only the DB — so the new feature reads the JSONL directly via a new read-only reader.

**Decisions locked with owner:** ship all four surfaces (graph, leaderboard, share card, time-lapse);
solo/unshared repos fall back to `git log` authors so the grove is never empty; full gamification
(value score + badges & streaks).

## Tasks

- [x] **Read-only JSONL reader** — `src/sync/read.ts` (`readSyncRecords` / `readSyncDir`), reusing
      `parseSyncLine` + layout helpers. Test: `test/sync-read.test.ts`.
- [x] **Grove core** — `src/web/grove.ts`: `aggregateContributors` (value score = pins×1 +
      graduated×3, badges/streaks), `buildGraph`, `buildGitContributors` + `buildGitGraph` (fallback).
      `branchAuthors()` git helper in `src/git/identity.ts`. Test: `test/web-grove.test.ts`.
- [x] **Endpoints** — `GET /api/contributors` and `GET /api/graph` added to `ROUTES` in
      `src/web/api.ts`; project-scoped; `?fallback=git` (default on) when nothing is attributed.
- [x] **Grove tab + leaderboard** — `web/lib.tsx` types, `web/app.tsx` tab, `web/views/Grove.tsx` +
      `Leaderboard.tsx` (badges, drill into Branch detail).
- [x] **Graph canvas** — `web/views/GraphCanvas.tsx`: `d3-force` simulation + HTML canvas, theme
      tokens, bamboo sizing, hover tooltip, click-to-drill, `cutoffEpoch` for time-lapse.
- [x] **Share card + time-lapse** — `web/views/ShareCard.tsx` (canvas → PNG) and the time-lapse
      scrubber/playback in `Grove.tsx`.
- [x] **Docs + release** — `docs/WEB-UI.md` (Grove tab + endpoints), `CHANGELOG.md` `[0.9.0]`,
      version bump `package.json` + `src/version.ts` → `0.9.0`.

## Notes

- Graph rendering uses `d3-force` (force sim only) + a hand-rolled canvas renderer — chosen over
  cytoscape (~350 KB) and react-force-graph-2d (~80–120 KB) to honor the dependency-light ethos.
  Bundle add ≈ 13 KB; SPA raw ≈ 243 KB.
- Edge kinds: `authored` (contributor→fact), `lives_on` (fact→branch), `graduates_into`
  (branch→root), `committed` (contributor→branch, git-fallback only).

# tre-mem — 2-minute demo script

> Goal: prove "same question, different branch, different context" in **120
> seconds** using a real Android project. This is the T2D10 demo deliverable.

## What we show

A developer asks the same question on two branches of the same repo. With raw
claude-mem the answer would be identical (memory is flat per project). With
`tre-mem` the answer flips because branch-aware retrieval surfaces the
observation that was authored on the active branch.

## Repo + branches (already prepared from T2D9)

- Repo: `/Users/rumnv/Documents/source/android/multigo-android-dev`
- Branches with seeded memory:
  - `feature/test_tre_mem` → 1 observation about **AccountManager** region scope
  - `feature/test_tre_mem_2` → 1 observation about **BMOtpTextView** keyboard handling
  - `develop` → 36 prior observations (background noise)
- Sidecar DB `~/.tre-mem/tre-mem.db` already has the branch tags for these.

Magic query: `"AccountManager region scope"` (verified to flip top-1 between
the two branches in T2D9).

## Pre-flight (run BEFORE recording)

```bash
# Repo cwd
cd /Users/rumnv/Documents/source/android/multigo-android-dev

# Sanity-check tre is on PATH and points at the 0.1.0 build
tre --version                      # expect: tre/0.1.0

# Sanity-check the seeded data is still there
tre list-branches --project multigo-android-dev
# expect roughly:
#   develop                36
#   feature/test_tre_mem    1
#   feature/test_tre_mem_2  1

# Dry-run the flip once silently so you know it works on the day
git checkout feature/test_tre_mem
tre search "AccountManager region scope" --k 3   # top-1 = #1033, total ≈ 1.000

git checkout feature/test_tre_mem_2
tre search "AccountManager region scope" --k 3   # top-1 = #1034, total ≈ 0.600

# Reset to the starting branch for the real take
git checkout feature/test_tre_mem
clear
```

Terminal settings (mac default):

- Font size 18+ so the screen-record reads on mobile.
- Make the window ~120 cols wide so the breakdown line doesn't wrap.
- Single terminal tab is enough for v1. (Optional split-pane with Claude Code
  on the right if you want the "money shot" — see scene 5.)

Recorder: **QuickTime → File → New Screen Recording** is fine for v1. For a
polished cut, use OBS or Tella with the cursor highlight on.

## Scene-by-scene (with timings)

### Scene 1 — Hook (0:00 → 0:15)

**On screen**: a clean terminal showing the repo + the bamboo banner from
`tre --help`, or just a title slide `tre-mem · branch-aware memory`.

**Voice-over (or caption)**:

> "Same question. Two branches. Watch what happens to the answer when memory
> understands the branch you're working on."

### Scene 2 — Establish the setup (0:15 → 0:35)

**Run, in order, narrating each line briefly**:

```bash
git branch --show-current
# → feature/test_tre_mem

tre status
# → cwd / project / branch / branch_tag rows / branches with tags
```

**Voice-over**:

> "I'm in a real Android repo on a feature branch. tre-mem already knows the
> project, the active branch, and how many observations it has tagged on each
> branch — including 36 from `develop` that we want it to ignore."

### Scene 3 — Branch 1: "AccountManager" wins (0:35 → 1:00)

```bash
tre search "AccountManager region scope" --k 3
```

**Expected output (key line — point at it)**:

```
  [1.000] #1033  ...AccountManager...
         sem 0.40  branch 0.40  rec 0.20  pin 0.00
```

**Voice-over**:

> "Top hit: the AccountManager observation. Score 1.0 — semantic match plus
> the branch boost because this fact was authored on _this_ branch."

### Scene 4 — The flip (1:00 → 1:35)

```bash
git checkout feature/test_tre_mem_2
# → switched

tre status
# → branch:  feature/test_tre_mem_2

tre search "AccountManager region scope" --k 3
```

**Expected output (point at it)**:

```
  [0.600] #1034  ...BMOtpTextView...
         sem 0.00  branch 0.40  rec 0.20  pin 0.00

  [0.600] #1033  ...AccountManager...
         sem 0.40  branch 0.00  rec 0.20  pin 0.00
```

**Voice-over**:

> "Same query. I just switched branches. The branch-local observation
> jumps over the higher-semantic AccountManager hit because _this_ branch
> doesn't own that fact anymore. That's the 0.40 branch boost flipping the
> ranking."

### Scene 5 — Money shot in Claude Code (1:35 → 1:55) — optional but recommended

Split the screen. Left: terminal still on `feature/test_tre_mem_2`. Right:
Claude Code session in the same repo.

**Type into Claude Code**:

> "What were we working on in this branch?"

**Expected**: Claude calls the `tre-mem.get_branch_context` MCP tool and
answers in terms of **BMOtpTextView**, not AccountManager. (Check `/mcp` shows
`tre-mem · connected · 7 tools` before recording.)

Then `git checkout feature/test_tre_mem` in the terminal, ask the same
question again, and watch Claude switch to **AccountManager**.

**Voice-over**:

> "And inside Claude Code, the AI assistant follows the branch instead of the
> repo. One MCP server. Five tools. Same answer engine, branch-aware."

### Scene 6 — Wrap (1:55 → 2:00)

**On screen**: end card with the tagline.

> **tre-mem** — shared roots. branch-aware memory.
> `npm i -g tre-mem` · github.com/rumitvn/tre-mem

## Caption track (if no voice-over)

| Time | Caption                                                      |
| ---- | ------------------------------------------------------------ |
| 0:00 | Same question. Two branches. Different answer.               |
| 0:15 | Real Android repo. Two test branches, seeded memory.         |
| 0:35 | Branch 1: "feature/test_tre_mem" — AccountManager fact wins. |
| 1:00 | Switch to "feature/test_tre_mem_2". Same query.              |
| 1:15 | The branch boost flips the ranking.                          |
| 1:35 | Same flip inside Claude Code via MCP.                        |
| 1:55 | tre-mem — shared roots. branch-aware memory.                 |

## Post-record checklist

- [ ] Top-1 visibly flips between scenes 3 and 4.
- [ ] Score breakdown line is readable (not wrapped, font ≥ 18pt).
- [ ] No secrets / `~/.claude.json` / other repos on screen.
- [ ] Cursor highlights / zoom-ins on the `[score]` and `branch 0.40` lines.
- [ ] Trim to ≤ 120 s. Export 1080p H.264.
- [ ] Drop the file at `docs/demo.mp4` (gitignored) and link from
      `CHANGELOG.md` + `README.md` once it's hosted.

## If something breaks live

| Symptom                                 | Quick fix                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tre status` shows `tagged_on_branch=0` | Re-run `tre backfill /Users/rumnv/Documents/source/android/multigo-android-dev`                                                                     |
| Search returns no hits                  | Confirm `~/.claude-mem/claude-mem.db` exists; re-check spelling of the query                                                                        |
| Top-1 doesn't flip                      | The seeded observations may have been re-ingested under different ids — re-run the pre-flight dry-run and update the expected `#id`s in this script |
| Claude Code doesn't call the MCP tool   | `/mcp` → reconnect tre-mem; check `claude mcp list` includes it                                                                                     |
| Branch boost not applied                | `tre list-branches --project multigo-android-dev` to confirm the row count per branch is non-zero                                                   |

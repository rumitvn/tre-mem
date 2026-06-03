# tre-mem — Claude Code hooks

`tre-mem` ships one Claude Code hook today: **SessionStart**. It refreshes the
`branch_state` row for the current `cwd` so retrieval always knows which branch
the editor is on, even between watcher cycles.

## What the hook does

On every Claude Code session start (`startup`, `resume`, or `clear`):

1. Read the hook payload (JSON) from stdin.
2. Resolve the current branch for `payload.cwd` via `git symbolic-ref`.
3. Upsert `branch_state(cwd, project, current_branch, updated_at_epoch)` in
   `~/.tre-mem/tre-mem.db`.
4. Emit a `SessionStart` hook response with `additionalContext` summarising
   the project, branch, and tagged observation counts so Claude sees them at
   the top of the session.

The hook never blocks the session: on any error it writes a single
`{"continue": true}` JSON line and exits 0.

## Prerequisites

- `tre` binary on PATH (`pnpm link --global` from this repo, or
  `npm i -g tre-mem` once published).
- `tre init` has been run at least once (creates `~/.tre-mem/tre-mem.db`).
  The hook itself also runs migrations defensively on every invocation.

## Register globally (`~/.claude/settings.json`)

Add to your user-level Claude Code settings. This activates the hook for every
project you open.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "tre hook session-start"
          }
        ]
      }
    ]
  }
}
```

## Register per-project (`.claude/settings.json`)

Same shape, lives at `<repo>/.claude/settings.json`. Use this if you only want
`tre-mem` active in a specific repo.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "tre hook session-start"
          }
        ]
      }
    ]
  }
}
```

## Verify

```bash
echo '{"hook_event_name":"SessionStart","source":"startup","cwd":"'$(pwd)'"}' \
  | tre hook session-start
```

Expected: a single-line JSON response like

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "tre-mem: project=<your-repo> branch=<your-branch> tagged_on_branch=N tagged_on_project=M (source=startup)"
  },
  "systemMessage": "…"
}
```

Then check that `branch_state` was upserted:

```bash
tre status
# → cwd / project / branch / branch_tag rows (project): N
```

## Troubleshooting

| Symptom                     | Likely cause            | Fix                                                                                     |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| Hook prints nothing         | `tre` not on PATH       | Add `pnpm bin -g` to your `PATH`, or use an absolute path in `command`.                 |
| `branch=(no-git)`           | `cwd` is not a git repo | Expected outside repos; remove the hook for those projects or ignore.                   |
| `tagged_on_branch=0`        | No backfill yet         | Run `tre backfill` once in each repo.                                                   |
| Multiple SessionStart hooks | Settings merge          | Only one `tre hook session-start` command is needed; duplicates are harmless but noisy. |

## What the hook does _not_ do

- It does not modify `~/.claude-mem/claude-mem.db` (read-only adapter only).
- It does not tag observations directly — that is `tre backfill`'s job for
  history, and the upstream ingest pipeline plus the watcher for live work.
- It does not start the MCP server. That is wired separately via
  `mcpServers.tre-mem` in `~/.claude.json` (see `PLAN.md` § T2D9).

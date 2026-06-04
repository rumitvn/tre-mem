# .tre-mem/ — shared AI memory (tre-mem)

This directory is **committed to the repo** and travels through git. It carries the
team's pinned decisions and graduated facts so every teammate's AI assistant inherits
them on `git clone`.

- `branches/<branch>.jsonl` — pins scoped to a branch (append-only, one JSON per line)
- `graduated.jsonl` — facts promoted to repo-wide knowledge
- `.shareignore` — text patterns that block matching pins from being exported

## Workflow

```bash
tre export          # write your pins here, then: git add .tre-mem && git commit && git push
tre import          # after git pull: pull teammates' pins into your local sidecar
```

Raw observations stay private on each machine — only pins + graduated facts are shared.
`tre export` is fail-closed: it refuses to write detected secrets unless you pass `--force`.

See the format spec: https://github.com/rumitvn/tre-mem/blob/main/docs/SYNC-FORMAT.md

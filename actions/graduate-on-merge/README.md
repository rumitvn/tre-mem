# tre-mem — graduate on merge

A composite GitHub Action that runs when a PR merges and promotes that branch's
pinned decisions into repo-wide **graduated facts** in `.tre-mem/graduated.jsonl`.
This closes the auto-lifecycle loop: pin a decision on a feature branch, and when
the PR merges, it automatically becomes knowledge every teammate inherits.

## Usage

Add `.github/workflows/tre-mem-graduate.yml` to your repo:

```yaml
name: tre-mem graduate
on:
  pull_request:
    types: [closed]

permissions:
  contents: write

jobs:
  graduate:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.base.ref }}
      - uses: rumitvn/tre-mem/actions/graduate-on-merge@v0.2
```

That's the whole setup. On every merged PR, the action:

1. reads `.tre-mem/branches/<merged-branch>.jsonl`,
2. appends each pin (that references an observation) to `graduated.jsonl`
   (deduped on `content_hash`, so re-runs are no-ops),
3. commits the change back to the base branch.

## Inputs

| Input            | Default                                        | Description                                     |
| ---------------- | ---------------------------------------------- | ----------------------------------------------- |
| `pr-number`      | the triggering PR                              | PR to graduate                                  |
| `branch`         | —                                              | graduate this branch directly (skips PR lookup) |
| `dir`            | `.tre-mem`                                     | committed sync directory                        |
| `version`        | `latest`                                       | tre-mem npm version to run                      |
| `commit-message` | `chore(tre-mem): graduate pins from merged PR` | commit message                                  |
| `dry-run`        | `false`                                        | compute without committing                      |

## Requirements

- `permissions: contents: write` (to commit graduated facts back)
- Checkout the **base** ref so the commit lands on the right branch
- The runner has Node 20 (the action sets it up)

## Non-GitHub flows

No GitHub? Run the same logic locally or in any CI:

```bash
tre graduate-pr <merged-branch> --branch <merged-branch>
git add .tre-mem && git commit -m "graduate pins" && git push
```

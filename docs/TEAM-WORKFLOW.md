# Team workflow — sharing AI memory through git

tre-mem v0.2 turns the git workflow your team already uses into the transport
for shared AI memory. This guide covers setup, the day-to-day loop, the privacy
model, and the auto-lifecycle.

## Mental model

```
   private (per developer)                 shared (committed to the repo)
   ┌─────────────────────┐                 ┌──────────────────────────────┐
   │ ~/.claude-mem/       │  observations  │ repo/.tre-mem/                │
   │   raw observations   │  never leave    │   branches/<branch>.jsonl    │  ← pins
   │ ~/.tre-mem/          │  ───────────►   │   graduated.jsonl            │  ← repo-wide facts
   │   sidecar DB         │  pins + grad    │   .shareignore  README.md    │
   └─────────────────────┘                 └──────────────────────────────┘
```

- **Raw observations are private.** They stay in each developer's
  `~/.claude-mem/`. Only the curated slice — **pins** and **graduated facts** —
  is written to the committed `.tre-mem/` directory.
- **Pins** are branch-scoped decisions you explicitly mark. **Graduated facts**
  are pins promoted to repo-wide knowledge (usually when a PR merges).

## One-time setup

```bash
npm i -g tre-mem
tre setup claude-code                    # SessionStart hook (auto-import on pull)
# optional: graduate pins automatically when a branch merges (no CI, any provider)
tre setup claude-code --with-hook
# optional: also inject branch memory into every prompt
tre setup claude-code --auto-inject
```

Works with **any git host** — GitHub, GitLab, Bitbucket, or a plain bare remote.
Sharing is just files in your repo; nothing here is GitHub-specific. (`--with-hook`
installs a local `post-merge` git hook — see [Graduate on merge](#graduate-on-merge)
for that and the CI alternatives.)

## The daily loop

### Share a decision — one command

```bash
# while working on a branch
tre pin 1234 --note "use Stripe webhook v3 for idempotency"
tre share                               # export + git add + commit + push, in one step
```

`tre share` writes your pins to `.tre-mem/`, commits them, and pushes to your
team's remote. It's idempotent (re-running shares nothing new), and degrades
honestly: `--no-push` to commit only, `--no-commit` to stage only, `--all` to
share every branch with pins, `--dry-run` to preview. If your branch has no
upstream yet, it commits and prints the exact `git push -u …` to run.

> `tre export` still exists as the low-level "write files only" primitive if you
> prefer to drive git yourself.

### Receive teammates' decisions

```bash
git pull
# nothing else to do — the SessionStart hook auto-imports on your next session
```

To import manually (or in CI):

```bash
tre import
```

Imported pins surface in `tre search` (and in Claude Code via MCP) tagged
`[shared]`, even though you don't have the underlying observation locally — the
title/body snapshot travels in the JSONL.

### Graduate on merge

Graduating promotes a merged branch's pins to repo-wide `graduated.jsonl` (which
then surfaces on **every** branch, weight 0.3). Pick whichever fits your setup —
they all produce the same commit:

**A. Local git hook (no CI, any provider).** `tre setup … --with-hook` installs a
`post-merge` hook that runs `tre graduate-merge` after every merge/pull — it
recovers the merged branch from the merge commit and graduates its pins:

```bash
tre setup claude-code --with-hook
# then, normally: git checkout main && git merge feature/payment
#   → pins from feature/payment land in graduated.jsonl; run `tre share` to publish
```

**B. By hand (any provider).**

```bash
tre graduate-pr feature/payment --branch feature/payment   # graduate a branch directly
tre graduate-pr 42                                          # or resolve GitHub PR #42 via gh
tre share                                                  # publish graduated.jsonl
```

**C. CI.** Run `tre graduate-pr` from your pipeline, reading the branch from CI env:

```yaml
# GitLab CI (.gitlab-ci.yml) — runs on the default branch after a merge
graduate:
  rule: if: '$CI_COMMIT_BRANCH == "main"'
  script:
    - npx tre-mem graduate-pr --branch "$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME"
    - git add .tre-mem && git commit -m "graduate merged pins" && git push
```

```yaml
# Bitbucket Pipelines (bitbucket-pipelines.yml)
pipelines:
  branches:
    main:
      - step:
          script:
            - npx tre-mem graduate-pr --branch "$BITBUCKET_BRANCH"
            - git add .tre-mem && git commit -m "graduate merged pins" && git push
```

`tre graduate-pr` reads the branch from `--branch`, then `gh` (GitHub), then CI env
(`GITHUB_HEAD_REF` / `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` / `BITBUCKET_BRANCH` / …)
— so it never hard-depends on GitHub.

> tre-mem deliberately ships **no GitHub Action**: graduation is git-native (the local
> post-merge hook) or a few lines in whatever CI you already run. Nothing binds your
> team's memory to one vendor's CI.

## Privacy & safety

- **Fail-closed export.** `tre export` scans pin/graduated text for secrets
  (private keys, OpenAI/Anthropic/AWS/GitHub/Google/Slack tokens, JWTs). On a
  match it **writes nothing** and prints a masked report. Pass `--force` to
  replace matches with `[REDACTED:*]` and proceed.
- **`.tre-mem/.shareignore`.** A per-repo glob blocklist (gitignore-ish) matched
  against a pin's note + title + body. Anything matching is excluded from export.
  A starter file is scaffolded on first export.
- **You review everything in the PR.** Because `.tre-mem/` is committed JSONL,
  shared memory shows up as a normal, human-readable diff.

## Conflicts — "keep both", automatically

`.tre-mem/.gitattributes` ships with `*.jsonl merge=union`, so when two teammates
share at the same time git **keeps both sides** instead of raising a conflict.
Files are append-only and rows dedupe on `content_hash`, so the merged result is
correct: any duplicate collapses to one row on `tre import`. The one genuine edge
case — two devs editing the _same_ pin's note — produces two rows; import resolves
by latest `tagged_at_epoch`. Unparseable lines (e.g. a teammate on a newer schema,
or a stray conflict marker) are skipped on import, never dropped from the file.

`tre share` scaffolds the `.gitattributes` for you; repos initialized before v0.7
get it backfilled on the next `tre share`.

## Migrating from v0.1

Automatic and lossless — see [MIGRATION-v1-v2.md](./MIGRATION-v1-v2.md).

## Reference

- On-disk format: [SYNC-FORMAT.md](./SYNC-FORMAT.md)
- Hooks: [HOOKS.md](./HOOKS.md)

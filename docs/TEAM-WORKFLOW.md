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
tre setup claude-code --with-action     # SessionStart hook + graduate workflow
# optional: also inject branch memory into every prompt
tre setup claude-code --auto-inject
```

`--with-action` writes `.github/workflows/tre-mem-graduate.yml`. Commit it so
graduation runs for the whole team.

## The daily loop

### Share a decision

```bash
# while working on a branch
tre pin 1234 --note "use Stripe webhook v3 for idempotency"
tre export                              # writes .tre-mem/branches/<branch>.jsonl
git add .tre-mem && git commit -m "share: webhook decision" && git push
```

`tre export` is idempotent — re-running adds nothing new. Use `--all` to export
every branch with pins, `--dry-run` to preview.

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

When a PR merges, the `graduate-on-merge` Action promotes that branch's pins to
`graduated.jsonl` automatically. To do it by hand:

```bash
tre graduate-pr 42                      # resolves PR #42 → its branch via gh
tre graduate-pr feature/payment --branch feature/payment   # or graduate a branch directly
git add .tre-mem && git commit -m "graduate merged pins" && git push
```

Graduated facts surface on **every** branch (weight 0.3), so repo-wide decisions
flow across feature branches.

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

## Conflicts

Files are append-only and rows dedupe on `content_hash`, so git union-merges
"just work". The one genuine edge case — two devs editing the _same_ pin's note
— produces two rows; import resolves by latest `tagged_at_epoch`. Unparseable
lines (e.g. a teammate on a newer schema) are preserved verbatim, never dropped.

## Migrating from v0.1

Automatic and lossless — see [MIGRATION-v1-v2.md](./MIGRATION-v1-v2.md).

## Reference

- On-disk format: [SYNC-FORMAT.md](./SYNC-FORMAT.md)
- The GitHub Action: [../actions/graduate-on-merge/README.md](../actions/graduate-on-merge/README.md)
- Hooks: [HOOKS.md](./HOOKS.md)

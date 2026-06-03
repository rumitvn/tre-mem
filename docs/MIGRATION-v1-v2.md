# Migrating tre-mem v0.1 → v0.2

**TL;DR — there is nothing to do.** The schema migration is additive and
idempotent. The first time you run any `tre` command on v0.2, your existing
`~/.tre-mem/tre-mem.db` upgrades in place with no data loss.

## What changes

Schema v1 → v2 is **additive only**:

| Change                        | Table                     | Purpose                                                |
| ----------------------------- | ------------------------- | ------------------------------------------------------ |
| `+ content_hash TEXT`         | `branch_pin`, `graduated` | dedupe key for git-shared rows                         |
| `+ shared_at_epoch INTEGER`   | `branch_pin`, `graduated` | marks a row as exported/shared                         |
| `+ title TEXT`, `+ body TEXT` | `branch_pin`, `graduated` | snapshot so imported rows are self-contained           |
| `+ import_state` table        | —                         | tracks per-file import SHA for idempotent `tre import` |

No columns are dropped or renamed. No existing rows are rewritten — the new
columns are `NULL` on your existing pins until the next `tre export`.

## How it runs

`migrate()` runs defensively at the start of every CLI command. The v2 step is
guarded two ways:

1. **Version gate** — `schema_versions` records v2; the migration only runs when
   the DB is below v2.
2. **Column-existence guard** — each `ALTER TABLE ADD COLUMN` is skipped if the
   column already exists, so a half-applied or hand-edited DB self-heals.

It is safe to run repeatedly.

## Verifying

```bash
tre status
# the new "shared: …" line confirms you're on v0.2
```

Or inspect directly:

```bash
sqlite3 ~/.tre-mem/tre-mem.db "SELECT MAX(version) FROM schema_versions;"   # → 2
sqlite3 ~/.tre-mem/tre-mem.db "PRAGMA table_info(branch_pin);"              # shows content_hash, title, body, shared_at_epoch
```

## Rolling back

v0.2 only _adds_ columns/tables, so a v0.1 binary keeps working against a
v2 database (it ignores the extra columns). If you want a clean v1 snapshot,
back up the file before upgrading:

```bash
cp ~/.tre-mem/tre-mem.db ~/.tre-mem/tre-mem.v1.bak
```

## Team rollout

The shared `.tre-mem/` directory is forward-compatible: `tre export` preserves
JSONL lines it cannot parse (e.g. a newer schema from a teammate ahead of you),
so a mixed-version team never loses each other's rows. Upgrade at your own pace.

# tre-mem Sync Format (`.tre-mem/`)

> Frozen spec for the committed, git-shared memory directory introduced in Phase 2 (v0.2).
> Format `schema` version: **1**. This document is the source of truth; `src/sync/format.ts` is its implementation.

## Why this exists

Phase 1 kept all memory private in each developer's `~/.tre-mem/tre-mem.db`. Phase 2 shares the
_curated_ slice — pins and graduated facts — by committing it to the repo itself. The transport is
git: `tre export` writes JSONL into `.tre-mem/`, you commit and push, your teammate pulls and runs
`tre import`. No server, no API keys.

Raw observations stay private. Only **pins** and **graduated facts** carry their content into the
shared directory.

## On-disk layout

```
.tre-mem/
├── README.md                 # auto-generated, explains the dir to humans
├── .shareignore              # gitignore-style patterns blocked from export (T3D4)
├── branches/
│   └── <branch-slug>.jsonl   # one row per pinned observation on that branch
└── graduated.jsonl           # one row per graduated fact, append-only
```

**Branch slug**: the branch name with filesystem-unsafe characters replaced so `feature/payment`
becomes `feature-payment.jsonl`. The original branch name is preserved verbatim inside each row's
`branch` field — the slug is only for the filename.

## Record format

Every line in every `.jsonl` file is one independent JSON object (JSON Lines). Files are
**append-only**, so a `git merge` of two devs' additions is a clean union-merge. Keys are emitted in
a fixed order for stable, reviewable diffs.

### Common fields

| Field          | Type                     | Notes                                                                                |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `schema`       | number                   | Format version. Currently `1`. A reader MUST reject versions it does not understand. |
| `kind`         | `"pin"` \| `"graduated"` | Discriminates the row shape.                                                         |
| `content_hash` | string                   | SHA-256 (64 hex chars) over the row's _semantic content only_. The dedupe key.       |
| `author`       | string \| null           | Who exported the row (best-effort, from git config). Excluded from the hash.         |

### `pin` record

```json
{
  "schema": 1,
  "kind": "pin",
  "content_hash": "<sha256>",
  "project": "tre-mem",
  "branch": "feature/payment",
  "observation_id": 42,
  "note": "use Stripe webhook v3",
  "title": "Stripe webhook decision",
  "body": "We standardized on webhook v3 for idempotency.",
  "author": "alice",
  "tagged_at_epoch": 1780000000
}
```

| Field             | Type           |                                                                                                                                           |
| ----------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `project`         | string         | claude-mem project key.                                                                                                                   |
| `branch`          | string         | Branch the pin belongs to (verbatim).                                                                                                     |
| `observation_id`  | number \| null | Upstream claude-mem observation id, or null for free-text pins.                                                                           |
| `note`            | string \| null | The curator's note.                                                                                                                       |
| `title` / `body`  | string \| null | Snapshot of the observation content, so the row is self-contained on the receiving dev's machine (who does not have the raw observation). |
| `tagged_at_epoch` | number         | Pin creation time (seconds). Tie-breaker for conflict policy; excluded from the hash.                                                     |

### `graduated` record

```json
{
  "schema": 1,
  "kind": "graduated",
  "content_hash": "<sha256>",
  "project": "tre-mem",
  "observation_id": 99,
  "graduated_from_branch": "feature/payment",
  "title": "Stripe is the payment provider",
  "body": "Graduated repo-wide.",
  "author": "bob",
  "graduated_at_epoch": 1780000500
}
```

| Field                   | Type   |                                                                |
| ----------------------- | ------ | -------------------------------------------------------------- |
| `observation_id`        | number | Upstream observation id (graduated facts are never free-text). |
| `graduated_from_branch` | string | Branch the fact was promoted from.                             |
| `graduated_at_epoch`    | number | Graduation time (seconds). Excluded from the hash.             |

## Content hashing (dedupe semantics)

`content_hash` is SHA-256 of the row's identity fields joined by the ASCII Unit Separator
(`0x1f`), with `null` encoded as a single space. **Author and timestamps are excluded** — so when
two developers independently pin the same observation with the same note on the same branch, both
rows hash identically and `tre import` keeps exactly one.

- **pin** identity: `pin · project · branch · observation_id · note · title · body`
- **graduated** identity: `graduated · project · observation_id · graduated_from_branch · title · body`

Changing the note, the branch, or the snapshot content yields a new hash (a genuinely different
fact). Re-exporting the same fact yields the same hash (idempotent).

## Conflict policy

Append-only + content-hash dedupe means git's union-merge "just works" for the common case. The one
genuine edge case — two devs edit the _same_ pin's note — produces two rows with different hashes.
Resolution policy: **latest `tagged_at_epoch` wins** at import time; the older row is ignored but
left in the file (the file stays append-only; import resolves at read time).

## Versioning

The `schema` field is per-row, not per-file, so a future v2 can introduce new record shapes
incrementally. Readers reject unknown `schema` values loudly rather than silently dropping data. Any
format change ships with a bump to `SYNC_SCHEMA_VERSION` and a note in `docs/MIGRATION-v1-v2.md`.

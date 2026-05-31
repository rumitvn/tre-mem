-- tre-mem sidecar schema v1
-- Lives at ~/.tre-mem/tre-mem.db. Read-only adapter on top of ~/.claude-mem/claude-mem.db.
-- All FK references to claude-mem are logical (no cross-database FK enforcement).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branch_tag (
  observation_id   INTEGER PRIMARY KEY,
  project          TEXT    NOT NULL,
  branch           TEXT    NOT NULL,
  tagged_at_epoch  INTEGER NOT NULL,
  source           TEXT    NOT NULL CHECK (source IN ('live', 'reflog-backfill', 'manual'))
);
CREATE INDEX IF NOT EXISTS idx_branch_tag_branch
  ON branch_tag(project, branch);
CREATE INDEX IF NOT EXISTS idx_branch_tag_tagged_at
  ON branch_tag(project, branch, tagged_at_epoch DESC);

CREATE TABLE IF NOT EXISTS branch_pin (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project           TEXT    NOT NULL,
  branch            TEXT    NOT NULL,
  observation_id    INTEGER,
  note              TEXT,
  created_at_epoch  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branch_pin_branch
  ON branch_pin(project, branch);

CREATE TABLE IF NOT EXISTS graduated (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  project                TEXT    NOT NULL,
  observation_id         INTEGER NOT NULL,
  graduated_from_branch  TEXT    NOT NULL,
  graduated_at_epoch     INTEGER NOT NULL,
  UNIQUE(project, observation_id)
);
CREATE INDEX IF NOT EXISTS idx_graduated_project
  ON graduated(project);

CREATE TABLE IF NOT EXISTS branch_state (
  cwd               TEXT    PRIMARY KEY,
  project           TEXT    NOT NULL,
  current_branch    TEXT    NOT NULL,
  updated_at_epoch  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branch_state_project
  ON branch_state(project);

CREATE TABLE IF NOT EXISTS schema_versions (
  version          INTEGER PRIMARY KEY,
  applied_at_epoch INTEGER NOT NULL
);

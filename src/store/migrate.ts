import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DB_BUSY_TIMEOUT_MS, TRE_MEM_DB_PATH } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CURRENT_SCHEMA_VERSION = 3;

const V1_SCHEMA_FILE = join(__dirname, 'schema.sql');

/**
 * Schema v2 (Phase 2 — git-native team sync). Additive only: nullable columns
 * on existing tables plus a new `import_state` table. Safe to apply to a
 * populated v0.1 database without data loss.
 */
const V2_COLUMNS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  {
    table: 'branch_pin',
    column: 'content_hash',
    ddl: 'ALTER TABLE branch_pin ADD COLUMN content_hash TEXT',
  },
  {
    table: 'branch_pin',
    column: 'shared_at_epoch',
    ddl: 'ALTER TABLE branch_pin ADD COLUMN shared_at_epoch INTEGER',
  },
  // title/body snapshots make imported rows self-contained for retrieval on a
  // teammate's machine, where the underlying claude-mem observation is absent.
  { table: 'branch_pin', column: 'title', ddl: 'ALTER TABLE branch_pin ADD COLUMN title TEXT' },
  { table: 'branch_pin', column: 'body', ddl: 'ALTER TABLE branch_pin ADD COLUMN body TEXT' },
  {
    table: 'graduated',
    column: 'content_hash',
    ddl: 'ALTER TABLE graduated ADD COLUMN content_hash TEXT',
  },
  {
    table: 'graduated',
    column: 'shared_at_epoch',
    ddl: 'ALTER TABLE graduated ADD COLUMN shared_at_epoch INTEGER',
  },
  { table: 'graduated', column: 'title', ddl: 'ALTER TABLE graduated ADD COLUMN title TEXT' },
  { table: 'graduated', column: 'body', ddl: 'ALTER TABLE graduated ADD COLUMN body TEXT' },
];

const V2_IMPORT_STATE = `
  CREATE TABLE IF NOT EXISTS import_state (
    file_path         TEXT    PRIMARY KEY,
    last_sha          TEXT    NOT NULL,
    imported_at_epoch INTEGER NOT NULL
  );
`;

/**
 * Schema v3 (Phase 7 — cross-clone memory). Additive only: a single nullable
 * `remote` column on `branch_state` recording the canonical git remote slug of
 * each working directory. Lets reads union memory across clones that share a
 * remote. No backfill — existing rows stay `NULL` (single-project behavior) and
 * self-heal on the next session-start write.
 */
const V3_COLUMNS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  {
    table: 'branch_state',
    column: 'remote',
    ddl: 'ALTER TABLE branch_state ADD COLUMN remote TEXT',
  },
];

/**
 * Reconcile the additive v3 column + index. Idempotent (guarded by `columnExists`
 * / `IF NOT EXISTS`), mirroring `ensureSyncColumns` so a database that recorded
 * `schema_versions = 3` under an earlier, incomplete build self-heals.
 */
function ensureRemoteColumn(db: Database.Database): void {
  // branch_state is a v1 table, but guard anyway so a partially-seeded database
  // self-heals rather than throwing on a missing table.
  if (!tableExists(db, 'branch_state')) return;
  for (const { table, column, ddl } of V3_COLUMNS) {
    if (!columnExists(db, table, column)) db.exec(ddl);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_branch_state_remote ON branch_state(remote)');
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * Reconcile the additive v2 sync columns + import_state table + indexes.
 * Fully idempotent (guarded by `columnExists` / `IF NOT EXISTS`), so it is safe
 * to run on every migrate(). This is what self-heals databases that recorded
 * `schema_versions = 2` under an earlier, incomplete column set — e.g. a build
 * that predated the `title`/`body` columns. Without this, the `currentVersion < 2`
 * gate would never re-run the DDL and `branch_pin.title` stays missing forever.
 */
function ensureSyncColumns(db: Database.Database): void {
  for (const { table, column, ddl } of V2_COLUMNS) {
    if (!columnExists(db, table, column)) db.exec(ddl);
  }
  db.exec(V2_IMPORT_STATE);
  db.exec('CREATE INDEX IF NOT EXISTS idx_branch_pin_content_hash ON branch_pin(content_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_graduated_content_hash ON graduated(content_hash)');
}

export type MigrateResult = {
  dbPath: string;
  fromVersion: number;
  toVersion: number;
  applied: number[];
};

export function migrate(dbPath: string = TRE_MEM_DB_PATH): MigrateResult {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version          INTEGER PRIMARY KEY,
        applied_at_epoch INTEGER NOT NULL
      );
    `);

    const fromVersion = currentVersion(db);
    const applied: number[] = [];

    if (fromVersion < 1) {
      const ddl = readFileSync(V1_SCHEMA_FILE, 'utf8');
      const recordVersion = db.prepare(
        'INSERT OR IGNORE INTO schema_versions (version, applied_at_epoch) VALUES (?, ?)',
      );
      const tx = db.transaction(() => {
        db.exec(ddl);
        recordVersion.run(1, Math.floor(Date.now() / 1000));
      });
      tx();
      applied.push(1);
    }

    if (currentVersion(db) < 2) {
      const recordVersion = db.prepare(
        'INSERT OR IGNORE INTO schema_versions (version, applied_at_epoch) VALUES (?, ?)',
      );
      const tx = db.transaction(() => {
        ensureSyncColumns(db);
        recordVersion.run(2, Math.floor(Date.now() / 1000));
      });
      tx();
      applied.push(2);
    } else {
      // Already recorded as v2, but an earlier build may have done so before the
      // full column set existed. Reconcile unconditionally — idempotent, so a
      // complete database is a no-op and `applied` stays empty.
      db.transaction(() => ensureSyncColumns(db))();
    }

    if (currentVersion(db) < 3) {
      const recordVersion = db.prepare(
        'INSERT OR IGNORE INTO schema_versions (version, applied_at_epoch) VALUES (?, ?)',
      );
      const tx = db.transaction(() => {
        ensureRemoteColumn(db);
        recordVersion.run(3, Math.floor(Date.now() / 1000));
      });
      tx();
      applied.push(3);
    } else {
      // Self-heal: reconcile the v3 column/index even if v3 was recorded early.
      db.transaction(() => ensureRemoteColumn(db))();
    }

    const toVersion = currentVersion(db);
    return { dbPath, fromVersion, toVersion, applied };
  } finally {
    db.close();
  }
}

function currentVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_versions').get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

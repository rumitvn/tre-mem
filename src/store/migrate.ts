import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRE_MEM_DB_PATH } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CURRENT_SCHEMA_VERSION = 1;

const V1_SCHEMA_FILE = join(__dirname, 'schema.sql');

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

    const toVersion = currentVersion(db);
    return { dbPath, fromVersion, toVersion, applied };
  } finally {
    db.close();
  }
}

function currentVersion(db: Database.Database): number {
  const row = db
    .prepare('SELECT MAX(version) AS version FROM schema_versions')
    .get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

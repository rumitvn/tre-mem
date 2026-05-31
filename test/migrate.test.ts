import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, migrate } from '../src/store/migrate.js';

describe('migrate', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-test-'));
    dbPath = join(tmp, 'tre-mem.db');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a fresh database at v1 with all expected tables and indexes', () => {
    const result = migrate(dbPath);

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.applied).toEqual([1]);

    const db = new Database(dbPath, { readonly: true });
    try {
      const tables = listObjects(db, 'table');
      expect(tables).toEqual(
        expect.arrayContaining([
          'branch_tag',
          'branch_pin',
          'graduated',
          'branch_state',
          'schema_versions',
        ]),
      );

      const indexes = listObjects(db, 'index');
      expect(indexes).toEqual(
        expect.arrayContaining([
          'idx_branch_tag_branch',
          'idx_branch_tag_tagged_at',
          'idx_branch_pin_branch',
          'idx_graduated_project',
          'idx_branch_state_project',
        ]),
      );

      const version = db
        .prepare('SELECT MAX(version) AS v FROM schema_versions')
        .get() as { v: number };
      expect(version.v).toBe(1);
    } finally {
      db.close();
    }
  });

  it('is idempotent: re-running on a current db is a no-op', () => {
    migrate(dbPath);
    const second = migrate(dbPath);

    expect(second.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(second.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(second.applied).toEqual([]);
  });

  it('enforces the source CHECK constraint on branch_tag.source', () => {
    migrate(dbPath);
    const db = new Database(dbPath);
    try {
      const insert = db.prepare(
        'INSERT INTO branch_tag (observation_id, project, branch, tagged_at_epoch, source) VALUES (?, ?, ?, ?, ?)',
      );

      expect(() => insert.run(1, 'p', 'main', 0, 'live')).not.toThrow();
      expect(() => insert.run(2, 'p', 'main', 0, 'reflog-backfill')).not.toThrow();
      expect(() => insert.run(3, 'p', 'main', 0, 'manual')).not.toThrow();
      expect(() => insert.run(4, 'p', 'main', 0, 'bogus')).toThrow(/CHECK constraint/);
    } finally {
      db.close();
    }
  });

  it('creates the parent directory when missing', () => {
    const nestedDbPath = join(tmp, 'nested', 'dir', 'tre-mem.db');
    const result = migrate(nestedDbPath);
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

function listObjects(db: Database.Database, type: 'table' | 'index'): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'`)
      .all(type) as Array<{ name: string }>
  ).map((row) => row.name);
}

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

  it('creates a fresh database at the current version with all expected tables and indexes', () => {
    const result = migrate(dbPath);

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.applied).toEqual([1, 2]);

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
          'import_state',
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

      const version = db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as {
        v: number;
      };
      expect(version.v).toBe(CURRENT_SCHEMA_VERSION);
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

  it('adds v2 sync columns to branch_pin and graduated', () => {
    migrate(dbPath);
    const db = new Database(dbPath, { readonly: true });
    try {
      expect(columnNames(db, 'branch_pin')).toEqual(
        expect.arrayContaining(['content_hash', 'shared_at_epoch']),
      );
      expect(columnNames(db, 'graduated')).toEqual(
        expect.arrayContaining(['content_hash', 'shared_at_epoch']),
      );
    } finally {
      db.close();
    }
  });

  it('upgrades a populated v1 database to v2 without data loss', () => {
    // Simulate an existing v0.1 install: apply v1 schema only, seed a pin.
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at_epoch INTEGER NOT NULL);
      CREATE TABLE branch_pin (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, branch TEXT NOT NULL,
        observation_id INTEGER, note TEXT, created_at_epoch INTEGER NOT NULL
      );
      CREATE TABLE graduated (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, observation_id INTEGER NOT NULL,
        graduated_from_branch TEXT NOT NULL, graduated_at_epoch INTEGER NOT NULL,
        UNIQUE(project, observation_id)
      );
      INSERT INTO schema_versions (version, applied_at_epoch) VALUES (1, 0);
      INSERT INTO branch_pin (project, branch, observation_id, note, created_at_epoch)
        VALUES ('p', 'feature/x', 7, 'keep me', 100);
    `);
    db.close();

    const result = migrate(dbPath);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
    expect(result.applied).toEqual([2]);

    const verify = new Database(dbPath, { readonly: true });
    try {
      const pin = verify
        .prepare(
          'SELECT note, content_hash, shared_at_epoch FROM branch_pin WHERE observation_id = 7',
        )
        .get() as { note: string; content_hash: string | null; shared_at_epoch: number | null };
      expect(pin.note).toBe('keep me');
      expect(pin.content_hash).toBeNull();
      expect(pin.shared_at_epoch).toBeNull();
      expect(columnNames(verify, 'graduated')).toEqual(
        expect.arrayContaining(['content_hash', 'shared_at_epoch']),
      );
    } finally {
      verify.close();
    }
  });

  it('self-heals a db recorded at v2 before title/body columns existed', () => {
    // Reproduce a device migrated to v2 by an early build: schema_versions=2 but
    // branch_pin/graduated only have the first-wave sync columns, no title/body.
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at_epoch INTEGER NOT NULL);
      CREATE TABLE branch_pin (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, branch TEXT NOT NULL,
        observation_id INTEGER, note TEXT, created_at_epoch INTEGER NOT NULL,
        content_hash TEXT, shared_at_epoch INTEGER
      );
      CREATE TABLE graduated (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, observation_id INTEGER NOT NULL,
        graduated_from_branch TEXT NOT NULL, graduated_at_epoch INTEGER NOT NULL,
        content_hash TEXT, shared_at_epoch INTEGER, UNIQUE(project, observation_id)
      );
      INSERT INTO schema_versions (version, applied_at_epoch) VALUES (1, 0), (2, 0);
      INSERT INTO branch_pin (project, branch, observation_id, note, created_at_epoch)
        VALUES ('p', 'feature/x', 7, 'keep me', 100);
    `);
    db.close();

    const result = migrate(dbPath);
    expect(result.fromVersion).toBe(2);
    expect(result.toVersion).toBe(2);
    expect(result.applied).toEqual([]); // version unchanged — columns reconciled in place

    const verify = new Database(dbPath, { readonly: true });
    try {
      expect(columnNames(verify, 'branch_pin')).toEqual(expect.arrayContaining(['title', 'body']));
      expect(columnNames(verify, 'graduated')).toEqual(expect.arrayContaining(['title', 'body']));
      // The exact query that crashed `tre status` on the device must now work.
      const pin = verify
        .prepare(
          'SELECT id, project, branch, observation_id, note, created_at_epoch, content_hash, shared_at_epoch, title, body FROM branch_pin WHERE observation_id = 7',
        )
        .get() as { note: string; title: string | null; body: string | null };
      expect(pin.note).toBe('keep me');
      expect(pin.title).toBeNull();
      expect(pin.body).toBeNull();
    } finally {
      verify.close();
    }
  });
});

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

function listObjects(db: Database.Database, type: 'table' | 'index'): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'`)
      .all(type) as Array<{ name: string }>
  ).map((row) => row.name);
}

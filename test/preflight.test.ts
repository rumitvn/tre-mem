import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claudeMemGuidance, diagnoseClaudeMem } from '../src/adapter/preflight.js';

const ALL_COLUMNS = `
  id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, text TEXT,
  type TEXT, title TEXT, subtitle TEXT, facts TEXT, narrative TEXT, concepts TEXT,
  files_read TEXT, files_modified TEXT, prompt_number INTEGER,
  created_at TEXT, created_at_epoch INTEGER
`;

function seed(dbPath: string, opts: { columns?: string; schemaVersion?: number } = {}): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY);
      CREATE TABLE session_summaries (id INTEGER PRIMARY KEY);
      CREATE TABLE pending_messages (id INTEGER PRIMARY KEY);
      CREATE TABLE observations (${opts.columns ?? ALL_COLUMNS});
    `);
    if (opts.schemaVersion !== undefined) {
      db.exec(
        `CREATE TABLE schema_versions (id INTEGER PRIMARY KEY, version INTEGER UNIQUE NOT NULL, applied_at TEXT NOT NULL);`,
      );
      db.prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)').run(
        opts.schemaVersion,
        'x',
      );
    }
  } finally {
    db.close();
  }
}

describe('diagnoseClaudeMem', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-preflight-'));
    dbPath = join(tmp, 'claude-mem.db');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reports not-installed when the DB file is absent', () => {
    const s = diagnoseClaudeMem(join(tmp, 'missing.db'));
    expect(s.installed).toBe(false);
    expect(s.compatible).toBe(false);
    expect(claudeMemGuidance(s, false)).toContain('not installed');
    expect(claudeMemGuidance(s, false)).toContain('tre init');
  });

  it('reports compatible for a well-formed DB at the tested schema', () => {
    seed(dbPath, { schemaVersion: 32 });
    const s = diagnoseClaudeMem(dbPath);
    expect(s.installed).toBe(true);
    expect(s.compatible).toBe(true);
    expect(s.schemaVersion).toBe(32);
    expect(s.newerThanTested).toBe(false);
    expect(claudeMemGuidance(s, false)).toContain('OK');
  });

  it('flags newer-than-tested but stays compatible', () => {
    seed(dbPath, { schemaVersion: 33 });
    const s = diagnoseClaudeMem(dbPath);
    expect(s.compatible).toBe(true);
    expect(s.newerThanTested).toBe(true);
    expect(s.reason).toBe('newer than tested');
    expect(claudeMemGuidance(s, false)).toContain('newer than');
    expect(claudeMemGuidance(s, false)).toContain('npm i -g tre-mem@latest');
  });

  it('reports incompatible with the missing column when a required column is gone', () => {
    const columns = ALL_COLUMNS.replace('title TEXT,', '');
    seed(dbPath, { columns, schemaVersion: 40 });
    const s = diagnoseClaudeMem(dbPath);
    expect(s.installed).toBe(true);
    expect(s.compatible).toBe(false);
    expect(s.missingColumns).toContain('title');
    expect(claudeMemGuidance(s, false)).toContain('incompatible');
    expect(claudeMemGuidance(s, false)).toContain('title');
  });
});

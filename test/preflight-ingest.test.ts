import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { probeClaudeMemIngest } from '../src/adapter/preflight.js';

const NOW = 1_700_000_000; // fixed "now" in seconds
const DAY = 86_400;

function seedObservations(dbPath: string, epochs: number[]): void {
  const db = new Database(dbPath);
  try {
    db.exec(
      `CREATE TABLE observations (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at_epoch INTEGER NOT NULL);`,
    );
    const insert = db.prepare('INSERT INTO observations (created_at_epoch) VALUES (?)');
    for (const e of epochs) insert.run(e);
  } finally {
    db.close();
  }
}

describe('probeClaudeMemIngest', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-ingest-'));
    dbPath = join(tmp, 'claude-mem.db');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when the DB does not exist', () => {
    expect(probeClaudeMemIngest(join(tmp, 'nope.db'), NOW)).toBeNull();
  });

  it('reports health=none for an empty observations table', () => {
    seedObservations(dbPath, []);
    const r = probeClaudeMemIngest(dbPath, NOW);
    expect(r).toMatchObject({ observations: 0, newestEpoch: null, ageDays: null, health: 'none' });
  });

  it('reports health=active for a fresh observation', () => {
    seedObservations(dbPath, [NOW - 3600, NOW - DAY]);
    const r = probeClaudeMemIngest(dbPath, NOW);
    expect(r?.observations).toBe(2);
    expect(r?.health).toBe('active');
    expect(Math.round(r?.ageDays ?? -1)).toBe(0);
  });

  it('reports health=stale when the newest observation is old', () => {
    seedObservations(dbPath, [NOW - 40 * DAY]);
    const r = probeClaudeMemIngest(dbPath, NOW);
    expect(r?.health).toBe('stale');
  });

  it('normalizes millisecond epochs', () => {
    seedObservations(dbPath, [(NOW - 3600) * 1000]); // claude-mem ms epoch
    const r = probeClaudeMemIngest(dbPath, NOW);
    expect(r?.health).toBe('active');
    expect(r?.newestEpoch).toBe(NOW - 3600);
  });
});

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeMemAdapter } from '../src/adapter/claude-mem.js';

describe('ClaudeMemAdapter', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-adapter-'));
    dbPath = join(tmp, 'claude-mem.db');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('throws when the database file does not exist', () => {
    const missing = join(tmp, 'nope.db');
    expect(() => new ClaudeMemAdapter({ dbPath: missing })).toThrow(/not found/);
  });

  it('throws when the schema is missing required tables', () => {
    new Database(dbPath).close();
    expect(() => new ClaudeMemAdapter({ dbPath })).toThrow(/schema sanity check failed/);
  });

  describe('with a populated fixture', () => {
    beforeEach(() => {
      seedFixture(dbPath);
    });

    it('lists distinct projects across observations', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        expect(adapter.listProjects()).toEqual(['proj-a', 'proj-b']);
      } finally {
        adapter.close();
      }
    });

    it('returns observations for a project ordered by created_at_epoch DESC', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        const rows = adapter.getObservations({ project: 'proj-a' });
        expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
        expect(rows[0]).toMatchObject({
          project: 'proj-a',
          title: 'newest',
          created_at_epoch: 3000,
        });
      } finally {
        adapter.close();
      }
    });

    it('filters observations by sinceEpoch / untilEpoch and limit', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        const since = adapter.getObservations({ project: 'proj-a', sinceEpoch: 2000 });
        expect(since.map((r) => r.id)).toEqual([3, 2]);

        const range = adapter.getObservations({
          project: 'proj-a',
          sinceEpoch: 1000,
          untilEpoch: 2000,
        });
        expect(range.map((r) => r.id)).toEqual([2, 1]);

        const limited = adapter.getObservations({ project: 'proj-a', limit: 1 });
        expect(limited.map((r) => r.id)).toEqual([3]);
      } finally {
        adapter.close();
      }
    });

    it('scopes observations by project', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        const rows = adapter.getObservations({ project: 'proj-b' });
        expect(rows.map((r) => r.id)).toEqual([4]);
      } finally {
        adapter.close();
      }
    });

    it('returns session_summaries scoped by project, newest first', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        const rows = adapter.getSessionSummaries({ project: 'proj-a' });
        expect(rows.map((r) => r.id)).toEqual([2, 1]);
        expect(rows[0]).toMatchObject({ request: 'second request', project: 'proj-a' });
      } finally {
        adapter.close();
      }
    });

    it('returns pending_messages joined with sdk_sessions for project + cwd', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        const rows = adapter.getPendingMessages({ project: 'proj-a' });
        expect(rows.map((r) => r.id)).toEqual([2, 1]);
        expect(rows[0]).toMatchObject({
          project: 'proj-a',
          cwd: '/repos/proj-a',
          message_type: 'summarize',
        });
      } finally {
        adapter.close();
      }
    });

    it('getObservationsByIds fetches the requested ids only', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        const rows = adapter.getObservationsByIds([1, 3, 999]);
        const ids = rows.map((r) => r.id).sort((a, b) => a - b);
        expect(ids).toEqual([1, 3]);
      } finally {
        adapter.close();
      }
    });

    it('getObservationsByIds returns [] for an empty input', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        expect(adapter.getObservationsByIds([])).toEqual([]);
      } finally {
        adapter.close();
      }
    });

    it('refuses writes via PRAGMA query_only', () => {
      const adapter = new ClaudeMemAdapter({ dbPath });
      try {
        const writer = new Database(dbPath);
        try {
          writer.exec(
            "INSERT INTO observations (id, memory_session_id, project, type, created_at, created_at_epoch) VALUES (999, 'sess-a', 'proj-a', 'observation', 'x', 9999)",
          );
        } finally {
          writer.close();
        }
        const fresh = new ClaudeMemAdapter({ dbPath });
        try {
          expect(
            fresh.getObservations({ project: 'proj-a', sinceEpoch: 9999 }).map((r) => r.id),
          ).toEqual([999]);
        } finally {
          fresh.close();
        }
      } finally {
        adapter.close();
      }
    });
  });
});

function seedFixture(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT UNIQUE NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT 'claude',
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );

      CREATE TABLE session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );

      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id)
      );
    `);

    db.prepare(
      `INSERT INTO sdk_sessions (id, content_session_id, memory_session_id, project, started_at, started_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(1, 'content-a', 'sess-a', 'proj-a', '2026-05-01T00:00:00Z', 1000);
    db.prepare(
      `INSERT INTO sdk_sessions (id, content_session_id, memory_session_id, project, started_at, started_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(2, 'content-b', 'sess-b', 'proj-b', '2026-05-02T00:00:00Z', 2000);

    const insertObs = db.prepare(
      `INSERT INTO observations
        (id, memory_session_id, project, text, type, title, subtitle, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, 'observation', ?, ?, ?, ?)`,
    );
    insertObs.run(1, 'sess-a', 'proj-a', 'oldest text', 'oldest', null, 't1', 1000);
    insertObs.run(2, 'sess-a', 'proj-a', 'middle text', 'middle', null, 't2', 2000);
    insertObs.run(3, 'sess-a', 'proj-a', 'newest text', 'newest', null, 't3', 3000);
    insertObs.run(4, 'sess-b', 'proj-b', 'other project', 'b1', null, 't4', 2500);

    const insertSummary = db.prepare(
      `INSERT INTO session_summaries
        (id, memory_session_id, project, request, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertSummary.run(1, 'sess-a', 'proj-a', 'first request', 't1', 1500);
    insertSummary.run(2, 'sess-a', 'proj-a', 'second request', 't2', 2500);
    insertSummary.run(3, 'sess-b', 'proj-b', 'b request', 't3', 2200);

    const insertPending = db.prepare(
      `INSERT INTO pending_messages
        (id, session_db_id, content_session_id, message_type, cwd, created_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertPending.run(1, 1, 'content-a', 'observation', '/repos/proj-a', 1200);
    insertPending.run(2, 1, 'content-a', 'summarize', '/repos/proj-a', 2200);
    insertPending.run(3, 2, 'content-b', 'observation', '/repos/proj-b', 2300);
  } finally {
    db.close();
  }
}

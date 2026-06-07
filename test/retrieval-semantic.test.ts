import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeMemAdapter } from '../src/adapter/claude-mem.js';
import { Fts5SemanticSearcher } from '../src/retrieval/semantic.js';

describe('Fts5SemanticSearcher', () => {
  let tmp: string;
  let dbPath: string;
  let adapter: ClaudeMemAdapter;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-semantic-'));
    dbPath = join(tmp, 'claude-mem.db');
    seedFixture(dbPath);
    adapter = new ClaudeMemAdapter({ dbPath });
  });

  afterEach(() => {
    adapter.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns observations matching a single token, scoped to project', () => {
    const searcher = new Fts5SemanticSearcher(adapter);
    const hits = searcher.search({ query: 'stripe', projects: ['proj-a'], k: 10 });
    const ids = hits.map((h) => h.observationId).sort((a, b) => a - b);
    expect(ids).toEqual([1, 3]);
    for (const h of hits) {
      expect(h.similarity).toBeGreaterThan(0);
      expect(h.similarity).toBeLessThanOrEqual(1);
    }
  });

  it('orders results by similarity DESC (best match first)', () => {
    const searcher = new Fts5SemanticSearcher(adapter);
    const hits = searcher.search({ query: 'stripe webhook', projects: ['proj-a'], k: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.similarity).toBeGreaterThanOrEqual(hits[i]!.similarity);
    }
    expect(hits[0]!.observationId).toBe(3);
  });

  it('respects the k limit', () => {
    const searcher = new Fts5SemanticSearcher(adapter);
    const hits = searcher.search({ query: 'auth', projects: ['proj-a'], k: 1 });
    expect(hits).toHaveLength(1);
  });

  it('returns an empty array for queries with no matches', () => {
    const searcher = new Fts5SemanticSearcher(adapter);
    expect(searcher.search({ query: 'kubernetes', projects: ['proj-a'], k: 10 })).toEqual([]);
  });

  it('returns an empty array for a blank query (no FTS injection)', () => {
    const searcher = new Fts5SemanticSearcher(adapter);
    expect(searcher.search({ query: '   ', projects: ['proj-a'], k: 10 })).toEqual([]);
  });

  it('isolates results to the requested project', () => {
    const searcher = new Fts5SemanticSearcher(adapter);
    const hitsA = searcher.search({ query: 'stripe', projects: ['proj-a'], k: 10 });
    const hitsB = searcher.search({ query: 'stripe', projects: ['proj-b'], k: 10 });
    expect(hitsA.every((h) => h.observationId !== 4)).toBe(true);
    expect(hitsB.map((h) => h.observationId)).toEqual([4]);
  });

  it('treats arbitrary characters as plain tokens (no FTS syntax injection)', () => {
    const searcher = new Fts5SemanticSearcher(adapter);
    expect(() =>
      searcher.search({
        query: 'stripe AND OR "*foo" NEAR(',
        projects: ['proj-a'],
        k: 5,
      }),
    ).not.toThrow();
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

      CREATE VIRTUAL TABLE observations_fts USING fts5(
        title, subtitle, narrative, text, facts, concepts,
        content='observations',
        content_rowid='id'
      );

      CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;

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
        cwd TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at_epoch INTEGER NOT NULL
      );
    `);

    const insertObs = db.prepare(
      `INSERT INTO observations
        (id, memory_session_id, project, text, type, title, subtitle, narrative, concepts, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, 'observation', ?, ?, ?, ?, ?, ?)`,
    );
    insertObs.run(
      1,
      'sess-a',
      'proj-a',
      'wired stripe checkout flow',
      'stripe checkout',
      'payment',
      'Wired stripe checkout for new customers',
      'stripe,checkout',
      't1',
      1000,
    );
    insertObs.run(
      2,
      'sess-a',
      'proj-a',
      'fixed jwt auth expiry edge case',
      'jwt auth fix',
      'auth',
      'JWT expiry edge case',
      'jwt,auth,token',
      't2',
      2000,
    );
    insertObs.run(
      3,
      'sess-a',
      'proj-a',
      'stripe webhook handler retry logic',
      'stripe webhook',
      'payment retry',
      'Webhook retries with exponential backoff for stripe',
      'stripe,webhook,retry',
      't3',
      3000,
    );
    insertObs.run(
      4,
      'sess-b',
      'proj-b',
      'stripe integration for proj-b',
      'stripe init',
      null,
      'Initialized stripe for project b',
      'stripe',
      't4',
      2500,
    );
  } finally {
    db.close();
  }
}

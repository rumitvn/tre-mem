import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeMemAdapter } from '../src/adapter/claude-mem.js';
import { searchBranchContext } from '../src/retrieval/search.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

describe('searchBranchContext', () => {
  let tmp: string;
  let claudeMemPath: string;
  let treMemPath: string;
  let adapter: ClaudeMemAdapter;
  let repo: TreMemRepo;
  const NOW = 10_000_000;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-search-'));
    claudeMemPath = join(tmp, 'claude-mem.db');
    treMemPath = join(tmp, 'tre-mem.db');
    seedClaudeMem(claudeMemPath, NOW);
    migrate(treMemPath);
    adapter = new ClaudeMemAdapter({ dbPath: claudeMemPath });
    repo = new TreMemRepo({ dbPath: treMemPath });
    seedBranchTagsAndPins(repo, NOW);
  });

  afterEach(() => {
    adapter.close();
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ranks branch-tagged + semantic + recent observations above generic semantic hits', () => {
    const hits = searchBranchContext(
      { adapter, repo },
      {
        query: 'stripe webhook',
        project: 'proj-a',
        branch: 'feature/payment',
        k: 5,
        nowEpoch: NOW,
      },
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.observation.id).toBe(3);
    expect(hits[0]!.breakdown.semantic).toBeGreaterThan(0);
    expect(hits[0]!.breakdown.branch).toBeGreaterThan(0);
  });

  it('floats a pinned observation above all signals', () => {
    repo.addPin({
      project: 'proj-a',
      branch: 'feature/payment',
      observation_id: 2,
      created_at_epoch: NOW,
    });
    const hits = searchBranchContext(
      { adapter, repo },
      {
        query: 'stripe',
        project: 'proj-a',
        branch: 'feature/payment',
        k: 5,
        nowEpoch: NOW,
      },
    );
    expect(hits[0]!.observation.id).toBe(2);
    expect(hits[0]!.breakdown.pin).toBeGreaterThan(0);
  });

  it('returns [] for a project with no observations', () => {
    const hits = searchBranchContext(
      { adapter, repo },
      {
        query: 'anything',
        project: 'proj-empty',
        branch: 'main',
        k: 5,
        nowEpoch: NOW,
      },
    );
    expect(hits).toEqual([]);
  });
});

function seedClaudeMem(dbPath: string, now: number): void {
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
        content='observations', content_rowid='id'
      );

      CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;

      CREATE TABLE session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );

      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
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
      's',
      'proj-a',
      'stripe checkout',
      'stripe',
      null,
      'wire stripe',
      'stripe',
      't',
      now - 86400 * 5,
    );
    insertObs.run(
      2,
      's',
      'proj-a',
      'jwt expiry fix',
      'jwt',
      null,
      'fix auth',
      'jwt',
      't',
      now - 86400 * 4,
    );
    insertObs.run(
      3,
      's',
      'proj-a',
      'stripe webhook retry logic',
      'stripe webhook',
      null,
      'webhook retries for stripe',
      'stripe,webhook',
      't',
      now - 3600,
    );
    insertObs.run(4, 's', 'proj-b', 'unrelated', 'other', null, 'nope', 'foo', 't', now - 86400);
  } finally {
    db.close();
  }
}

function seedBranchTagsAndPins(repo: TreMemRepo, now: number): void {
  repo.upsertBranchTag({
    observation_id: 1,
    project: 'proj-a',
    branch: 'feature/payment',
    tagged_at_epoch: now - 86400 * 5,
    source: 'live',
  });
  repo.upsertBranchTag({
    observation_id: 3,
    project: 'proj-a',
    branch: 'feature/payment',
    tagged_at_epoch: now - 3600,
    source: 'live',
  });
  repo.upsertBranchTag({
    observation_id: 2,
    project: 'proj-a',
    branch: 'fix/auth',
    tagged_at_epoch: now - 86400 * 4,
    source: 'live',
  });
}

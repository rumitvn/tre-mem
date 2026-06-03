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

  it('surfaces a shared pin whose observation is absent locally (from its snapshot)', () => {
    // Simulates a pin imported from a teammate: obs 9001 is NOT in claude-mem.
    repo.importPin({
      project: 'proj-a',
      branch: 'feature/payment',
      observation_id: 9001,
      note: 'use Stripe webhook v3',
      created_at_epoch: NOW,
      content_hash: 'hash-9001',
      shared_at_epoch: NOW,
      title: "Alice's decision: webhook v3",
      body: 'Standardized on webhook v3 for idempotency.',
    });

    const hits = searchBranchContext(
      { adapter, repo },
      { query: 'anything', project: 'proj-a', branch: 'feature/payment', k: 10, nowEpoch: NOW },
    );
    const shared = hits.find((h) => h.observation.id === 9001);
    expect(shared).toBeDefined();
    expect(shared?.source).toBe('shared-pin');
    expect(shared?.observation.title).toBe("Alice's decision: webhook v3");
    expect(shared?.breakdown.pin).toBeGreaterThan(0);
  });

  it('surfaces a free-text pin (no observation id at all)', () => {
    repo.addPin({
      project: 'proj-a',
      branch: 'feature/payment',
      observation_id: null,
      note: 'decision: prefer pessimistic locking here',
      created_at_epoch: NOW,
    });
    const hits = searchBranchContext(
      { adapter, repo },
      { query: 'anything', project: 'proj-a', branch: 'feature/payment', k: 10, nowEpoch: NOW },
    );
    const freeText = hits.find((h) => h.source === 'shared-pin' && h.observation.id < 0);
    expect(freeText).toBeDefined();
    expect(freeText?.observation.title).toContain('pessimistic locking');
  });

  it('surfaces a graduated fact whose observation is absent locally, on any branch', () => {
    repo.importGraduated({
      project: 'proj-a',
      observation_id: 9002,
      graduated_from_branch: 'feature/payment',
      graduated_at_epoch: NOW,
      content_hash: 'hash-9002',
      shared_at_epoch: NOW,
      title: 'Stripe is the canonical payment provider',
      body: 'Repo-wide decision.',
    });
    const hits = searchBranchContext(
      { adapter, repo },
      { query: 'anything', project: 'proj-a', branch: 'some/other-branch', k: 10, nowEpoch: NOW },
    );
    const grad = hits.find((h) => h.observation.id === 9002);
    expect(grad).toBeDefined();
    expect(grad?.source).toBe('graduated');
    expect(grad?.breakdown.graduated).toBeGreaterThan(0);
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

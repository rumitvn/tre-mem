import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeMemAdapter } from '../src/adapter/claude-mem.js';
import {
  TOOL_DEFINITIONS,
  callTool,
  getBranchContext,
  getBranchTimeline,
  graduateFact,
  listBranches,
  pinFact,
  type ToolDeps,
} from '../src/mcp/tools.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

const PROJECT = 'proj-a';
const FEATURE = 'feature/payment';
const FIX = 'fix/auth';
const NOW = 10_000_000;

describe('MCP tools', () => {
  let tmp: string;
  let adapter: ClaudeMemAdapter;
  let repo: TreMemRepo;
  let deps: ToolDeps;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-mcp-'));
    const claudeMemPath = join(tmp, 'claude-mem.db');
    const treMemPath = join(tmp, 'tre-mem.db');
    seedClaudeMem(claudeMemPath, NOW);
    migrate(treMemPath);
    adapter = new ClaudeMemAdapter({ dbPath: claudeMemPath });
    repo = new TreMemRepo({ dbPath: treMemPath });
    seedBranchTags(repo, NOW);
    deps = {
      adapter,
      repo,
      defaultCwd: `/fake/${PROJECT}`,
      resolveBranch: async () => FEATURE,
      now: () => NOW,
    };
  });

  afterEach(() => {
    adapter.close();
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('exposes exactly 5 tool definitions with required fields', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      'get_branch_context',
      'get_branch_timeline',
      'list_branches',
      'pin_fact',
      'graduate_fact',
    ]);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('get_branch_context: ranks branch + semantic + recency', async () => {
    const result = await getBranchContext(deps, {
      query: 'stripe webhook',
      k: 5,
    });
    expect(result.project).toBe(PROJECT);
    expect(result.branch).toBe(FEATURE);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.observation_id).toBe(3);
    expect(result.hits[0]!.total).toBeGreaterThan(0);
    expect(result.hits[0]!.breakdown.branch).toBeGreaterThan(0);
  });

  it('get_branch_context: honors explicit branch override', async () => {
    const result = await getBranchContext(deps, {
      query: 'jwt',
      branch: FIX,
      project: PROJECT,
    });
    expect(result.branch).toBe(FIX);
    expect(result.hits.some((h) => h.observation_id === 2)).toBe(true);
  });

  it('get_branch_timeline: returns tagged observations newest first', async () => {
    const result = await getBranchTimeline(deps, {
      branch: FEATURE,
      project: PROJECT,
      limit: 10,
    });
    expect(result.entries.map((e) => e.observation_id)).toEqual([3, 1]);
    expect(result.entries[0]!.tagged_at_epoch).toBeGreaterThan(
      result.entries[1]!.tagged_at_epoch,
    );
  });

  it('list_branches: groups tag counts per branch', () => {
    const result = listBranches(deps, { project: PROJECT });
    const map = new Map(result.branches.map((b) => [b.branch, b.count]));
    expect(map.get(FEATURE)).toBe(2);
    expect(map.get(FIX)).toBe(1);
  });

  it('pin_fact: inserts branch pin and round-trips through repo', async () => {
    const result = await pinFact(deps, {
      observation_id: 3,
      note: 'stripe primary fact',
    });
    expect(result.observation_id).toBe(3);
    expect(result.branch).toBe(FEATURE);
    expect(result.note).toBe('stripe primary fact');
    const pins = repo.listPinsForBranch(PROJECT, FEATURE);
    expect(pins.some((p) => p.observation_id === 3 && p.note === 'stripe primary fact')).toBe(
      true,
    );
  });

  it('pin_fact: rejects bad observation ids', async () => {
    await expect(pinFact(deps, { observation_id: 0 })).rejects.toThrow(/invalid observation_id/);
    await expect(
      pinFact(deps, { observation_id: 1.5 as unknown as number }),
    ).rejects.toThrow(/invalid observation_id/);
  });

  it('graduate_fact: writes graduated row and is idempotent on conflict', async () => {
    const a = await graduateFact(deps, { observation_id: 3 });
    expect(a.observation_id).toBe(3);
    expect(a.graduated_from_branch).toBe(FEATURE);
    const again = await graduateFact(deps, { observation_id: 3, branch: 'main' });
    expect(again.observation_id).toBe(3);
    expect(again.graduated_from_branch).toBe('main');
    const all = repo.listGraduated(PROJECT);
    expect(all.length).toBe(1);
    expect(all[0]!.graduated_from_branch).toBe('main');
  });

  it('callTool: dispatches by name and rejects unknown tools', async () => {
    const result = (await callTool(deps, 'list_branches', { project: PROJECT })) as {
      project: string;
    };
    expect(result.project).toBe(PROJECT);
    await expect(callTool(deps, 'nope', {})).rejects.toThrow(/unknown tool/);
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

    const insert = db.prepare(
      `INSERT INTO observations
        (id, memory_session_id, project, text, type, title, subtitle, narrative, concepts, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, 'observation', ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(1, 's', PROJECT, 'stripe checkout', 'stripe', null, 'wire stripe', 'stripe', 't', now - 86400 * 5);
    insert.run(2, 's', PROJECT, 'jwt expiry fix', 'jwt', null, 'fix auth', 'jwt', 't', now - 86400 * 4);
    insert.run(
      3,
      's',
      PROJECT,
      'stripe webhook retry logic',
      'stripe webhook',
      null,
      'webhook retries for stripe',
      'stripe,webhook',
      't',
      now - 3600,
    );
  } finally {
    db.close();
  }
}

function seedBranchTags(repo: TreMemRepo, now: number): void {
  repo.upsertBranchTag({
    observation_id: 1,
    project: PROJECT,
    branch: FEATURE,
    tagged_at_epoch: now - 86400 * 5,
    source: 'live',
  });
  repo.upsertBranchTag({
    observation_id: 3,
    project: PROJECT,
    branch: FEATURE,
    tagged_at_epoch: now - 3600,
    source: 'live',
  });
  repo.upsertBranchTag({
    observation_id: 2,
    project: PROJECT,
    branch: FIX,
    tagged_at_epoch: now - 86400 * 4,
    source: 'live',
  });
}

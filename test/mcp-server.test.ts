import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeMemAdapter } from '../src/adapter/claude-mem.js';
import { createMcpServer } from '../src/mcp/server.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

describe('createMcpServer', () => {
  let tmp: string;
  let adapter: ClaudeMemAdapter;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-mcp-srv-'));
    const claudeMemPath = join(tmp, 'claude-mem.db');
    const treMemPath = join(tmp, 'tre-mem.db');
    seedClaudeMem(claudeMemPath);
    migrate(treMemPath);
    adapter = new ClaudeMemAdapter({ dbPath: claudeMemPath });
    repo = new TreMemRepo({ dbPath: treMemPath });
  });

  afterEach(() => {
    adapter.close();
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('constructs an MCP server with tools capability and is not connected at creation', () => {
    const server = createMcpServer({
      deps: {
        adapter,
        repo,
        defaultCwd: '/fake/proj',
        resolveBranch: async () => 'main',
        now: () => 10_000_000,
      },
    });
    expect(server).toBeTruthy();
    // .transport is undefined until .connect() is called
    expect((server as unknown as { transport?: unknown }).transport).toBeUndefined();
  });
});

function seedClaudeMem(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY);
      CREATE TABLE observations (
        id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, text TEXT,
        type TEXT, title TEXT, subtitle TEXT, facts TEXT, narrative TEXT, concepts TEXT,
        files_read TEXT, files_modified TEXT, prompt_number INTEGER,
        created_at TEXT, created_at_epoch INTEGER
      );
      CREATE TABLE session_summaries (id INTEGER PRIMARY KEY);
      CREATE TABLE pending_messages (id INTEGER PRIMARY KEY);
    `);
  } finally {
    db.close();
  }
}

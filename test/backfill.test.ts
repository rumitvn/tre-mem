import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeMemAdapter } from '../src/adapter/claude-mem.js';
import { backfill } from '../src/git/backfill.js';
import { readHeadReflog } from '../src/git/reflog.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

interface SeedEpochs {
  initial: number;
  feature: number;
  backToMain: number;
}

describe('backfill', () => {
  let tmp: string;
  let claudeMemDb: string;
  let treMemDb: string;
  let repoDir: string;
  let adapter: ClaudeMemAdapter;
  let repo: TreMemRepo;
  let epochs: SeedEpochs;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-backfill-'));
    claudeMemDb = join(tmp, 'claude-mem.db');
    treMemDb = join(tmp, 'tre-mem.db');
    repoDir = join(tmp, 'workrepo');

    migrate(treMemDb);
    epochs = await seedGitRepo(repoDir);
    seedClaudeMem(claudeMemDb, epochs);

    adapter = new ClaudeMemAdapter({ dbPath: claudeMemDb });
    repo = new TreMemRepo({ dbPath: treMemDb });
  });

  afterEach(() => {
    adapter.close();
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('tags every observation with the branch HEAD pointed at when it was created', async () => {
    const result = await backfill({
      project: 'workrepo',
      cwd: repoDir,
      adapter,
      repo,
      now: () => 9999,
    });

    expect(result.scanned).toBe(3);
    expect(result.tagged).toBe(3);
    expect(result.skippedAlreadyTagged).toBe(0);
    expect(result.skippedNoBranch).toBe(0);
    expect(result.transitions).toBeGreaterThanOrEqual(2);

    expect(repo.getBranchTag(1)).toMatchObject({
      project: 'workrepo',
      branch: 'main',
      source: 'reflog-backfill',
      tagged_at_epoch: 9999,
    });
    expect(repo.getBranchTag(2)).toMatchObject({ branch: 'feature/payment' });
    expect(repo.getBranchTag(3)).toMatchObject({ branch: 'main' });
  });

  it('is idempotent: re-running keeps existing tags and reports them as skipped', async () => {
    await backfill({ project: 'workrepo', cwd: repoDir, adapter, repo, now: () => 100 });

    const second = await backfill({
      project: 'workrepo',
      cwd: repoDir,
      adapter,
      repo,
      now: () => 200,
    });
    expect(second.tagged).toBe(0);
    expect(second.skippedAlreadyTagged).toBe(3);
    expect(repo.getBranchTag(1)?.tagged_at_epoch).toBe(100);
  });

  it('only touches observations for the requested project', async () => {
    await backfill({ project: 'workrepo', cwd: repoDir, adapter, repo, now: () => 1 });
    expect(repo.countBranchTags('workrepo')).toBe(3);
    expect(repo.countBranchTags('other')).toBe(0);
  });

  it('uses fallbackBranch when reflog cannot resolve a branch', async () => {
    const noSwitchRepo = join(tmp, 'novars');
    const noSwitchClaudeMem = join(tmp, 'novars-claude-mem.db');
    mkdirSync(noSwitchRepo, { recursive: true });
    const git = simpleGit(noSwitchRepo);
    await git.init(['--initial-branch', 'main']);
    await git.addConfig('user.email', 'test@example.com', false, 'local');
    await git.addConfig('user.name', 'Test User', false, 'local');
    writeFileSync(join(noSwitchRepo, 'README'), 'seed\n');
    await git.add('README');
    await git.commit('seed');

    seedClaudeMem(noSwitchClaudeMem, {
      initial: 1000,
      feature: 1000,
      backToMain: 1000,
    });
    const adapter2 = new ClaudeMemAdapter({ dbPath: noSwitchClaudeMem });
    try {
      const strict = await backfill({
        project: 'workrepo',
        cwd: noSwitchRepo,
        adapter: adapter2,
        repo,
        now: () => 1,
      });
      expect(strict.tagged).toBe(0);
      expect(strict.skippedNoBranch).toBe(3);

      const withFallback = await backfill({
        project: 'workrepo',
        cwd: noSwitchRepo,
        adapter: adapter2,
        repo,
        fallbackBranch: 'main',
        now: () => 2,
      });
      expect(withFallback.tagged).toBe(3);
      expect(repo.countBranchTags('workrepo', 'main')).toBe(3);
    } finally {
      adapter2.close();
    }
  });

  it('honours sinceEpoch + limit and reports branch counts', async () => {
    await backfill({
      project: 'workrepo',
      cwd: repoDir,
      adapter,
      repo,
      sinceEpoch: epochs.feature,
      limit: 2,
      now: () => 1,
    });
    const branches = Object.fromEntries(
      repo.listBranchesForProject('workrepo').map((b) => [b.branch, b.count]),
    );
    expect(branches['feature/payment']).toBeGreaterThanOrEqual(1);
    expect(repo.countBranchTags('workrepo')).toBeLessThanOrEqual(2);
  });
});

async function seedGitRepo(cwd: string): Promise<SeedEpochs> {
  mkdirSync(cwd, { recursive: true });
  const git = simpleGit(cwd);
  await git.init(['--initial-branch', 'main']);
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.addConfig('user.name', 'Test User', false, 'local');
  writeFileSync(join(cwd, 'README'), 'seed\n');
  await git.add('README');
  await git.commit('seed');

  await sleep(1100);
  await git.checkoutLocalBranch('feature/payment');
  await sleep(1100);
  writeFileSync(join(cwd, 'feature.txt'), 'work\n');
  await git.add('feature.txt');
  await git.commit('feature work');
  await sleep(1100);
  await git.checkout('main');

  const transitions = await readHeadReflog(cwd);
  const featureT = transitions.find((t) => t.to_branch === 'feature/payment');
  const backT = transitions.find(
    (t) => t.to_branch === 'main' && t.from_branch === 'feature/payment',
  );
  if (!featureT || !backT) {
    throw new Error(
      `seedGitRepo: expected feature + back transitions in reflog, saw ${JSON.stringify(transitions)}`,
    );
  }
  return {
    initial: featureT.at_epoch - 100,
    feature: featureT.at_epoch,
    backToMain: backT.at_epoch,
  };
}

function seedClaudeMem(dbPath: string, ep: SeedEpochs): void {
  const db = new Database(dbPath);
  try {
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
    ).run(1, 'c-1', 's-1', 'workrepo', 't', ep.initial);

    const insertObs = db.prepare(
      `INSERT INTO observations
        (id, memory_session_id, project, text, type, title, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, 'observation', ?, ?, ?)`,
    );
    // Pre-history: before any reflog checkout transition.
    insertObs.run(1, 's-1', 'workrepo', 'pre-feature', 'main work', 't1', ep.initial);
    // Between feature checkout and back-to-main.
    insertObs.run(2, 's-1', 'workrepo', 'in feature', 'feature work', 't2', ep.feature + 1);
    // After back-to-main.
    insertObs.run(3, 's-1', 'workrepo', 'after merge', 'cleanup', 't3', ep.backToMain + 1);

    db.prepare(
      `INSERT INTO sdk_sessions (id, content_session_id, memory_session_id, project, started_at, started_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(2, 'c-2', 's-2', 'other', 't', ep.initial);
    insertObs.run(99, 's-2', 'other', 'other proj', 'noop', 't', ep.feature);
  } finally {
    db.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

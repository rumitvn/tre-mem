import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runSessionStartHook } from '../src/hooks/session-start.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

describe('runSessionStartHook', () => {
  let tmp: string;
  let dbPath: string;
  let repoDir: string;
  let repo: TreMemRepo;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-hook-'));
    dbPath = join(tmp, 'tre-mem.db');
    repoDir = join(tmp, 'workrepo');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
    await initGitRepo(repoDir, 'main');
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('upserts branch_state from input.cwd and returns the resolved branch', async () => {
    const result = await runSessionStartHook(
      {
        hook_event_name: 'SessionStart',
        source: 'startup',
        session_id: 's-1',
        cwd: repoDir,
      },
      { repo, now: () => 5000 },
    );

    expect(result.project).toBe('workrepo');
    expect(result.cwd).toBe(repoDir);
    expect(result.branch).toBe('main');
    expect(result.tagged_count_for_branch).toBe(0);
    expect(result.source).toBe('startup');
    expect(result.message).toContain('workrepo');
    expect(result.message).toContain('main');

    expect(result.message).not.toContain('dashboard live');

    const state = repo.getBranchState(repoDir);
    expect(state).toEqual({
      cwd: repoDir,
      project: 'workrepo',
      current_branch: 'main',
      updated_at_epoch: 5000,
      remote: null,
    });
  });

  it('surfaces the dashboard URL in the digest when one is provided', async () => {
    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      { repo, now: () => 5000, dashboardUrl: 'http://127.0.0.1:38700/' },
    );
    expect(result.message).toContain('dashboard live →');
    expect(result.message).toContain('http://127.0.0.1:38700/');
    expect(result.display).toContain('http://127.0.0.1:38700/');
  });

  it('reflects branch switch on subsequent invocations', async () => {
    await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      { repo, now: () => 1000 },
    );
    await simpleGit(repoDir).checkoutLocalBranch('feature/payment');

    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      { repo, now: () => 2000 },
    );
    expect(result.branch).toBe('feature/payment');
    expect(repo.getBranchState(repoDir)?.current_branch).toBe('feature/payment');
    expect(repo.getBranchState(repoDir)?.updated_at_epoch).toBe(2000);
  });

  it('falls back to process.cwd() when cwd is missing from input', async () => {
    const original = process.cwd();
    try {
      process.chdir(repoDir);
      const result = await runSessionStartHook(
        { hook_event_name: 'SessionStart' },
        { repo, now: () => 1 },
      );
      expect(realpathSync(result.cwd)).toBe(realpathSync(repoDir));
      expect(result.branch).toBe('main');
    } finally {
      process.chdir(original);
    }
  });

  it('records (no-git) when the cwd has no git repo', async () => {
    const bareDir = join(tmp, 'bare');
    mkdirSync(bareDir, { recursive: true });

    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: bareDir },
      { repo, now: () => 7000 },
    );
    expect(result.branch).toBe('(no-git)');
    expect(repo.getBranchState(bareDir)?.current_branch).toBe('(no-git)');
    expect(result.tagged_count_for_branch).toBe(0);
  });

  it('reports tagged observation count for the current branch', async () => {
    repo.upsertBranchTag({
      observation_id: 101,
      project: 'workrepo',
      branch: 'main',
      tagged_at_epoch: 1,
      source: 'reflog-backfill',
    });
    repo.upsertBranchTag({
      observation_id: 102,
      project: 'workrepo',
      branch: 'main',
      tagged_at_epoch: 1,
      source: 'reflog-backfill',
    });
    repo.upsertBranchTag({
      observation_id: 103,
      project: 'workrepo',
      branch: 'feature/payment',
      tagged_at_epoch: 1,
      source: 'reflog-backfill',
    });

    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      { repo, now: () => 10 },
    );
    expect(result.branch).toBe('main');
    expect(result.tagged_count_for_branch).toBe(2);
    expect(result.tagged_count_for_project).toBe(3);
    expect(result.message).toContain('2');
  });

  it('auto-imports a committed .tre-mem/ directory on session start', async () => {
    const syncBranches = join(repoDir, '.tre-mem', 'branches');
    mkdirSync(syncBranches, { recursive: true });
    writeFileSync(
      join(syncBranches, 'main.jsonl'),
      JSON.stringify({
        schema: 1,
        kind: 'pin',
        content_hash: 'abc123',
        project: 'workrepo',
        branch: 'main',
        observation_id: 7,
        note: "alice's pin",
        title: null,
        body: null,
        author: 'alice',
        tagged_at_epoch: 1,
      }) + '\n',
      'utf8',
    );

    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      { repo, now: () => 100 },
    );

    expect(result.imported_pins).toBe(1);
    expect(result.message).toContain('imported: 1pin/0grad');
    expect(repo.listPinsForBranch('workrepo', 'main')).toHaveLength(1);

    // idempotent: a second session imports nothing new
    const second = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      { repo, now: () => 200 },
    );
    expect(second.imported_pins).toBe(0);
  });

  it('renders a recent-observation list and matching colored display', async () => {
    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      {
        repo,
        now: () => 10,
        recent: () => [
          { id: 1882, type: 'refactor', title: 'Log utils extracted to src/log/read.ts' },
          { id: 1880, type: 'feature', title: 'tre logs CLI command implemented' },
        ],
      },
    );

    expect(result.message).toContain('#1882');
    expect(result.message).toContain('Log utils extracted');
    expect(result.message).toContain('🔄');
    expect(result.message).toContain('🎋 tre-mem');
    expect(result.message).toContain('recent context');
    // plain context never carries ANSI escape codes
    expect(result.message.includes(String.fromCharCode(27))).toBe(false);
    expect(result.display).toContain('#1882');
  });

  it('degrades to a hint when the recent getter throws (claude-mem missing)', async () => {
    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      {
        repo,
        now: () => 10,
        recent: () => {
          throw new Error('claude-mem.db not found');
        },
      },
    );
    expect(result.message).toContain('tre doctor');
  });

  it('skips auto-import when skipImport is set', async () => {
    const syncBranches = join(repoDir, '.tre-mem', 'branches');
    mkdirSync(syncBranches, { recursive: true });
    writeFileSync(join(syncBranches, 'main.jsonl'), '{"bad"\n', 'utf8');

    const result = await runSessionStartHook(
      { hook_event_name: 'SessionStart', cwd: repoDir },
      { repo, now: () => 100, skipImport: true },
    );
    expect(result.imported_pins).toBe(0);
  });
});

async function initGitRepo(cwd: string, branch: string): Promise<void> {
  mkdirSync(cwd, { recursive: true });
  const git = simpleGit(cwd);
  await git.init(['--initial-branch', branch]);
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.addConfig('user.name', 'Test User', false, 'local');
  writeFileSync(join(cwd, 'README'), 'seed\n');
  await git.add('README');
  await git.commit('seed');
}

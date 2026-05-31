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

    const state = repo.getBranchState(repoDir);
    expect(state).toEqual({
      cwd: repoDir,
      project: 'workrepo',
      current_branch: 'main',
      updated_at_epoch: 5000,
    });
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

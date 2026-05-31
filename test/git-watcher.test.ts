import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitWatcher } from '../src/git/watcher.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

describe('GitWatcher', () => {
  let tmp: string;
  let dbPath: string;
  let repoDir: string;
  let repo: TreMemRepo;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-watcher-'));
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

  it('sync() upserts branch_state with the current branch', async () => {
    const watcher = new GitWatcher({
      cwd: repoDir,
      project: 'workrepo',
      repo,
      now: () => 5000,
    });
    const branch = await watcher.sync();
    expect(branch).toBe('main');

    const state = repo.getBranchState(repoDir);
    expect(state).toEqual({
      cwd: repoDir,
      project: 'workrepo',
      current_branch: 'main',
      updated_at_epoch: 5000,
    });
  });

  it('sync() reflects a branch switch on the next call', async () => {
    const watcher = new GitWatcher({
      cwd: repoDir,
      project: 'workrepo',
      repo,
      now: () => 1000,
    });
    await watcher.sync();
    await simpleGit(repoDir).checkoutLocalBranch('feature/payment');

    const branch = await watcher.sync();
    expect(branch).toBe('feature/payment');
    expect(repo.getBranchState(repoDir)?.current_branch).toBe('feature/payment');
  });

  it('records (no-git) when the directory has no git repo', async () => {
    const bareDir = join(tmp, 'bare');
    writeFileSync(join(tmp, 'placeholder'), '');
    const watcher = new GitWatcher({
      cwd: bareDir,
      project: 'bare',
      repo,
      now: () => 7000,
    });
    expect(await watcher.sync()).toBe('(no-git)');
  });

  it('start() invokes an initial sync and stop() cleans up', async () => {
    let syncCount = 0;
    const watcher = new GitWatcher({
      cwd: repoDir,
      project: 'workrepo',
      repo,
      now: () => 9000,
      onSync: () => {
        syncCount += 1;
      },
    });
    await watcher.start();
    expect(syncCount).toBe(1);
    expect(repo.getBranchState(repoDir)?.current_branch).toBe('main');
    await watcher.stop();
  });
});

async function initGitRepo(cwd: string, branch: string): Promise<void> {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(cwd, { recursive: true });
  const git = simpleGit(cwd);
  await git.init(['--initial-branch', branch]);
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.addConfig('user.name', 'Test User', false, 'local');
  writeFileSync(join(cwd, 'README'), 'seed\n');
  await git.add('README');
  await git.commit('seed');
}

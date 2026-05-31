import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DETACHED_PREFIX,
  NO_GIT,
  currentBranch,
  isDetached,
} from '../src/git/resolver.js';

describe('currentBranch', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-resolver-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns (no-git) for a non-existent directory', async () => {
    expect(await currentBranch(join(tmp, 'does-not-exist'))).toBe(NO_GIT);
  });

  it('returns (no-git) for a directory without .git/', async () => {
    expect(await currentBranch(tmp)).toBe(NO_GIT);
  });

  it('returns the current branch after init + first commit', async () => {
    await initRepo(tmp, 'main');
    expect(await currentBranch(tmp)).toBe('main');
  });

  it('returns slash-style branch names verbatim', async () => {
    await initRepo(tmp, 'main');
    await simpleGit(tmp).checkoutLocalBranch('feature/payment');
    expect(await currentBranch(tmp)).toBe('feature/payment');
  });

  it('detects detached HEAD with sha prefix', async () => {
    await initRepo(tmp, 'main');
    const git = simpleGit(tmp);
    const sha = (await git.revparse(['HEAD'])).trim();
    await git.checkout([sha, '--detach']);
    const branch = await currentBranch(tmp);
    expect(isDetached(branch)).toBe(true);
    expect(branch.startsWith(DETACHED_PREFIX)).toBe(true);
    expect(branch).toContain(sha.slice(0, 12));
  });
});

async function initRepo(cwd: string, branch: string): Promise<void> {
  const git = simpleGit(cwd);
  await git.init(['--initial-branch', branch]);
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.addConfig('user.name', 'Test User', false, 'local');
  writeFileSync(join(cwd, 'README'), 'seed\n');
  await git.add('README');
  await git.commit('seed');
}

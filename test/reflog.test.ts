import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseHeadReflog, readHeadReflog, resolveBranchAt } from '../src/git/reflog.js';

describe('parseHeadReflog', () => {
  it('returns [] on empty input', () => {
    expect(parseHeadReflog('')).toEqual([]);
  });

  it('skips entries that are not branch checkouts', () => {
    const raw = ['HEAD@{1000}|commit (initial): seed', 'HEAD@{1500}|reset: moving to HEAD'].join(
      '\n',
    );
    expect(parseHeadReflog(raw)).toEqual([]);
  });

  it('parses checkout transitions sorted chronologically', () => {
    const raw = [
      'HEAD@{3000}|checkout: moving from feature/payment to main',
      'HEAD@{1000}|commit (initial): seed',
      'HEAD@{2000}|checkout: moving from main to feature/payment',
    ].join('\n');

    expect(parseHeadReflog(raw)).toEqual([
      { at_epoch: 2000, from_branch: 'main', to_branch: 'feature/payment' },
      { at_epoch: 3000, from_branch: 'feature/payment', to_branch: 'main' },
    ]);
  });

  it('preserves slash-bearing branch names', () => {
    const raw = 'HEAD@{1700}|checkout: moving from release/1.2.3 to fix/auth-jwt';
    expect(parseHeadReflog(raw)).toEqual([
      { at_epoch: 1700, from_branch: 'release/1.2.3', to_branch: 'fix/auth-jwt' },
    ]);
  });
});

describe('resolveBranchAt', () => {
  const transitions = [
    { at_epoch: 1000, from_branch: 'main', to_branch: 'feature/payment' },
    { at_epoch: 2000, from_branch: 'feature/payment', to_branch: 'main' },
    { at_epoch: 3000, from_branch: 'main', to_branch: 'fix/jwt' },
  ];

  it('returns null with no transitions', () => {
    expect(resolveBranchAt([], 5000)).toBeNull();
  });

  it('returns from_branch of earliest transition for pre-history epoch', () => {
    expect(resolveBranchAt(transitions, 500)).toBe('main');
  });

  it('returns the to_branch of the latest transition <= epoch', () => {
    expect(resolveBranchAt(transitions, 1500)).toBe('feature/payment');
    expect(resolveBranchAt(transitions, 2500)).toBe('main');
    expect(resolveBranchAt(transitions, 9999)).toBe('fix/jwt');
  });

  it('is inclusive of exact epoch matches', () => {
    expect(resolveBranchAt(transitions, 2000)).toBe('main');
  });
});

describe('readHeadReflog', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-reflog-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns [] for a non-git directory', async () => {
    expect(await readHeadReflog(tmp)).toEqual([]);
  });

  it('captures a real checkout transition between two branches', async () => {
    const git = simpleGit(tmp);
    await git.init(['--initial-branch', 'main']);
    await git.addConfig('user.email', 'test@example.com', false, 'local');
    await git.addConfig('user.name', 'Test User', false, 'local');
    writeFileSync(join(tmp, 'README'), 'seed\n');
    await git.add('README');
    await git.commit('seed');
    await git.checkoutLocalBranch('feature/payment');
    await git.checkout('main');

    const transitions = await readHeadReflog(tmp);
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    expect(transitions.some((t) => t.to_branch === 'feature/payment')).toBe(true);
    expect(transitions[transitions.length - 1]?.to_branch).toBe('main');
  });
});

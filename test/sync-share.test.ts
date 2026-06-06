import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { shareToGit, type ShareGit } from '../src/sync/share.js';

interface FakeOpts {
  staged?: number;
  upstream?: string | null;
  branch?: string;
  pushError?: Error;
}

interface FakeGit extends ShareGit {
  calls: string[];
}

function fakeGit(opts: FakeOpts = {}): FakeGit {
  const calls: string[] = [];
  return {
    calls,
    async add(pathspec) {
      calls.push(`add ${pathspec}`);
    },
    async stagedCount() {
      return opts.staged ?? 0;
    },
    async commit(message) {
      calls.push(`commit ${message}`);
    },
    async currentBranch() {
      return opts.branch ?? 'main';
    },
    async upstream() {
      return opts.upstream ?? null;
    },
    async push() {
      calls.push('push');
      if (opts.pushError) throw opts.pushError;
    },
  };
}

describe('shareToGit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tre-share-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('writes .gitattributes (merge=union) before staging', async () => {
    const git = fakeGit({ staged: 1, upstream: 'origin/main' });
    await shareToGit({ git, dir, pathspec: '.tre-mem', message: 'm', commit: true, push: true });

    const attrs = join(dir, '.gitattributes');
    expect(existsSync(attrs)).toBe(true);
    expect(readFileSync(attrs, 'utf8')).toContain('*.jsonl merge=union');
  });

  test('commits and pushes when there are staged changes and an upstream', async () => {
    const git = fakeGit({ staged: 3, upstream: 'origin/feat', branch: 'feat' });
    const r = await shareToGit({
      git,
      dir,
      pathspec: '.tre-mem',
      message: 'share 3',
      commit: true,
      push: true,
    });

    expect(r).toMatchObject({ staged: 3, committed: true, pushed: true, upstream: 'origin/feat' });
    expect(git.calls).toEqual(['add .tre-mem', 'commit share 3', 'push']);
  });

  test('does nothing when there is nothing staged', async () => {
    const git = fakeGit({ staged: 0 });
    const r = await shareToGit({
      git,
      dir,
      pathspec: '.tre-mem',
      message: 'm',
      commit: true,
      push: true,
    });

    expect(r.committed).toBe(false);
    expect(r.pushed).toBe(false);
    expect(r.note).toContain('nothing new to share');
    expect(git.calls).toEqual(['add .tre-mem']); // never committed or pushed
  });

  test('commits but emits a push hint when the branch has no upstream', async () => {
    const git = fakeGit({ staged: 2, upstream: null, branch: 'feature/x' });
    const r = await shareToGit({
      git,
      dir,
      pathspec: '.tre-mem',
      message: 'm',
      commit: true,
      push: true,
    });

    expect(r).toMatchObject({ committed: true, pushed: false });
    expect(r.pushHint).toBe('git push -u origin feature/x');
    expect(git.calls).not.toContain('push');
  });

  test('--no-push commits without pushing', async () => {
    const git = fakeGit({ staged: 1, upstream: 'origin/main' });
    const r = await shareToGit({
      git,
      dir,
      pathspec: '.tre-mem',
      message: 'm',
      commit: true,
      push: false,
    });

    expect(r).toMatchObject({ committed: true, pushed: false });
    expect(r.note).toContain('--no-push');
    expect(git.calls).not.toContain('push');
  });

  test('--no-commit stages only', async () => {
    const git = fakeGit({ staged: 4 });
    const r = await shareToGit({
      git,
      dir,
      pathspec: '.tre-mem',
      message: 'm',
      commit: false,
      push: true,
    });

    expect(r).toMatchObject({ staged: 4, committed: false, pushed: false });
    expect(git.calls).toEqual(['add .tre-mem']);
  });

  test('a failed push keeps the commit and returns a retry hint, never throws', async () => {
    const git = fakeGit({
      staged: 1,
      upstream: 'origin/main',
      pushError: new Error('fatal: Authentication failed\nmore detail'),
    });
    const r = await shareToGit({
      git,
      dir,
      pathspec: '.tre-mem',
      message: 'm',
      commit: true,
      push: true,
    });

    expect(r).toMatchObject({ committed: true, pushed: false, pushHint: 'git push' });
    expect(r.note).toContain('push failed: fatal: Authentication failed');
    expect(r.note).not.toContain('more detail'); // only the first line
  });
});

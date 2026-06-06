import { simpleGit } from 'simple-git';

import { ensureGitattributes } from './layout.js';

/**
 * The minimal git surface `tre share` needs. Injected so tests can drive the
 * publish flow without a real repo or remote. The simple-git-backed default is
 * `simpleGitShare()` below.
 */
export interface ShareGit {
  /** Stage everything under `pathspec` (relative to the repo root). */
  add(pathspec: string): Promise<void>;
  /** Number of staged files under `pathspec` (git diff --cached). */
  stagedCount(pathspec: string): Promise<number>;
  /** Commit staged changes with `message`. */
  commit(message: string): Promise<void>;
  /** Current branch name (`git rev-parse --abbrev-ref HEAD`). */
  currentBranch(): Promise<string>;
  /** Configured upstream for the current branch, or null when none is set. */
  upstream(): Promise<string | null>;
  /** Push the current branch to its upstream. */
  push(): Promise<void>;
}

export interface ShareGitOptions {
  git: ShareGit;
  /** Absolute `.tre-mem` directory, used to backfill `.gitattributes`. */
  dir: string;
  /** Pathspec to stage + commit, relative to the repo root (e.g. `.tre-mem`). */
  pathspec: string;
  message: string;
  /** When false, stage only (no commit, no push). */
  commit: boolean;
  /** When false, commit but do not push. */
  push: boolean;
}

export interface ShareGitResult {
  staged: number;
  committed: boolean;
  pushed: boolean;
  branch: string;
  upstream: string | null;
  /** Exact command for the user to run when we could not push automatically. */
  pushHint: string | null;
  /** Human-readable note when the flow stopped early (nothing to share, etc.). */
  note: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0]!.trim() : 'unknown error';
}

/**
 * Publish `.tre-mem` to git: stage → commit → push, degrading gracefully at every
 * step. It never throws on a git failure — a failed push leaves the commit in place
 * and returns the exact `git push` for the user to run. Provider-agnostic: plain git
 * only, so any remote (GitHub, GitLab, Bitbucket, a bare repo) works.
 */
export async function shareToGit(opts: ShareGitOptions): Promise<ShareGitResult> {
  const { git, dir, pathspec, message } = opts;
  ensureGitattributes(dir);

  await git.add(pathspec);
  const staged = await git.stagedCount(pathspec);
  const branch = await git.currentBranch();

  if (staged === 0) {
    return {
      staged: 0,
      committed: false,
      pushed: false,
      branch,
      upstream: await git.upstream(),
      pushHint: null,
      note: 'nothing new to share — .tre-mem is already committed',
    };
  }

  if (!opts.commit) {
    return {
      staged,
      committed: false,
      pushed: false,
      branch,
      upstream: null,
      pushHint: null,
      note: `staged ${staged} file(s) (--no-commit); commit + push when ready`,
    };
  }

  await git.commit(message);
  const upstream = await git.upstream();

  if (!opts.push) {
    return {
      staged,
      committed: true,
      pushed: false,
      branch,
      upstream,
      pushHint: null,
      note: 'committed (--no-push)',
    };
  }

  if (upstream === null) {
    return {
      staged,
      committed: true,
      pushed: false,
      branch,
      upstream: null,
      pushHint: `git push -u origin ${branch}`,
      note: 'committed, but this branch has no upstream yet',
    };
  }

  try {
    await git.push();
    return { staged, committed: true, pushed: true, branch, upstream, pushHint: null, note: null };
  } catch (error) {
    return {
      staged,
      committed: true,
      pushed: false,
      branch,
      upstream,
      pushHint: 'git push',
      note: `push failed: ${errorMessage(error)}`,
    };
  }
}

/** simple-git-backed {@link ShareGit} rooted at `cwd`. */
export function simpleGitShare(cwd: string): ShareGit {
  const g = simpleGit(cwd);
  return {
    async add(pathspec) {
      await g.add(pathspec);
    },
    async stagedCount(pathspec) {
      const out = await g.diff(['--cached', '--name-only', '--', pathspec]);
      return out.split('\n').filter((l) => l.trim() !== '').length;
    },
    async commit(message) {
      await g.commit(message);
    },
    async currentBranch() {
      return (await g.revparse(['--abbrev-ref', 'HEAD'])).trim();
    },
    async upstream() {
      try {
        const ref = await g.revparse(['--abbrev-ref', '--symbolic-full-name', '@{u}']);
        const trimmed = ref.trim();
        return trimmed === '' ? null : trimmed;
      } catch {
        return null;
      }
    },
    async push() {
      await g.push();
    },
  };
}

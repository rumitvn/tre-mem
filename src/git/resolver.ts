import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

export const NO_GIT = '(no-git)';
export const DETACHED_PREFIX = '(detached:';
const DETACHED_SHA_LENGTH = 12;

export interface ResolverOptions {
  /** Override the git binary lookup; useful for tests. */
  binary?: string;
}

export async function currentBranch(
  cwd: string,
  opts: ResolverOptions = {},
): Promise<string> {
  if (!existsSync(cwd) || !existsSync(join(cwd, '.git'))) {
    return NO_GIT;
  }
  const git = simpleGit(cwd);
  if (opts.binary) {
    git.customBinary(opts.binary);
  }
  try {
    const head = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    if (head === 'HEAD') {
      const sha = (await git.revparse(['HEAD'])).trim();
      return `${DETACHED_PREFIX}${sha.slice(0, DETACHED_SHA_LENGTH)})`;
    }
    return head;
  } catch {
    return NO_GIT;
  }
}

export function isDetached(branch: string): boolean {
  return branch.startsWith(DETACHED_PREFIX) && branch.endsWith(')');
}

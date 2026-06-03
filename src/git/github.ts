import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Resolve a PR number to its head (source) branch via the GitHub CLI.
 * Returns null if `gh` is unavailable or the lookup fails.
 */
export async function prHeadBranch(pr: number, repo?: string): Promise<string | null> {
  const args = ['pr', 'view', String(pr), '--json', 'headRefName', '-q', '.headRefName'];
  if (repo) args.push('--repo', repo);
  try {
    const { stdout } = await exec('gh', args);
    const branch = stdout.trim();
    return branch === '' ? null : branch;
  } catch {
    return null;
  }
}

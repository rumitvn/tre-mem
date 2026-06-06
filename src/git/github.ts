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

/**
 * The CI environment variables, in priority order, that carry the merged source
 * branch on the major providers. This is what makes graduation provider-agnostic
 * and `gh`-free: GitLab/Bitbucket/Jenkins pass the branch directly, no API call.
 */
const CI_BRANCH_ENV_VARS = [
  'GITHUB_HEAD_REF', // GitHub Actions — PR head (source) branch
  'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', // GitLab CI — MR source branch
  'BITBUCKET_BRANCH', // Bitbucket Pipelines
  'CI_COMMIT_REF_NAME', // GitLab CI — current branch (fallback)
  'GITHUB_REF_NAME', // GitHub Actions — current ref (fallback)
] as const;

/**
 * Infer the branch to graduate from CI environment variables, without any
 * provider API or `gh`. Returns null when not running in a recognized CI.
 */
export function branchFromCiEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of CI_BRANCH_ENV_VARS) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return null;
}

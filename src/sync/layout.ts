import { join } from 'node:path';

/** Directory committed to the repo that carries shared pins + graduated facts. */
export const SYNC_DIR_NAME = '.tre-mem';

/**
 * Filesystem-safe slug for a branch name. The original branch name is preserved
 * verbatim inside each JSONL row's `branch` field — this is only for filenames.
 * `feature/payment` → `feature-payment`.
 */
export function branchSlug(branch: string): string {
  const slug = branch.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'branch' : slug;
}

export function branchFilePath(dir: string, branch: string): string {
  return join(dir, 'branches', `${branchSlug(branch)}.jsonl`);
}

export function graduatedFilePath(dir: string): string {
  return join(dir, 'graduated.jsonl');
}

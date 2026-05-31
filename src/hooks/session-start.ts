import { basename } from 'node:path';

import { currentBranch } from '../git/resolver.js';
import { TreMemRepo } from '../store/repo.js';

export type SessionStartSource = 'startup' | 'resume' | 'clear' | string;

export interface SessionStartInput {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  source?: SessionStartSource;
}

export interface SessionStartOptions {
  /** Inject a repo handle for tests; otherwise a default one is opened. */
  repo?: TreMemRepo;
  /** Override the timestamp source (epoch seconds). */
  now?: () => number;
}

export interface SessionStartResult {
  project: string;
  cwd: string;
  branch: string;
  source: SessionStartSource;
  tagged_at_epoch: number;
  tagged_count_for_branch: number;
  tagged_count_for_project: number;
  message: string;
}

export async function runSessionStartHook(
  input: SessionStartInput,
  opts: SessionStartOptions = {},
): Promise<SessionStartResult> {
  const cwd = input.cwd ?? process.cwd();
  const project = basename(cwd);
  const source = input.source ?? 'startup';
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const tagged_at_epoch = now();

  const branch = await currentBranch(cwd);

  const ownsRepo = !opts.repo;
  const repo = opts.repo ?? new TreMemRepo();
  try {
    repo.upsertBranchState({
      cwd,
      project,
      current_branch: branch,
      updated_at_epoch: tagged_at_epoch,
    });
    const tagged_count_for_branch = repo.countBranchTags(project, branch);
    const tagged_count_for_project = repo.countBranchTags(project);
    const message = formatMessage({
      project,
      branch,
      tagged_count_for_branch,
      tagged_count_for_project,
      source,
    });
    return {
      project,
      cwd,
      branch,
      source,
      tagged_at_epoch,
      tagged_count_for_branch,
      tagged_count_for_project,
      message,
    };
  } finally {
    if (ownsRepo) repo.close();
  }
}

function formatMessage(parts: {
  project: string;
  branch: string;
  tagged_count_for_branch: number;
  tagged_count_for_project: number;
  source: SessionStartSource;
}): string {
  return (
    `tre-mem: project=${parts.project} branch=${parts.branch} ` +
    `tagged_on_branch=${parts.tagged_count_for_branch} ` +
    `tagged_on_project=${parts.tagged_count_for_project} (source=${parts.source})`
  );
}

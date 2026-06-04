import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { currentBranch } from '../git/resolver.js';
import { log, logError } from '../log/logger.js';
import { TreMemRepo } from '../store/repo.js';
import { importDir } from '../sync/import.js';
import { SYNC_DIR_NAME } from '../sync/layout.js';

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
  /** Skip the auto-import of the committed `.tre-mem/` directory. */
  skipImport?: boolean;
}

export interface SessionStartResult {
  project: string;
  cwd: string;
  branch: string;
  source: SessionStartSource;
  tagged_at_epoch: number;
  tagged_count_for_branch: number;
  tagged_count_for_project: number;
  imported_pins: number;
  imported_graduated: number;
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
  const startedMs = Date.now();

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

    // Auto-import teammates' shared memory. Cheap + idempotent: unchanged
    // files are skipped via import_state SHA tracking. Never blocks a session.
    let imported_pins = 0;
    let imported_graduated = 0;
    if (!opts.skipImport) {
      const syncDir = join(cwd, SYNC_DIR_NAME);
      if (existsSync(syncDir)) {
        try {
          const result = importDir({ repo, dir: syncDir, now: tagged_at_epoch });
          imported_pins = result.pins;
          imported_graduated = result.graduated;
        } catch (err) {
          /* a broken .tre-mem/ must never block a session */
          logError('hook', 'session_import_failed', err, { project, branch });
        }
      }
    }

    const message = formatMessage({
      project,
      branch,
      tagged_count_for_branch,
      tagged_count_for_project,
      imported_pins,
      imported_graduated,
      source,
    });
    log({
      level: 'info',
      component: 'hook',
      event: 'session_start',
      fields: {
        project,
        branch,
        source,
        tagged_branch: tagged_count_for_branch,
        tagged_project: tagged_count_for_project,
        imported_pins,
        imported_graduated,
        ms: Date.now() - startedMs,
      },
    });
    return {
      project,
      cwd,
      branch,
      source,
      tagged_at_epoch,
      tagged_count_for_branch,
      tagged_count_for_project,
      imported_pins,
      imported_graduated,
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
  imported_pins: number;
  imported_graduated: number;
  source: SessionStartSource;
}): string {
  const imported =
    parts.imported_pins + parts.imported_graduated > 0
      ? ` imported=${parts.imported_pins}pin/${parts.imported_graduated}grad`
      : '';
  return (
    `tre-mem: project=${parts.project} branch=${parts.branch} ` +
    `tagged_on_branch=${parts.tagged_count_for_branch} ` +
    `tagged_on_project=${parts.tagged_count_for_project}${imported} (source=${parts.source})`
  );
}

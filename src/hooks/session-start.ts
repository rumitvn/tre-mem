import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  type PinnedFact,
  type RecentObs,
  buildSessionDigest,
  timeLabel,
} from '../format/digest.js';
import { currentBranch } from '../git/resolver.js';
import { log, logError } from '../log/logger.js';
import { resolveProjectIdentity } from '../store/aliases.js';
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
  /** Injectable git-remote resolver for cross-clone identity (tests override). */
  resolveRemote?: (cwd: string) => Promise<string | null>;
  /**
   * Resolve the most-recent branch-tagged observations for the digest. May
   * throw (e.g. claude-mem missing) — the hook then renders an empty list plus
   * a hint and never fails. Returns [] when there simply are no tags yet.
   */
  recent?: (args: { project: string; branch: string }) => RecentObs[];
  /**
   * Resolve curated pins for this branch (with notes). Resilient: works from the
   * pins' own snapshots even when claude-mem is unavailable. Returns [] when the
   * branch has no pins.
   */
  pinned?: (args: { project: string; branch: string }) => PinnedFact[];
  /**
   * Live dashboard URL to surface in the digest. The CLI resolves this by
   * auto-starting the background `tre web` daemon; left undefined in tests.
   */
  dashboardUrl?: string;
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
  /** Plain ASCII digest for the model (`additionalContext`). */
  message: string;
  /** Colored digest for display (`systemMessage`). */
  display: string;
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
    const identity = await resolveProjectIdentity(repo, cwd, {
      resolveRemote: opts.resolveRemote,
    });
    repo.upsertBranchState({
      cwd,
      project,
      current_branch: branch,
      updated_at_epoch: tagged_at_epoch,
      remote: identity.remote,
    });
    const tagged_count_for_branch = repo.countBranchTagsAcross(identity.aliases, branch);
    const tagged_count_for_project = repo.countBranchTagsAcross(identity.aliases);

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

    let recent: RecentObs[] = [];
    let note: string | undefined;
    if (opts.recent) {
      try {
        recent = opts.recent({ project, branch });
      } catch (err) {
        // claude-mem missing/incompatible — never block the session.
        logError('hook', 'session_recent_failed', err, { project, branch });
        note = 'claude-mem unavailable — run `tre doctor` for setup help.';
      }
    }

    let pinned: PinnedFact[] = [];
    if (opts.pinned) {
      try {
        pinned = opts.pinned({ project, branch });
      } catch (err) {
        // Pins must never block a session — degrade to no pinned block.
        logError('hook', 'session_pinned_failed', err, { project, branch });
      }
    }

    const digest = buildSessionDigest({
      project,
      branch,
      source,
      timeLabel: timeLabel(new Date(tagged_at_epoch * 1000)),
      taggedOnBranch: tagged_count_for_branch,
      taggedOnProject: tagged_count_for_project,
      importedPins: imported_pins,
      importedGraduated: imported_graduated,
      pinned,
      recent,
      note,
      dashboardUrl: opts.dashboardUrl,
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
      message: digest.context,
      display: digest.display,
    };
  } finally {
    if (ownsRepo) repo.close();
  }
}

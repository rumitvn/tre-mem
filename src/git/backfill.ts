import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import { log } from '../log/logger.js';
import type { TreMemRepo } from '../store/repo.js';

import { readHeadReflog, resolveBranchAt } from './reflog.js';

export interface BackfillOptions {
  project: string;
  cwd: string;
  adapter: ClaudeMemAdapter;
  repo: TreMemRepo;
  sinceEpoch?: number;
  limit?: number;
  now?: () => number;
  /**
   * Branch to use when the reflog cannot resolve one for an observation
   * (e.g. single-branch repo with no checkout history). Omit to keep strict
   * reflog-only tagging.
   */
  fallbackBranch?: string;
}

export interface BackfillResult {
  project: string;
  cwd: string;
  transitions: number;
  scanned: number;
  tagged: number;
  skippedAlreadyTagged: number;
  skippedNoBranch: number;
}

export async function backfill(opts: BackfillOptions): Promise<BackfillResult> {
  const transitions = await readHeadReflog(opts.cwd);
  const observations = opts.adapter.getObservations({
    projects: [opts.project],
    sinceEpoch: opts.sinceEpoch,
    limit: opts.limit,
  });
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  const result: BackfillResult = {
    project: opts.project,
    cwd: opts.cwd,
    transitions: transitions.length,
    scanned: observations.length,
    tagged: 0,
    skippedAlreadyTagged: 0,
    skippedNoBranch: 0,
  };

  for (const obs of observations) {
    if (opts.repo.hasBranchTag(obs.id)) {
      result.skippedAlreadyTagged += 1;
      continue;
    }
    const resolved = resolveBranchAt(transitions, obs.created_at_epoch);
    const branch = resolved ?? opts.fallbackBranch ?? null;
    if (branch === null) {
      result.skippedNoBranch += 1;
      continue;
    }
    opts.repo.upsertBranchTag({
      observation_id: obs.id,
      project: opts.project,
      branch,
      tagged_at_epoch: now(),
      source: 'reflog-backfill',
    });
    result.tagged += 1;
  }

  log({
    level: 'info',
    component: 'backfill',
    event: 'backfill',
    fields: {
      project: result.project,
      transitions: result.transitions,
      scanned: result.scanned,
      tagged: result.tagged,
      skippedAlreadyTagged: result.skippedAlreadyTagged,
      skippedNoBranch: result.skippedNoBranch,
    },
  });

  return result;
}

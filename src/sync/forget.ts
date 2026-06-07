import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { log } from '../log/logger.js';
import type { TreMemRepo } from '../store/repo.js';

import { parseSyncLine, serializeSyncRecord, type TombstoneRecord } from './format.js';
import { branchFilePath, graduatedFilePath, writeFileAtomic } from './layout.js';

export interface ForgetResult {
  /** Rows removed from the local sidecar DB. */
  removed: number;
  /** True when a tombstone was written to `.tre-mem/` to propagate the removal. */
  tombstoned: boolean;
}

export interface ForgetPinOptions {
  repo: TreMemRepo;
  /** The committed `.tre-mem/` directory (same `dir` convention as exportSync). */
  dir: string;
  project: string;
  branch: string;
  observation_id: number;
  now: number;
  author?: string | null;
}

export interface ForgetGraduatedOptions {
  repo: TreMemRepo;
  /** The committed `.tre-mem/` directory (same `dir` convention as exportSync). */
  dir: string;
  project: string;
  observation_id: number;
  now: number;
  author?: string | null;
}

/**
 * Append a tombstone line to a shared JSONL file unless an identical one is
 * already there. Dedup is by (`kind === 'tombstone'`, `content_hash`) — NOT by
 * content_hash alone, since the fact being removed carries the same hash.
 * Returns true when a line was written.
 */
function appendTombstone(filePath: string, record: TombstoneRecord): boolean {
  const existingLines = existsSync(filePath)
    ? readFileSync(filePath, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
    : [];
  for (const line of existingLines) {
    try {
      const parsed = parseSyncLine(line);
      if (parsed.kind === 'tombstone' && parsed.content_hash === record.content_hash) {
        return false; // already tombstoned — idempotent
      }
    } catch {
      /* unparseable lines can't be a matching tombstone; ignore */
    }
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileAtomic(filePath, [...existingLines, serializeSyncRecord(record)].join('\n') + '\n');
  return true;
}

/**
 * Forget pins for (project, branch, observation_id): write a propagating
 * tombstone for each *shared* pin (so teammates lose it on next import), then
 * delete the local rows. Pins that were never shared have no shared line to
 * remove, so they are simply deleted locally (no tombstone).
 */
export function forgetPin(opts: ForgetPinOptions): ForgetResult {
  const { repo, dir, project, branch, observation_id, now } = opts;
  const author = opts.author ?? null;

  const shared = repo
    .listPinsForBranch(project, branch)
    .filter((p) => p.observation_id === observation_id && p.content_hash !== null);

  let tombstoned = false;
  if (existsSync(dir)) {
    for (const pin of shared) {
      const wrote = appendTombstone(branchFilePath(dir, branch), {
        schema: 1,
        kind: 'tombstone',
        content_hash: pin.content_hash as string,
        target_kind: 'pin',
        project,
        branch,
        observation_id,
        author,
        tombstoned_at_epoch: now,
      });
      tombstoned = tombstoned || wrote;
    }
  }

  const removed = repo.deletePinsByObservation(project, branch, observation_id);
  if (removed > 0) {
    log({
      level: 'info',
      component: 'sync',
      event: 'forget_pin',
      fields: { project, branch, observation_id, removed, tombstoned },
    });
  }
  return { removed, tombstoned };
}

/**
 * Forget a graduated fact (project, observation_id): write a propagating
 * tombstone if it was shared, then delete the local row. Re-graduating with
 * corrected content is the supported "update" path (new content → new hash).
 */
export function forgetGraduated(opts: ForgetGraduatedOptions): ForgetResult {
  const { repo, dir, project, observation_id, now } = opts;
  const author = opts.author ?? null;

  const grad = repo.getGraduated(project, observation_id);
  if (grad === null) return { removed: 0, tombstoned: false };

  let tombstoned = false;
  if (grad.content_hash !== null && existsSync(dir)) {
    tombstoned = appendTombstone(graduatedFilePath(dir), {
      schema: 1,
      kind: 'tombstone',
      content_hash: grad.content_hash,
      target_kind: 'graduated',
      project,
      branch: null,
      observation_id,
      author,
      tombstoned_at_epoch: now,
    });
  }

  const removed = repo.deleteGraduatedByObservation(project, observation_id) ? 1 : 0;
  if (removed > 0) {
    log({
      level: 'info',
      component: 'sync',
      event: 'forget_graduated',
      fields: { project, observation_id, removed, tombstoned },
    });
  }
  return { removed, tombstoned };
}

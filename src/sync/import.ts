import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { TreMemRepo } from '../store/repo.js';

import { parseSyncLine } from './format.js';
import { graduatedFilePath } from './layout.js';

export interface ImportOptions {
  repo: TreMemRepo;
  dir: string;
  now: number;
  /** Re-import files even if their content hash matches the last import. */
  force?: boolean;
}

export interface ImportFileResult {
  file: string;
  inserted: number;
  duplicates: number;
  errors: number;
  /** True when the file was skipped because its SHA matched the last import. */
  unchanged: boolean;
}

export interface ImportResult {
  dir: string;
  pins: number;
  graduated: number;
  files: ImportFileResult[];
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function listJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  const graduated = graduatedFilePath(dir);
  if (existsSync(graduated)) files.push(graduated);
  const branchesDir = join(dir, 'branches');
  if (existsSync(branchesDir)) {
    for (const name of readdirSync(branchesDir).sort()) {
      if (name.endsWith('.jsonl')) files.push(join(branchesDir, name));
    }
  }
  return files;
}

function importFile(
  repo: TreMemRepo,
  filePath: string,
  now: number,
  force: boolean,
): { result: ImportFileResult; pins: number; graduated: number } {
  const content = readFileSync(filePath, 'utf8');
  const sha = sha256(content);

  const prior = repo.getImportState(filePath);
  if (!force && prior !== null && prior.last_sha === sha) {
    return {
      result: { file: filePath, inserted: 0, duplicates: 0, errors: 0, unchanged: true },
      pins: 0,
      graduated: 0,
    };
  }

  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  let pins = 0;
  let graduated = 0;

  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = parseSyncLine(line);
    } catch {
      errors++;
      continue;
    }
    if (record.kind === 'pin') {
      const added = repo.importPin({
        project: record.project,
        branch: record.branch,
        observation_id: record.observation_id,
        note: record.note,
        created_at_epoch: record.tagged_at_epoch,
        content_hash: record.content_hash,
        shared_at_epoch: record.tagged_at_epoch,
      });
      if (added) {
        inserted++;
        pins++;
      } else {
        duplicates++;
      }
    } else {
      const added = repo.importGraduated({
        project: record.project,
        observation_id: record.observation_id,
        graduated_from_branch: record.graduated_from_branch,
        graduated_at_epoch: record.graduated_at_epoch,
        content_hash: record.content_hash,
        shared_at_epoch: record.graduated_at_epoch,
      });
      if (added) {
        inserted++;
        graduated++;
      } else {
        duplicates++;
      }
    }
  }

  repo.upsertImportState(filePath, sha, now);
  return {
    result: { file: filePath, inserted, duplicates, errors, unchanged: false },
    pins,
    graduated,
  };
}

/**
 * Import a teammate's committed `.tre-mem/` directory into the local sidecar.
 * Idempotent: unchanged files are skipped via `import_state` SHA tracking, and
 * individual rows dedupe on `content_hash`. Malformed lines are counted and
 * skipped, never abort the whole import.
 */
export function importDir(opts: ImportOptions): ImportResult {
  const { repo, dir, now, force = false } = opts;
  if (!existsSync(dir)) {
    return { dir, pins: 0, graduated: 0, files: [] };
  }

  const files: ImportFileResult[] = [];
  let pins = 0;
  let graduated = 0;
  for (const filePath of listJsonlFiles(dir)) {
    const { result, pins: p, graduated: g } = importFile(repo, filePath, now, force);
    files.push(result);
    pins += p;
    graduated += g;
  }
  return { dir, pins, graduated, files };
}

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { log } from '../log/logger.js';

import {
  SYNC_SCHEMA_VERSION,
  graduatedContentHash,
  parseSyncLine,
  serializeSyncRecord,
  type GraduatedRecord,
  type PinRecord,
} from './format.js';
import { branchFilePath, graduatedFilePath, writeFileAtomic } from './layout.js';

export interface GraduateOptions {
  /** Path to the committed `.tre-mem/` directory. */
  dir: string;
  /** The merged branch whose pins graduate to repo-wide facts. */
  branch: string;
  now: number;
  author?: string | null;
  dryRun?: boolean;
}

export interface GraduateResult {
  branch: string;
  file: string;
  graduated: number;
  alreadyGraduated: number;
  /** Pins skipped because they have no observation id (free-text cannot graduate). */
  skippedFreeText: number;
  dryRun: boolean;
}

function readPins(file: string): PinRecord[] {
  if (!existsSync(file)) return [];
  const pins: PinRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const record = parseSyncLine(line);
      if (record.kind === 'pin') pins.push(record);
    } catch {
      /* skip unparseable / newer-schema lines */
    }
  }
  return pins;
}

function existingHashes(file: string): { lines: string[]; hashes: Set<string> } {
  if (!existsSync(file)) return { lines: [], hashes: new Set() };
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const hashes = new Set<string>();
  for (const line of lines) {
    try {
      hashes.add(parseSyncLine(line).content_hash);
    } catch {
      /* passthrough */
    }
  }
  return { lines, hashes };
}

/**
 * Promote a merged branch's pins into repo-wide graduated facts: read
 * `.tre-mem/branches/<branch>.jsonl`, append each pin (that references an
 * observation) to `graduated.jsonl`, deduping on content_hash. Append-only and
 * idempotent — re-running on the same branch adds nothing new.
 */
export function graduateBranch(opts: GraduateOptions): GraduateResult {
  const { dir, branch, now, dryRun = false } = opts;
  const author = opts.author ?? null;
  const gradFile = graduatedFilePath(dir);

  const pins = readPins(branchFilePath(dir, branch));
  const { lines, hashes } = existingHashes(gradFile);

  let skippedFreeText = 0;
  let alreadyGraduated = 0;
  const newLines: string[] = [];

  for (const pin of pins) {
    if (pin.observation_id === null) {
      skippedFreeText++;
      continue;
    }
    const record: GraduatedRecord = {
      schema: SYNC_SCHEMA_VERSION,
      kind: 'graduated',
      content_hash: graduatedContentHash({
        project: pin.project,
        observation_id: pin.observation_id,
        graduated_from_branch: branch,
        title: pin.title,
        body: pin.body,
      }),
      project: pin.project,
      observation_id: pin.observation_id,
      graduated_from_branch: branch,
      title: pin.title,
      body: pin.body,
      author,
      graduated_at_epoch: now,
    };
    if (hashes.has(record.content_hash)) {
      alreadyGraduated++;
      continue;
    }
    hashes.add(record.content_hash);
    newLines.push(serializeSyncRecord(record));
  }

  if (!dryRun && newLines.length > 0) {
    mkdirSync(dirname(gradFile), { recursive: true });
    writeFileAtomic(gradFile, [...lines, ...newLines].join('\n') + '\n');
  }

  log({
    level: 'info',
    component: 'sync',
    event: 'graduate_pr',
    fields: {
      branch,
      graduated: newLines.length,
      alreadyGraduated,
      skippedFreeText,
      dryRun,
    },
  });

  return {
    branch,
    file: gradFile,
    graduated: newLines.length,
    alreadyGraduated,
    skippedFreeText,
    dryRun,
  };
}

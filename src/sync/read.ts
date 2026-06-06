import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseSyncLine, type GraduatedRecord, type PinRecord, type SyncRecord } from './format.js';
import { graduatedFilePath } from './layout.js';

/**
 * Enumerate the JSONL files in a committed `.tre-mem/` directory: the single
 * `graduated.jsonl` plus every `branches/*.jsonl`, in a stable sorted order.
 */
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

/**
 * Read every shared pin + graduated record out of a committed `.tre-mem/`
 * directory. Read-only counterpart to `importDir` (no DB writes, no SHA state):
 * the web layer uses this to surface the `author` field — which lives only in
 * the JSONL, never in the sidecar DB. Malformed / newer-schema lines are skipped
 * rather than aborting the read. A missing directory yields an empty list.
 */
export function readSyncRecords(dir: string): SyncRecord[] {
  if (!existsSync(dir)) return [];
  const records: SyncRecord[] = [];
  for (const filePath of listJsonlFiles(dir)) {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        records.push(parseSyncLine(line));
      } catch {
        /* skip unparseable / newer-schema lines, same as importDir */
      }
    }
  }
  return records;
}

/** Same read, split into the two record kinds for callers that want them apart. */
export function readSyncDir(dir: string): { pins: PinRecord[]; graduated: GraduatedRecord[] } {
  const pins: PinRecord[] = [];
  const graduated: GraduatedRecord[] = [];
  for (const record of readSyncRecords(dir)) {
    if (record.kind === 'pin') pins.push(record);
    else graduated.push(record);
  }
  return { pins, graduated };
}

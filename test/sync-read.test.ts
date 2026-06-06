import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  graduatedContentHash,
  pinContentHash,
  serializeSyncRecord,
  SYNC_SCHEMA_VERSION,
  type GraduatedRecord,
  type PinRecord,
} from '../src/sync/format.js';
import { branchFilePath, graduatedFilePath } from '../src/sync/layout.js';
import { readSyncDir, readSyncRecords } from '../src/sync/read.js';

function pin(over: Partial<PinRecord> = {}): PinRecord {
  const base = {
    project: 'p',
    branch: 'feature/x',
    observation_id: 1 as number | null,
    note: null as string | null,
    title: 'decision' as string | null,
    body: 'body' as string | null,
    ...over,
  };
  return {
    schema: SYNC_SCHEMA_VERSION,
    kind: 'pin',
    content_hash: pinContentHash(base),
    author: 'alice',
    tagged_at_epoch: 100,
    ...base,
  } as PinRecord;
}

function grad(over: Partial<GraduatedRecord> = {}): GraduatedRecord {
  const base = {
    project: 'p',
    observation_id: 9,
    graduated_from_branch: 'feature/x',
    title: 'rooted fact' as string | null,
    body: 'body' as string | null,
    ...over,
  };
  return {
    schema: SYNC_SCHEMA_VERSION,
    kind: 'graduated',
    content_hash: graduatedContentHash(base),
    author: 'bob',
    graduated_at_epoch: 200,
    ...base,
  } as GraduatedRecord;
}

describe('readSyncRecords', () => {
  let tmp: string;
  let dir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-read-'));
    dir = join(tmp, '.tre-mem');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('returns empty for a missing directory', () => {
    expect(readSyncRecords(join(tmp, 'nope'))).toEqual([]);
  });

  test('reads pins from branches/*.jsonl and facts from graduated.jsonl', () => {
    mkdirSync(join(dir, 'branches'), { recursive: true });
    writeFileSync(
      branchFilePath(dir, 'feature/x'),
      `${serializeSyncRecord(pin({ observation_id: 1 }))}\n${serializeSyncRecord(
        pin({ observation_id: 2, title: 'second' }),
      )}\n`,
    );
    writeFileSync(graduatedFilePath(dir), `${serializeSyncRecord(grad())}\n`);

    const { pins, graduated } = readSyncDir(dir);
    expect(pins).toHaveLength(2);
    expect(graduated).toHaveLength(1);
    expect(pins[0]?.author).toBe('alice');
    expect(graduated[0]?.author).toBe('bob');
  });

  test('skips malformed and blank lines without throwing', () => {
    mkdirSync(join(dir, 'branches'), { recursive: true });
    writeFileSync(
      branchFilePath(dir, 'feature/x'),
      `${serializeSyncRecord(pin())}\n\nnot json at all\n{"schema":999,"kind":"pin"}\n`,
    );

    const records = readSyncRecords(dir);
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe('pin');
  });
});

import { mkdirSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import { exportSync, type SnapshotProvider } from '../src/sync/export.js';
import {
  graduatedContentHash,
  pinContentHash,
  serializeSyncRecord,
  type TombstoneRecord,
} from '../src/sync/format.js';
import { importDir } from '../src/sync/import.js';
import { branchFilePath, graduatedFilePath } from '../src/sync/layout.js';

const noSnapshots: SnapshotProvider = { getSnapshots: () => new Map() };

function freshRepo(tmp: string, name: string): TreMemRepo {
  const dbPath = join(tmp, `${name}.db`);
  migrate(dbPath);
  return new TreMemRepo({ dbPath });
}

describe('importDir', () => {
  let tmp: string;
  let dir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-import-'));
    dir = join(tmp, '.tre-mem');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('round-trips alice export -> bob import', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.addPin({
      project: 'p',
      branch: 'feature/payment',
      observation_id: 42,
      note: 'webhook v3',
      created_at_epoch: 100,
    });
    exportSync({
      repo: alice,
      snapshots: noSnapshots,
      project: 'p',
      dir,
      branches: ['feature/payment'],
      now: 1,
      author: 'alice',
    });
    alice.close();

    const bob = freshRepo(tmp, 'bob');
    try {
      const result = importDir({ repo: bob, dir, now: 2 });
      expect(result.pins).toBe(1);

      const pins = bob.listPinsForBranch('p', 'feature/payment');
      expect(pins).toHaveLength(1);
      expect(pins[0]).toMatchObject({ observation_id: 42, note: 'webhook v3' });
      expect(pins[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      bob.close();
    }
  });

  test('is idempotent: re-import of unchanged files skips via SHA', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 1,
      note: 'n',
      created_at_epoch: 10,
    });
    exportSync({
      repo: alice,
      snapshots: noSnapshots,
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
    });
    alice.close();

    const bob = freshRepo(tmp, 'bob');
    try {
      importDir({ repo: bob, dir, now: 2 });
      const second = importDir({ repo: bob, dir, now: 3 });

      expect(second.pins).toBe(0);
      const mainFile = second.files.find((f) => f.file.endsWith('main.jsonl'));
      expect(mainFile?.unchanged).toBe(true);
      expect(bob.listPinsForBranch('p', 'main')).toHaveLength(1);
    } finally {
      bob.close();
    }
  });

  test('content-hash dedupe: a changed file re-imports without duplicating known rows', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 1,
      note: 'first',
      created_at_epoch: 10,
    });
    exportSync({
      repo: alice,
      snapshots: noSnapshots,
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
    });

    const bob = freshRepo(tmp, 'bob');
    try {
      importDir({ repo: bob, dir, now: 2 });

      // Alice adds a second pin → file changes (SHA differs) but row 1 is a dup.
      alice.addPin({
        project: 'p',
        branch: 'main',
        observation_id: 2,
        note: 'second',
        created_at_epoch: 20,
      });
      exportSync({
        repo: alice,
        snapshots: noSnapshots,
        project: 'p',
        dir,
        branches: ['main'],
        now: 3,
      });
      alice.close();

      const result = importDir({ repo: bob, dir, now: 4 });
      const mainFile = result.files.find((f) => f.file.endsWith('main.jsonl'));
      expect(mainFile?.inserted).toBe(1);
      expect(mainFile?.duplicates).toBe(1);
      expect(bob.listPinsForBranch('p', 'main')).toHaveLength(2);
    } finally {
      bob.close();
    }
  });

  test('force re-imports even when SHA is unchanged', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 1,
      note: 'n',
      created_at_epoch: 10,
    });
    exportSync({
      repo: alice,
      snapshots: noSnapshots,
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
    });
    alice.close();

    const bob = freshRepo(tmp, 'bob');
    try {
      importDir({ repo: bob, dir, now: 2 });
      const forced = importDir({ repo: bob, dir, now: 3, force: true });
      const mainFile = forced.files.find((f) => f.file.endsWith('main.jsonl'));
      expect(mainFile?.unchanged).toBe(false);
      expect(mainFile?.duplicates).toBe(1); // row already present, deduped on content_hash
      expect(bob.listPinsForBranch('p', 'main')).toHaveLength(1);
    } finally {
      bob.close();
    }
  });

  test('counts malformed lines as errors and imports the rest', () => {
    mkdirSync(join(dir, 'branches'), { recursive: true });
    const alice = freshRepo(tmp, 'alice');
    alice.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 1,
      note: 'good',
      created_at_epoch: 10,
    });
    exportSync({
      repo: alice,
      snapshots: noSnapshots,
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
    });
    alice.close();
    appendFileSync(branchFilePath(dir, 'main'), '{garbage not json\n', 'utf8');

    const bob = freshRepo(tmp, 'bob');
    try {
      const result = importDir({ repo: bob, dir, now: 2 });
      const mainFile = result.files.find((f) => f.file.endsWith('main.jsonl'));
      expect(mainFile?.inserted).toBe(1);
      expect(mainFile?.errors).toBe(1);
    } finally {
      bob.close();
    }
  });

  test('imports graduated facts', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.graduateFact({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      graduated_at_epoch: 200,
    });
    exportSync({ repo: alice, snapshots: noSnapshots, project: 'p', dir, branches: [], now: 1 });
    alice.close();

    const bob = freshRepo(tmp, 'bob');
    try {
      const result = importDir({ repo: bob, dir, now: 2 });
      expect(result.graduated).toBe(1);
      expect(bob.listGraduated('p')).toHaveLength(1);
    } finally {
      bob.close();
    }
  });

  test('missing directory returns an empty result', () => {
    const bob = freshRepo(tmp, 'bob');
    try {
      const result = importDir({ repo: bob, dir: join(tmp, 'nope'), now: 1 });
      expect(result).toMatchObject({ pins: 0, graduated: 0, tombstoned: 0, files: [] });
    } finally {
      bob.close();
    }
  });

  function gradTombstone(hash: string): TombstoneRecord {
    return {
      schema: 1,
      kind: 'tombstone',
      content_hash: hash,
      target_kind: 'graduated',
      project: 'p',
      branch: null,
      observation_id: 7,
      author: 'alice',
      tombstoned_at_epoch: 999,
    };
  }

  test('a tombstone removes a previously-imported graduated fact on re-import', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.graduateFact({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      graduated_at_epoch: 200,
    });
    exportSync({ repo: alice, snapshots: noSnapshots, project: 'p', dir, branches: [], now: 1 });
    alice.close();

    const bob = freshRepo(tmp, 'bob');
    try {
      importDir({ repo: bob, dir, now: 2 });
      expect(bob.listGraduated('p')).toHaveLength(1);

      // Alice forgets the fact: append a tombstone for its content_hash.
      const hash = graduatedContentHash({
        project: 'p',
        observation_id: 7,
        graduated_from_branch: 'feature/x',
        title: null,
        body: null,
      });
      appendFileSync(
        graduatedFilePath(dir),
        serializeSyncRecord(gradTombstone(hash)) + '\n',
        'utf8',
      );

      const result = importDir({ repo: bob, dir, now: 3 });
      expect(result.tombstoned).toBe(1);
      expect(bob.listGraduated('p')).toHaveLength(0);
    } finally {
      bob.close();
    }
  });

  test('tombstone + original in the same fresh file resolves to removed (no resurrect)', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.graduateFact({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      graduated_at_epoch: 200,
    });
    exportSync({ repo: alice, snapshots: noSnapshots, project: 'p', dir, branches: [], now: 1 });
    alice.close();
    const hash = graduatedContentHash({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      title: null,
      body: null,
    });
    appendFileSync(graduatedFilePath(dir), serializeSyncRecord(gradTombstone(hash)) + '\n', 'utf8');

    const bob = freshRepo(tmp, 'bob');
    try {
      const result = importDir({ repo: bob, dir, now: 2 });
      expect(bob.listGraduated('p')).toHaveLength(0);
      const gradFile = result.files.find((f) => f.file.endsWith('graduated.jsonl'));
      expect(gradFile?.inserted).toBe(0); // insert skipped, not inserted-then-deleted
    } finally {
      bob.close();
    }
  });

  test('removing a tombstoned fact is idempotent across re-imports', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.graduateFact({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      graduated_at_epoch: 200,
    });
    exportSync({ repo: alice, snapshots: noSnapshots, project: 'p', dir, branches: [], now: 1 });
    alice.close();
    const hash = graduatedContentHash({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      title: null,
      body: null,
    });
    appendFileSync(graduatedFilePath(dir), serializeSyncRecord(gradTombstone(hash)) + '\n', 'utf8');

    const bob = freshRepo(tmp, 'bob');
    try {
      importDir({ repo: bob, dir, now: 2 });
      const again = importDir({ repo: bob, dir, now: 3, force: true });
      const gradFile = again.files.find((f) => f.file.endsWith('graduated.jsonl'));
      expect(gradFile?.tombstoned).toBe(0); // already gone
      expect(bob.listGraduated('p')).toHaveLength(0);
    } finally {
      bob.close();
    }
  });

  test('a pin tombstone removes a previously-imported pin on re-import', () => {
    const alice = freshRepo(tmp, 'alice');
    alice.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 5,
      note: 'temp decision',
      created_at_epoch: 10,
    });
    exportSync({
      repo: alice,
      snapshots: noSnapshots,
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
    });
    alice.close();

    const bob = freshRepo(tmp, 'bob');
    try {
      importDir({ repo: bob, dir, now: 2 });
      expect(bob.listPinsForBranch('p', 'main')).toHaveLength(1);

      const hash = pinContentHash({
        project: 'p',
        branch: 'main',
        observation_id: 5,
        note: 'temp decision',
        title: null,
        body: null,
      });
      const t: TombstoneRecord = {
        schema: 1,
        kind: 'tombstone',
        content_hash: hash,
        target_kind: 'pin',
        project: 'p',
        branch: 'main',
        observation_id: 5,
        author: 'alice',
        tombstoned_at_epoch: 999,
      };
      appendFileSync(branchFilePath(dir, 'main'), serializeSyncRecord(t) + '\n', 'utf8');

      const result = importDir({ repo: bob, dir, now: 3 });
      expect(result.tombstoned).toBe(1);
      expect(bob.listPinsForBranch('p', 'main')).toHaveLength(0);
    } finally {
      bob.close();
    }
  });
});

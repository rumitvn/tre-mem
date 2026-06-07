import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import { exportSync, type SnapshotProvider } from '../src/sync/export.js';
import { forgetGraduated, forgetPin } from '../src/sync/forget.js';
import { parseSyncLine } from '../src/sync/format.js';
import { graduatedFilePath, branchFilePath } from '../src/sync/layout.js';

const noSnapshots: SnapshotProvider = { getSnapshots: () => new Map() };

function freshRepo(tmp: string, name: string): TreMemRepo {
  const dbPath = join(tmp, `${name}.db`);
  migrate(dbPath);
  return new TreMemRepo({ dbPath });
}

function tombstoneLines(filePath: string): unknown[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => parseSyncLine(l))
    .filter((r) => r.kind === 'tombstone');
}

describe('forgetGraduated', () => {
  let tmp: string;
  let dir: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-forget-'));
    dir = join(tmp, '.tre-mem');
    repo = freshRepo(tmp, 'me');
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('a shared graduated fact is deleted locally AND tombstoned', () => {
    repo.graduateFact({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      graduated_at_epoch: 100,
    });
    exportSync({ repo, snapshots: noSnapshots, project: 'p', dir, branches: [], now: 1 });
    // After export the row carries a content_hash (shared).
    expect(repo.getGraduated('p', 7)?.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const result = forgetGraduated({ repo, dir, project: 'p', observation_id: 7, now: 2 });

    expect(result).toEqual({ removed: 1, tombstoned: true });
    expect(repo.getGraduated('p', 7)).toBeNull();
    const tombstones = tombstoneLines(graduatedFilePath(dir));
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({ target_kind: 'graduated', observation_id: 7 });
  });

  test('an unshared graduated fact is deleted locally with NO tombstone', () => {
    repo.graduateFact({
      project: 'p',
      observation_id: 9,
      graduated_from_branch: 'b',
      graduated_at_epoch: 100,
    });
    // never exported → no .tre-mem dir, no content_hash
    const result = forgetGraduated({ repo, dir, project: 'p', observation_id: 9, now: 2 });

    expect(result).toEqual({ removed: 1, tombstoned: false });
    expect(repo.getGraduated('p', 9)).toBeNull();
    expect(existsSync(graduatedFilePath(dir))).toBe(false);
  });

  test('forgetting a missing fact is a no-op', () => {
    const result = forgetGraduated({ repo, dir, project: 'p', observation_id: 404, now: 2 });
    expect(result).toEqual({ removed: 0, tombstoned: false });
  });

  test('forgetting twice does not write a duplicate tombstone', () => {
    repo.graduateFact({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      graduated_at_epoch: 100,
    });
    exportSync({ repo, snapshots: noSnapshots, project: 'p', dir, branches: [], now: 1 });
    forgetGraduated({ repo, dir, project: 'p', observation_id: 7, now: 2 });

    // Re-create + re-share the same fact, then forget again.
    repo.graduateFact({
      project: 'p',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      graduated_at_epoch: 100,
    });
    exportSync({ repo, snapshots: noSnapshots, project: 'p', dir, branches: [], now: 3 });
    const second = forgetGraduated({ repo, dir, project: 'p', observation_id: 7, now: 4 });

    expect(second.removed).toBe(1);
    expect(second.tombstoned).toBe(false); // identical tombstone already present
    expect(tombstoneLines(graduatedFilePath(dir))).toHaveLength(1);
  });
});

describe('forgetPin', () => {
  let tmp: string;
  let dir: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-forget-pin-'));
    dir = join(tmp, '.tre-mem');
    repo = freshRepo(tmp, 'me');
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('a shared pin is deleted locally AND tombstoned', () => {
    repo.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 5,
      note: 'temp',
      created_at_epoch: 10,
    });
    exportSync({ repo, snapshots: noSnapshots, project: 'p', dir, branches: ['main'], now: 1 });

    const result = forgetPin({
      repo,
      dir,
      project: 'p',
      branch: 'main',
      observation_id: 5,
      now: 2,
    });

    expect(result).toEqual({ removed: 1, tombstoned: true });
    expect(repo.listPinsForBranch('p', 'main')).toHaveLength(0);
    expect(tombstoneLines(branchFilePath(dir, 'main'))).toHaveLength(1);
  });

  test('an unshared pin is deleted locally with NO tombstone', () => {
    repo.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 6,
      note: 'temp',
      created_at_epoch: 10,
    });
    const result = forgetPin({
      repo,
      dir,
      project: 'p',
      branch: 'main',
      observation_id: 6,
      now: 2,
    });
    expect(result).toEqual({ removed: 1, tombstoned: false });
    expect(repo.listPinsForBranch('p', 'main')).toHaveLength(0);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

describe('TreMemRepo branch_tag', () => {
  let tmp: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-repo-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('upsertBranchTag inserts new rows and reports hasBranchTag', () => {
    expect(repo.hasBranchTag(42)).toBe(false);
    repo.upsertBranchTag({
      observation_id: 42,
      project: 'proj',
      branch: 'feature/x',
      tagged_at_epoch: 100,
      source: 'reflog-backfill',
    });
    expect(repo.hasBranchTag(42)).toBe(true);
    expect(repo.getBranchTag(42)).toMatchObject({
      project: 'proj',
      branch: 'feature/x',
      source: 'reflog-backfill',
      tagged_at_epoch: 100,
    });
  });

  it('upsertBranchTag overwrites on observation_id conflict', () => {
    repo.upsertBranchTag({
      observation_id: 1,
      project: 'p',
      branch: 'main',
      tagged_at_epoch: 100,
      source: 'reflog-backfill',
    });
    repo.upsertBranchTag({
      observation_id: 1,
      project: 'p',
      branch: 'main',
      tagged_at_epoch: 200,
      source: 'manual',
    });
    expect(repo.getBranchTag(1)).toMatchObject({
      source: 'manual',
      tagged_at_epoch: 200,
    });
  });

  it('countBranchTags scopes by project and optional branch', () => {
    repo.upsertBranchTag({
      observation_id: 1,
      project: 'p',
      branch: 'main',
      tagged_at_epoch: 1,
      source: 'live',
    });
    repo.upsertBranchTag({
      observation_id: 2,
      project: 'p',
      branch: 'feature/x',
      tagged_at_epoch: 1,
      source: 'live',
    });
    repo.upsertBranchTag({
      observation_id: 3,
      project: 'q',
      branch: 'main',
      tagged_at_epoch: 1,
      source: 'live',
    });

    expect(repo.countBranchTags('p')).toBe(2);
    expect(repo.countBranchTags('p', 'main')).toBe(1);
    expect(repo.countBranchTags('q')).toBe(1);
    expect(repo.countBranchTags('missing')).toBe(0);
  });

  it('listBranchesForProject returns branches ordered by count desc', () => {
    repo.upsertBranchTag({
      observation_id: 1,
      project: 'p',
      branch: 'main',
      tagged_at_epoch: 1,
      source: 'live',
    });
    repo.upsertBranchTag({
      observation_id: 2,
      project: 'p',
      branch: 'feature/x',
      tagged_at_epoch: 1,
      source: 'live',
    });
    repo.upsertBranchTag({
      observation_id: 3,
      project: 'p',
      branch: 'feature/x',
      tagged_at_epoch: 1,
      source: 'live',
    });

    expect(repo.listBranchesForProject('p')).toEqual([
      { branch: 'feature/x', count: 2 },
      { branch: 'main', count: 1 },
    ]);
  });
});

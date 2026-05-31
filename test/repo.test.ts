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

  it('listBranchTagsForBranch returns tags ordered by tagged_at_epoch DESC', () => {
    repo.upsertBranchTag({
      observation_id: 1,
      project: 'p',
      branch: 'main',
      tagged_at_epoch: 100,
      source: 'live',
    });
    repo.upsertBranchTag({
      observation_id: 2,
      project: 'p',
      branch: 'main',
      tagged_at_epoch: 300,
      source: 'live',
    });
    repo.upsertBranchTag({
      observation_id: 3,
      project: 'p',
      branch: 'main',
      tagged_at_epoch: 200,
      source: 'reflog-backfill',
    });
    repo.upsertBranchTag({
      observation_id: 4,
      project: 'p',
      branch: 'feature/x',
      tagged_at_epoch: 500,
      source: 'live',
    });

    const tags = repo.listBranchTagsForBranch('p', 'main');
    expect(tags.map((t) => t.observation_id)).toEqual([2, 3, 1]);

    const limited = repo.listBranchTagsForBranch('p', 'main', 2);
    expect(limited.map((t) => t.observation_id)).toEqual([2, 3]);
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

describe('TreMemRepo branch_pin', () => {
  let tmp: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-repo-pin-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('addPin assigns an id and round-trips all fields', () => {
    const pin = repo.addPin({
      project: 'p',
      branch: 'feature/x',
      observation_id: 17,
      note: 'remember the webhook bug',
      created_at_epoch: 1000,
    });
    expect(pin.id).toBeGreaterThan(0);
    expect(pin).toMatchObject({
      project: 'p',
      branch: 'feature/x',
      observation_id: 17,
      note: 'remember the webhook bug',
      created_at_epoch: 1000,
    });
    expect(repo.getPinById(pin.id)).toEqual(pin);
  });

  it('addPin supports free-text pins (no observation_id)', () => {
    const pin = repo.addPin({
      project: 'p',
      branch: 'main',
      note: 'manual note',
      created_at_epoch: 2000,
    });
    expect(pin.observation_id).toBeNull();
    expect(pin.note).toBe('manual note');
  });

  it('listPinsForBranch scopes by project + branch and orders newest first', () => {
    repo.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 1,
      created_at_epoch: 100,
    });
    repo.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 2,
      created_at_epoch: 300,
    });
    repo.addPin({
      project: 'p',
      branch: 'feature/x',
      observation_id: 3,
      created_at_epoch: 200,
    });
    repo.addPin({
      project: 'q',
      branch: 'main',
      observation_id: 4,
      created_at_epoch: 400,
    });

    const main = repo.listPinsForBranch('p', 'main');
    expect(main.map((p) => p.observation_id)).toEqual([2, 1]);

    const feature = repo.listPinsForBranch('p', 'feature/x');
    expect(feature.map((p) => p.observation_id)).toEqual([3]);

    expect(repo.listPinsForBranch('missing', 'main')).toEqual([]);
  });

  it('listPinsForProject returns pins across branches', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: 1, created_at_epoch: 100 });
    repo.addPin({ project: 'p', branch: 'feature/x', observation_id: 2, created_at_epoch: 200 });
    repo.addPin({ project: 'q', branch: 'main', observation_id: 3, created_at_epoch: 300 });

    const pins = repo.listPinsForProject('p');
    expect(pins.map((p) => p.observation_id)).toEqual([2, 1]);
  });
});

describe('TreMemRepo graduated', () => {
  let tmp: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-repo-grad-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('graduateFact inserts a new row and returns it', () => {
    const g = repo.graduateFact({
      project: 'p',
      observation_id: 42,
      graduated_from_branch: 'feature/payment',
      graduated_at_epoch: 1000,
    });
    expect(g.id).toBeGreaterThan(0);
    expect(g).toMatchObject({
      project: 'p',
      observation_id: 42,
      graduated_from_branch: 'feature/payment',
      graduated_at_epoch: 1000,
    });
    expect(repo.getGraduated('p', 42)).toEqual(g);
  });

  it('graduateFact upserts on (project, observation_id) conflict', () => {
    repo.graduateFact({
      project: 'p',
      observation_id: 1,
      graduated_from_branch: 'feature/a',
      graduated_at_epoch: 100,
    });
    repo.graduateFact({
      project: 'p',
      observation_id: 1,
      graduated_from_branch: 'feature/b',
      graduated_at_epoch: 200,
    });
    const g = repo.getGraduated('p', 1);
    expect(g).toMatchObject({
      graduated_from_branch: 'feature/b',
      graduated_at_epoch: 200,
    });
    expect(repo.listGraduated('p')).toHaveLength(1);
  });

  it('listGraduated scopes by project, newest first', () => {
    repo.graduateFact({
      project: 'p',
      observation_id: 1,
      graduated_from_branch: 'a',
      graduated_at_epoch: 100,
    });
    repo.graduateFact({
      project: 'p',
      observation_id: 2,
      graduated_from_branch: 'b',
      graduated_at_epoch: 300,
    });
    repo.graduateFact({
      project: 'q',
      observation_id: 3,
      graduated_from_branch: 'c',
      graduated_at_epoch: 400,
    });

    const out = repo.listGraduated('p');
    expect(out.map((g) => g.observation_id)).toEqual([2, 1]);
  });
});

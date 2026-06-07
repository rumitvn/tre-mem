import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { DB_BUSY_TIMEOUT_MS } from '../src/store/paths.js';
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

  it('opens with a busy_timeout so concurrent tre processes wait for the lock', () => {
    // Without this, the SessionStart hook, MCP server, and web daemon hitting the
    // sidecar DB at once fail instantly with SQLITE_BUSY — dropping the banner and
    // tripping the MCP "setup issue".
    expect(repo.busyTimeoutMs()).toBe(DB_BUSY_TIMEOUT_MS);
    expect(repo.busyTimeoutMs()).toBeGreaterThan(0);
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

describe('TreMemRepo removal (forget)', () => {
  let tmp: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-repo-del-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('deletePinById removes one pin and reports the change', () => {
    const pin = repo.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 1,
      created_at_epoch: 1,
    });
    expect(repo.deletePinById(pin.id)).toBe(true);
    expect(repo.getPinById(pin.id)).toBeNull();
    expect(repo.deletePinById(pin.id)).toBe(false);
  });

  it('deletePinsByObservation removes every matching pin', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: 7, created_at_epoch: 1 });
    repo.addPin({ project: 'p', branch: 'main', observation_id: 7, created_at_epoch: 2 });
    repo.addPin({ project: 'p', branch: 'other', observation_id: 7, created_at_epoch: 3 });
    expect(repo.deletePinsByObservation('p', 'main', 7)).toBe(2);
    expect(repo.listPinsForBranch('p', 'main')).toHaveLength(0);
    expect(repo.listPinsForBranch('p', 'other')).toHaveLength(1);
  });

  it('deletePinsByContentHash removes pins with that hash', () => {
    const pin = repo.addPin({
      project: 'p',
      branch: 'main',
      observation_id: 1,
      created_at_epoch: 1,
    });
    repo.markPinShared(pin.id, 'hash-abc', 100);
    expect(repo.deletePinsByContentHash('hash-abc')).toBe(1);
    expect(repo.getPinById(pin.id)).toBeNull();
  });

  it('deleteGraduatedByObservation removes the fact', () => {
    repo.graduateFact({
      project: 'p',
      observation_id: 9,
      graduated_from_branch: 'b',
      graduated_at_epoch: 1,
    });
    expect(repo.deleteGraduatedByObservation('p', 9)).toBe(true);
    expect(repo.getGraduated('p', 9)).toBeNull();
    expect(repo.deleteGraduatedByObservation('p', 9)).toBe(false);
  });

  it('deleteGraduatedByContentHash removes facts with that hash', () => {
    const g = repo.graduateFact({
      project: 'p',
      observation_id: 9,
      graduated_from_branch: 'b',
      graduated_at_epoch: 1,
    });
    repo.markGraduatedShared(g.id, 'hash-xyz', 100);
    expect(repo.deleteGraduatedByContentHash('hash-xyz')).toBe(1);
    expect(repo.getGraduated('p', 9)).toBeNull();
  });
});

describe('TreMemRepo cross-clone aliases', () => {
  let tmp: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-alias-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('upsertBranchState round-trips the remote column', () => {
    repo.upsertBranchState({
      cwd: '/a/app',
      project: 'app',
      current_branch: 'main',
      updated_at_epoch: 1,
      remote: 'github.com/org/app',
    });
    expect(repo.getBranchState('/a/app')?.remote).toBe('github.com/org/app');
  });

  it('defaults remote to null when omitted', () => {
    repo.upsertBranchState({
      cwd: '/a/app',
      project: 'app',
      current_branch: 'main',
      updated_at_epoch: 1,
    });
    expect(repo.getBranchState('/a/app')?.remote).toBeNull();
  });

  it('projectAliases returns [project] when remote is null/empty', () => {
    expect(repo.projectAliases('app', null)).toEqual(['app']);
    expect(repo.projectAliases('app', '')).toEqual(['app']);
    expect(repo.projectAliases('app', undefined)).toEqual(['app']);
  });

  it('projectAliases unions clones sharing a remote and isolates others', () => {
    const r = 'github.com/org/app';
    repo.upsertBranchState({
      cwd: '/a/app',
      project: 'app',
      current_branch: 'main',
      updated_at_epoch: 1,
      remote: r,
    });
    repo.upsertBranchState({
      cwd: '/a/app-2',
      project: 'app-2',
      current_branch: 'dev',
      updated_at_epoch: 1,
      remote: r,
    });
    repo.upsertBranchState({
      cwd: '/a/other',
      project: 'other',
      current_branch: 'main',
      updated_at_epoch: 1,
      remote: 'github.com/org/other',
    });

    expect(repo.projectAliases('app', r)).toEqual(['app', 'app-2']);
    expect(repo.projectAliases('other', 'github.com/org/other')).toEqual(['other']);
  });

  it('setRemoteForCwd updates an existing row and remoteForProject reads it back', () => {
    repo.upsertBranchState({
      cwd: '/a/app',
      project: 'app',
      current_branch: 'main',
      updated_at_epoch: 1,
    });
    expect(repo.remoteForProject('app')).toBeNull();
    repo.setRemoteForCwd('/a/app', 'github.com/org/app');
    expect(repo.getBranchState('/a/app')?.remote).toBe('github.com/org/app');
    expect(repo.remoteForProject('app')).toBe('github.com/org/app');
  });

  it('setRemoteForCwd is a no-op when the row does not exist', () => {
    expect(() => repo.setRemoteForCwd('/nope', 'github.com/org/app')).not.toThrow();
    expect(repo.getBranchState('/nope')).toBeNull();
  });

  it('projectAliases always includes the current project even if unregistered', () => {
    const r = 'github.com/org/app';
    repo.upsertBranchState({
      cwd: '/a/app-2',
      project: 'app-2',
      current_branch: 'dev',
      updated_at_epoch: 1,
      remote: r,
    });
    expect(repo.projectAliases('app', r)).toEqual(['app', 'app-2']);
  });

  it('*Across methods union pins, graduated and tags across projects', () => {
    repo.addPin({
      project: 'app',
      branch: 'feat',
      observation_id: 1,
      note: 'a',
      created_at_epoch: 10,
    });
    repo.addPin({
      project: 'app-2',
      branch: 'feat',
      observation_id: 2,
      note: 'b',
      created_at_epoch: 20,
    });
    repo.graduateFact({
      project: 'app',
      observation_id: 1,
      graduated_from_branch: 'feat',
      graduated_at_epoch: 10,
    });
    repo.graduateFact({
      project: 'app-2',
      observation_id: 2,
      graduated_from_branch: 'feat',
      graduated_at_epoch: 20,
    });
    repo.upsertBranchTag({
      observation_id: 1,
      project: 'app',
      branch: 'feat',
      tagged_at_epoch: 10,
      source: 'manual',
    });
    repo.upsertBranchTag({
      observation_id: 2,
      project: 'app-2',
      branch: 'feat',
      tagged_at_epoch: 20,
      source: 'manual',
    });

    const union = ['app', 'app-2'];
    expect(repo.listPinsForBranchAcross(union, 'feat').map((p) => p.observation_id)).toEqual([
      2, 1,
    ]);
    expect(repo.listGraduatedAcross(union).map((g) => g.observation_id)).toEqual([2, 1]);
    expect(repo.countBranchTagsAcross(union, 'feat')).toBe(2);
    expect(repo.listBranchesForProjectAcross(union)).toEqual([{ branch: 'feat', count: 2 }]);

    // single-element array == old single-project behavior (regression guard)
    expect(repo.listPinsForBranchAcross(['app'], 'feat').map((p) => p.observation_id)).toEqual([1]);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { crossCloneEnabled, resolveProjectIdentity } from '../src/store/aliases.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

describe('crossCloneEnabled', () => {
  it('defaults on', () => {
    expect(crossCloneEnabled({})).toBe(true);
    expect(crossCloneEnabled({ TRE_MEM_CROSS_CLONE: '1' })).toBe(true);
  });

  it('disables on falsey flags', () => {
    for (const v of ['0', 'false', 'off', 'no', 'OFF', 'False']) {
      expect(crossCloneEnabled({ TRE_MEM_CROSS_CLONE: v })).toBe(false);
    }
  });
});

describe('resolveProjectIdentity', () => {
  let tmp: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-ident-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const remote = 'github.com/org/app';

  it('unions clones sharing a remote', async () => {
    repo.upsertBranchState({
      cwd: '/x/app-2',
      project: 'app-2',
      current_branch: 'd',
      updated_at_epoch: 1,
      remote,
    });
    const id = await resolveProjectIdentity(repo, '/x/app', {
      resolveRemote: async () => remote,
    });
    expect(id.project).toBe('app');
    expect(id.remote).toBe(remote);
    expect(id.aliases).toEqual(['app', 'app-2']);
  });

  it('collapses to [project] when there is no remote', async () => {
    const id = await resolveProjectIdentity(repo, '/x/app', { resolveRemote: async () => null });
    expect(id.aliases).toEqual(['app']);
    expect(id.remote).toBeNull();
  });

  it('collapses to [project] when cross-clone disabled', async () => {
    repo.upsertBranchState({
      cwd: '/x/app-2',
      project: 'app-2',
      current_branch: 'd',
      updated_at_epoch: 1,
      remote,
    });
    const id = await resolveProjectIdentity(repo, '/x/app', {
      resolveRemote: async () => remote,
      crossClone: false,
    });
    expect(id.aliases).toEqual(['app']);
  });

  it('explicit project override bypasses the union', async () => {
    repo.upsertBranchState({
      cwd: '/x/app-2',
      project: 'app-2',
      current_branch: 'd',
      updated_at_epoch: 1,
      remote,
    });
    const id = await resolveProjectIdentity(repo, '/x/app', {
      project: 'custom',
      resolveRemote: async () => remote,
    });
    expect(id.project).toBe('custom');
    expect(id.aliases).toEqual(['custom']);
  });
});

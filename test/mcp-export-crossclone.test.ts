import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  exportMemory,
  getBranchContext,
  getShareStatus,
  graduateFact,
  type ToolDeps,
} from '../src/mcp/tools.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

const NOW = 10_000_000;

async function initRepo(cwd: string): Promise<void> {
  const git = simpleGit(cwd);
  await git.init(['--initial-branch', 'main']);
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.addConfig('user.name', 'Test User', false, 'local');
  writeFileSync(join(cwd, 'README'), 'seed\n');
  await git.add('README');
  await git.commit('seed');
}

describe('export_memory MCP tool', () => {
  let tmp: string;
  let repo: TreMemRepo;
  let deps: ToolDeps;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-export-'));
    await initRepo(tmp);
    migrate(join(tmp, 'tre-mem.db'));
    repo = new TreMemRepo({ dbPath: join(tmp, 'tre-mem.db') });
    deps = {
      adapter: null,
      repo,
      defaultCwd: tmp,
      resolveBranch: async () => 'main',
      now: () => NOW,
    };
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes .tre-mem/ files and commits locally without pushing', async () => {
    repo.addPin({
      project: 'proj',
      branch: 'main',
      observation_id: 1,
      note: 'a decision',
      created_at_epoch: NOW,
    });

    const res = await exportMemory(deps, { project: 'proj', branch: 'main' });

    expect(res.total_added).toBe(1);
    expect(res.files.length).toBeGreaterThan(0);
    expect(res.files.every((f) => existsSync(f))).toBe(true);
    expect(res.committed).toBe(true);
    expect(res.pushed).toBe(false);
    // No remote configured → hint is the upstream-creating push command.
    expect(res.commit_hint).toBe('git push -u origin main');

    // A commit actually landed and nothing was pushed (no remote exists).
    const log = await simpleGit(tmp).log();
    expect(log.latest?.message).toContain('export');
  });

  it('is fail-closed on secrets: returns categories, writes nothing', async () => {
    const secret = `sk-ant-${'a'.repeat(28)}`;
    repo.addPin({
      project: 'proj',
      branch: 'main',
      observation_id: 2,
      note: secret,
      created_at_epoch: NOW,
    });

    const res = await exportMemory(deps, { project: 'proj', branch: 'main' });

    expect(res.total_added).toBe(0);
    expect(res.files).toEqual([]);
    expect(res.committed).toBe(false);
    expect(res.redaction_blocked?.categories).toContain('anthropic-key');
    // The raw secret must never leak through the tool response.
    expect(JSON.stringify(res)).not.toContain(secret);
  });
});

describe('get_share_status MCP tool', () => {
  let tmp: string;
  let repo: TreMemRepo;
  let deps: ToolDeps;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-share-'));
    migrate(join(tmp, 'tre-mem.db'));
    repo = new TreMemRepo({ dbPath: join(tmp, 'tre-mem.db') });
    deps = {
      adapter: null,
      repo,
      defaultCwd: tmp,
      resolveBranch: async () => 'main',
      now: () => NOW,
    };
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reports pending vs shared pins and graduated counts', () => {
    repo.addPin({
      project: 'proj',
      branch: 'main',
      observation_id: 1,
      note: 'x',
      created_at_epoch: NOW,
    });
    repo.graduateFact({
      project: 'proj',
      observation_id: 9,
      graduated_from_branch: 'main',
      graduated_at_epoch: NOW,
    });

    const res = getShareStatus(deps, { project: 'proj' });
    expect(res).toMatchObject({
      project: 'proj',
      pending_export: 1,
      shared_pins: 0,
      total_pins: 1,
      graduated: 1,
    });
  });
});

describe('graduate_fact share hint', () => {
  it('includes a hint nudging export_memory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tre-mem-grad-'));
    migrate(join(tmp, 'tre-mem.db'));
    const repo = new TreMemRepo({ dbPath: join(tmp, 'tre-mem.db') });
    try {
      const deps: ToolDeps = {
        adapter: null,
        repo,
        defaultCwd: tmp,
        resolveBranch: async () => 'main',
        now: () => NOW,
      };
      const res = await graduateFact(deps, { observation_id: 5, project: 'proj', branch: 'main' });
      expect(res.hint).toContain('export_memory');
    } finally {
      repo.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('cross-clone memory via injected remote', () => {
  let tmp: string;
  let repo: TreMemRepo;
  const remote = 'github.com/org/app';

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-xc-'));
    migrate(join(tmp, 'tre-mem.db'));
    repo = new TreMemRepo({ dbPath: join(tmp, 'tre-mem.db') });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  function deps(cwd: string, crossRemote: string | null): ToolDeps {
    return {
      adapter: null,
      repo,
      defaultCwd: cwd,
      resolveBranch: async () => 'main',
      resolveRemote: async () => crossRemote,
      now: () => NOW,
    };
  }

  it('surfaces a pin made in clone A from clone B (same remote)', async () => {
    // Register both clones under the same remote.
    repo.upsertBranchState({
      cwd: '/clones/app',
      project: 'app',
      current_branch: 'main',
      updated_at_epoch: NOW,
      remote,
    });
    repo.upsertBranchState({
      cwd: '/clones/app-2',
      project: 'app-2',
      current_branch: 'main',
      updated_at_epoch: NOW,
      remote,
    });
    // Pin lives under clone A's project label.
    repo.addPin({
      project: 'app',
      branch: 'main',
      observation_id: null,
      note: 'shared decision X',
      created_at_epoch: NOW,
    });

    // Query from clone B.
    const res = await getBranchContext(deps('/clones/app-2', remote), {
      query: 'decision',
      branch: 'main',
    });
    expect(res.project).toBe('app-2');
    const titles = res.hits.map((h) => h.title ?? '');
    expect(titles.some((t) => t.includes('shared decision X'))).toBe(true);
  });

  it('isolates clones when cross-clone is disabled (no remote)', async () => {
    repo.upsertBranchState({
      cwd: '/clones/app',
      project: 'app',
      current_branch: 'main',
      updated_at_epoch: NOW,
      remote,
    });
    repo.addPin({
      project: 'app',
      branch: 'main',
      observation_id: null,
      note: 'shared decision X',
      created_at_epoch: NOW,
    });

    const res = await getBranchContext(deps('/clones/app-2', null), {
      query: 'decision',
      branch: 'main',
    });
    expect(res.hits.some((h) => (h.title ?? '').includes('shared decision X'))).toBe(false);
  });
});

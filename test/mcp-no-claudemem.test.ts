import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getBranchContext, getBranchTimeline, listBranches, pinFact } from '../src/mcp/tools.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

/**
 * T7D1: the MCP tools must work with `adapter: null` (claude-mem absent) —
 * pins + graduated surface from the sidecar, no crash.
 */
describe('MCP tools in shared-memory-only mode (adapter: null)', () => {
  let tmp: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mcp-shared-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
    repo.upsertBranchTag({
      observation_id: 50,
      project: 'demo',
      branch: 'feature/pay',
      tagged_at_epoch: 100,
      source: 'manual',
    });
    repo.addPin({
      project: 'demo',
      branch: 'feature/pay',
      observation_id: 50,
      note: 'use stripe webhook v3',
      created_at_epoch: 150,
    });
    repo.graduateFact({
      project: 'demo',
      observation_id: 51,
      graduated_from_branch: 'feature/pay',
      graduated_at_epoch: 160,
    });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const deps = (): { adapter: null; repo: TreMemRepo; now: () => number } => ({
    adapter: null,
    repo,
    now: () => 1000,
  });

  it('get_branch_context surfaces a shared pin without an adapter', async () => {
    const res = await getBranchContext(deps(), {
      query: 'stripe',
      project: 'demo',
      branch: 'feature/pay',
      k: 5,
    });
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    const top = res.hits[0];
    expect(top?.source).toBe('shared-pin');
    expect(top?.observation_id).toBe(50);
    expect(top?.title).toContain('stripe');
  });

  it('list_branches works without an adapter', async () => {
    const res = await listBranches(deps(), { project: 'demo' });
    expect(res.branches.map((b) => b.branch)).toContain('feature/pay');
  });

  it('get_branch_timeline returns [] without an adapter (no observations to hydrate)', async () => {
    const res = await getBranchTimeline(deps(), { branch: 'feature/pay', project: 'demo' });
    expect(res.entries).toEqual([]);
  });

  it('pin_fact still writes without an adapter', async () => {
    const res = await pinFact(deps(), {
      observation_id: 99,
      project: 'demo',
      branch: 'feature/pay',
      note: 'another decision',
    });
    expect(res.observation_id).toBe(99);
    expect(repo.listPinsForBranch('demo', 'feature/pay').length).toBe(2);
  });
});

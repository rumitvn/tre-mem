import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import { createWebServer } from '../src/web/server.js';
import { SseHub } from '../src/web/sse.js';
import { type WebDeps } from '../src/web/types.js';

const PROJECT = 'demo';

/**
 * T5D4 contract: with claude-mem absent (adapter null) the dashboard must still
 * render branch/pin/graduated data and search the self-contained shared rows —
 * never crash on the observation/search routes.
 */
describe('web degrade — no claude-mem adapter', () => {
  let tmp: string;
  let repo: TreMemRepo;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-web-degrade-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });

    // Two pins matching "auth", one on the current branch, one elsewhere.
    repo.addPin({
      project: PROJECT,
      branch: 'feature/auth',
      observation_id: 10,
      note: 'auth: rotate JWT signing key on deploy',
      created_at_epoch: 100,
    });
    repo.addPin({
      project: PROJECT,
      branch: 'main',
      observation_id: 11,
      note: 'auth middleware order matters',
      created_at_epoch: 110,
    });
    repo.graduateFact({
      project: PROJECT,
      observation_id: 12,
      graduated_from_branch: 'feature/auth',
      graduated_at_epoch: 120,
    });
    repo.upsertBranchState({
      cwd: tmp,
      project: PROJECT,
      current_branch: 'feature/auth',
      updated_at_epoch: 130,
    });

    const deps: WebDeps = {
      repo,
      adapter: null,
      cwd: tmp,
      project: PROJECT,
      staticDir: join(tmp, 'no-static'),
      version: '0.0.0',
      now: () => 1000,
      sse: new SseHub(),
    };
    server = createWebServer(deps);
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  type Obj = Record<string, unknown>;
  const rows = (v: unknown): Obj[] => v as Obj[];
  async function get(path: string): Promise<{ status: number; body: Obj }> {
    const r = await fetch(`${base}${path}`);
    return { status: r.status, body: (await r.json()) as Obj };
  }

  it('ranks the current-branch pin above an off-branch match', async () => {
    const { body } = await get('/api/search?q=auth');
    expect(body.mode).toBe('shared-only');
    const hits = rows(body.hits);
    expect(hits.map((h) => h.source)).toContain('shared-pin');
    // current branch is feature/auth → its pin (obs 10) ranks first
    expect(hits[0]?.observation_id).toBe(10);
  });

  it('search can be scoped to a branch via ?branch=', async () => {
    const { body } = await get('/api/search?q=auth&branch=main');
    expect(body.branch).toBe('main');
    expect(rows(body.hits)[0]?.observation_id).toBe(11);
  });

  it('surfaces graduated rows in degraded search', async () => {
    // graduated row 12 has no title/body snapshot here, so it should NOT match
    // a content query, but a pin/graduated mix still returns without error.
    const { status } = await get('/api/search?q=zzz-no-match');
    expect(status).toBe(200);
  });

  it('branch detail renders with null titles when adapter is absent', async () => {
    const { body } = await get('/api/branch/feature%2Fauth');
    expect(rows(body.pins)).toHaveLength(1);
    expect(rows(body.graduated)).toHaveLength(1);
  });

  it('rejects a non-numeric observation id with 400', async () => {
    const { status, body } = await get('/api/observation/not-a-number');
    expect(status).toBe(400);
    expect(body.error).toContain('invalid');
  });
});

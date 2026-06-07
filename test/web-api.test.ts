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

describe('web API (shared-memory-only, adapter absent)', () => {
  let tmp: string;
  let repo: TreMemRepo;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-web-api-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });

    repo.upsertBranchTag({
      observation_id: 1,
      project: PROJECT,
      branch: 'main',
      tagged_at_epoch: 100,
      source: 'manual',
    });
    repo.upsertBranchTag({
      observation_id: 2,
      project: PROJECT,
      branch: 'feature/pay',
      tagged_at_epoch: 200,
      source: 'live',
    });
    repo.addPin({
      project: PROJECT,
      branch: 'feature/pay',
      observation_id: 2,
      note: 'use stripe webhook v3',
      created_at_epoch: 250,
    });
    repo.graduateFact({
      project: PROJECT,
      observation_id: 1,
      graduated_from_branch: 'feature/pay',
      graduated_at_epoch: 300,
    });
    repo.upsertBranchState({
      cwd: tmp,
      project: PROJECT,
      current_branch: 'feature/pay',
      updated_at_epoch: 400,
    });

    const deps: WebDeps = {
      repo,
      adapter: null,
      cwd: tmp,
      project: PROJECT,
      remote: null,
      aliases: [PROJECT],
      staticDir: join(tmp, 'no-static'),
      version: '9.9.9',
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

  it('GET /api/health reports shared-only mode', async () => {
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: 'shared-only',
      project: PROJECT,
      version: '9.9.9',
    });
  });

  it('GET /api/projects includes the launched project', async () => {
    const { body } = await get('/api/projects');
    expect(body.current).toBe(PROJECT);
    expect(body.projects).toContain(PROJECT);
  });

  it('GET /api/branches lists branches with counts, pins, current branch', async () => {
    const { body } = await get('/api/branches');
    expect(body.current_branch).toBe('feature/pay');
    const pay = rows(body.branches).find((b) => b.branch === 'feature/pay');
    expect(pay).toMatchObject({ count: 1, pins: 1, last_active_epoch: 200 });
  });

  it('GET /api/branch/:branch returns timeline + pins + graduated', async () => {
    const { body } = await get('/api/branch/feature%2Fpay');
    expect(body.branch).toBe('feature/pay');
    expect(body.timeline).toHaveLength(1);
    expect(body.timeline[0]).toMatchObject({ observation_id: 2, source: 'live', title: null });
    expect(body.pins[0]).toMatchObject({ note: 'use stripe webhook v3', shared: false });
    expect(body.graduated[0]).toMatchObject({ observation_id: 1, from_branch: 'feature/pay' });
  });

  it('GET /api/pins and /api/graduated', async () => {
    expect(rows((await get('/api/pins')).body.pins)).toHaveLength(1);
    expect(rows((await get('/api/graduated')).body.graduated)).toHaveLength(1);
  });

  it('GET /api/share-status reports pending export', async () => {
    const { body } = await get('/api/share-status');
    expect(body).toMatchObject({
      pending_export: 1,
      shared_pins: 0,
      total_pins: 1,
      graduated: 1,
      has_sync_dir: false,
    });
  });

  it('GET /api/search degrades to substring match over shared rows', async () => {
    const { body } = await get('/api/search?q=stripe');
    expect(body.mode).toBe('shared-only');
    const hits = rows(body.hits);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({ source: 'shared-pin' });
    expect(hits[0]?.title).toContain('stripe');
  });

  it('GET /api/search with empty query returns no hits', async () => {
    expect(rows((await get('/api/search?q=')).body.hits)).toEqual([]);
  });

  it('GET /api/observation/:id returns null in shared-only mode (no crash)', async () => {
    const { status, body } = await get('/api/observation/2');
    expect(status).toBe(200);
    expect(body).toEqual({ observation: null, mode: 'shared-only' });
  });

  it('unknown /api route 404s with JSON', async () => {
    const { status, body } = await get('/api/nope');
    expect(status).toBe(404);
    expect(body.error).toContain('no route');
  });
});

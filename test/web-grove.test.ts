import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import {
  graduatedContentHash,
  pinContentHash,
  serializeSyncRecord,
  SYNC_SCHEMA_VERSION,
  type GraduatedRecord,
  type PinRecord,
} from '../src/sync/format.js';
import { branchFilePath, graduatedFilePath } from '../src/sync/layout.js';
import {
  aggregateContributors,
  buildGraph,
  GRADUATED_WEIGHT,
  PIN_WEIGHT,
  UNATTRIBUTED,
} from '../src/web/grove.js';
import { createWebServer } from '../src/web/server.js';
import { SseHub } from '../src/web/sse.js';
import { type WebDeps } from '../src/web/types.js';

const PROJECT = 'demo';
const DAY = 24 * 60 * 60;

function pin(over: Partial<PinRecord> = {}): PinRecord {
  const base = {
    project: PROJECT,
    branch: 'feature/x',
    observation_id: 1 as number | null,
    note: null as string | null,
    title: 'a decision' as string | null,
    body: 'body' as string | null,
    ...over,
  };
  return {
    schema: SYNC_SCHEMA_VERSION,
    kind: 'pin',
    content_hash: pinContentHash(base),
    author: 'alice',
    tagged_at_epoch: 100,
    ...base,
  } as PinRecord;
}

function grad(over: Partial<GraduatedRecord> = {}): GraduatedRecord {
  const base = {
    project: PROJECT,
    observation_id: 9,
    graduated_from_branch: 'feature/x',
    title: 'rooted' as string | null,
    body: 'body' as string | null,
    ...over,
  };
  return {
    schema: SYNC_SCHEMA_VERSION,
    kind: 'graduated',
    content_hash: graduatedContentHash(base),
    author: 'bob',
    graduated_at_epoch: 200,
    ...base,
  } as GraduatedRecord;
}

describe('aggregateContributors (pure)', () => {
  it('weights graduated facts 3x and ranks by value_score', () => {
    const now = 10 * DAY;
    const records = [
      pin({ author: 'alice', observation_id: 1, tagged_at_epoch: now }),
      pin({ author: 'alice', observation_id: 2, title: 'b', tagged_at_epoch: now }),
      grad({
        author: 'bob',
        observation_id: 3,
        tagged_at_epoch: undefined,
        graduated_at_epoch: now,
      }),
    ];
    const { contributors } = aggregateContributors(records, PROJECT, now);
    const alice = contributors.find((c) => c.author === 'alice')!;
    const bob = contributors.find((c) => c.author === 'bob')!;
    expect(alice.value_score).toBe(2 * PIN_WEIGHT);
    expect(bob.value_score).toBe(1 * GRADUATED_WEIGHT);
    // bob (3) outranks alice (2) despite fewer facts → graduated weight wins.
    expect(contributors[0]?.author).toBe('bob');
  });

  it('buckets null-author records under UNATTRIBUTED', () => {
    const { contributors, attributed_total, unattributed_total } = aggregateContributors(
      [pin({ author: null, observation_id: 5 })],
      PROJECT,
      1000,
    );
    expect(attributed_total).toBe(0);
    expect(unattributed_total).toBe(1);
    expect(contributors[0]?.author).toBe(UNATTRIBUTED);
    expect(contributors[0]?.attributed).toBe(false);
  });

  it('awards most_rooted to the top graduator and first_sprout to the earliest', () => {
    const now = 30 * DAY;
    const records = [
      pin({ author: 'alice', observation_id: 1, tagged_at_epoch: 5 * DAY }),
      grad({ author: 'bob', observation_id: 2, graduated_at_epoch: 20 * DAY }),
      grad({ author: 'bob', observation_id: 3, title: 'g2', graduated_at_epoch: 21 * DAY }),
    ];
    const { contributors } = aggregateContributors(records, PROJECT, now);
    const bob = contributors.find((c) => c.author === 'bob')!;
    const alice = contributors.find((c) => c.author === 'alice')!;
    expect(bob.badges).toContain('most_rooted');
    expect(alice.badges).toContain('first_sprout');
  });
});

describe('buildGraph (pure)', () => {
  it('emits root + branch + contributor + fact nodes with authored/lives_on/graduates_into edges', () => {
    const { nodes, edges } = buildGraph(
      [pin({ author: 'alice' }), grad({ author: 'bob' })],
      ['main'],
      PROJECT,
    );
    const kinds = new Set(nodes.map((n) => n.kind));
    expect(kinds).toEqual(new Set(['root', 'branch', 'contributor', 'fact']));
    expect(nodes.some((n) => n.id === 'branch:main')).toBe(true); // extra branch with no facts
    expect(edges.some((e) => e.kind === 'authored')).toBe(true);
    expect(edges.some((e) => e.kind === 'lives_on')).toBe(true);
    expect(edges.some((e) => e.kind === 'graduates_into')).toBe(true);
  });
});

describe('web API — grove endpoints', () => {
  let tmp: string;
  let repo: TreMemRepo;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-grove-'));
    const dir = join(tmp, '.tre-mem');
    mkdirSync(join(dir, 'branches'), { recursive: true });
    writeFileSync(
      branchFilePath(dir, 'feature/x'),
      `${serializeSyncRecord(pin({ author: 'alice', observation_id: 1 }))}\n`,
    );
    writeFileSync(graduatedFilePath(dir), `${serializeSyncRecord(grad({ author: 'bob' }))}\n`);

    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });

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
  async function get(path: string): Promise<{ status: number; body: Obj }> {
    const r = await fetch(`${base}${path}`);
    return { status: r.status, body: (await r.json()) as Obj };
  }

  it('GET /api/contributors aggregates shared JSONL authors', async () => {
    const { status, body } = await get('/api/contributors');
    expect(status).toBe(200);
    expect(body.source).toBe('shared');
    expect(body.attributed_total).toBe(2);
    const authors = (body.contributors as Obj[]).map((c) => c.author);
    expect(authors).toContain('alice');
    expect(authors).toContain('bob');
  });

  it('GET /api/graph returns nodes + edges from the shared layer', async () => {
    const { status, body } = await get('/api/graph');
    expect(status).toBe(200);
    expect(body.source).toBe('shared');
    expect((body.nodes as Obj[]).some((n) => n.kind === 'contributor')).toBe(true);
    expect((body.edges as Obj[]).length).toBeGreaterThan(0);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { parseSyncLine } from '../src/sync/format.js';
import { branchFilePath, graduatedFilePath } from '../src/sync/layout.js';
import { exportSync, type SnapshotProvider } from '../src/sync/export.js';
import { parseShareignore } from '../src/sync/shareignore.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

function fakeSnapshots(map: Record<number, { title: string | null; body: string | null }>): SnapshotProvider {
  return {
    getSnapshots(ids) {
      const out = new Map<number, { title: string | null; body: string | null }>();
      for (const id of ids) if (map[id]) out.set(id, map[id]);
      return out;
    },
  };
}

describe('exportSync', () => {
  let tmp: string;
  let dir: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-export-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
    dir = join(tmp, '.tre-mem');
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('writes a branch pin to branches/<slug>.jsonl with snapshot content', () => {
    repo.addPin({ project: 'p', branch: 'feature/payment', observation_id: 42, note: 'use webhook v3', created_at_epoch: 100 });
    const snapshots = fakeSnapshots({ 42: { title: 'Stripe decision', body: 'webhook v3' } });

    const result = exportSync({ repo, snapshots, project: 'p', dir, branches: ['feature/payment'], now: 500, author: 'alice' });

    const file = branchFilePath(dir, 'feature/payment');
    expect(file).toContain('feature-payment.jsonl');
    expect(result.branches[0]).toMatchObject({ branch: 'feature/payment', added: 1, total: 1 });

    const rows = readFileSync(file, 'utf8').trim().split('\n').map(parseSyncLine);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'pin',
      project: 'p',
      branch: 'feature/payment',
      observation_id: 42,
      note: 'use webhook v3',
      title: 'Stripe decision',
      body: 'webhook v3',
      author: 'alice',
      tagged_at_epoch: 100,
    });
  });

  test('marks exported pins shared in the sidecar DB', () => {
    const pin = repo.addPin({ project: 'p', branch: 'main', observation_id: 1, note: 'n', created_at_epoch: 10 });
    expect(repo.countUnsharedPins('p')).toBe(1);

    exportSync({ repo, snapshots: fakeSnapshots({ 1: { title: 't', body: 'b' } }), project: 'p', dir, branches: ['main'], now: 999 });

    expect(repo.countUnsharedPins('p')).toBe(0);
    const after = repo.getPinById(pin.id);
    expect(after?.shared_at_epoch).toBe(999);
    expect(after?.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is idempotent: re-export adds zero new lines', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: 1, note: 'n', created_at_epoch: 10 });
    const snapshots = fakeSnapshots({ 1: { title: 't', body: 'b' } });

    exportSync({ repo, snapshots, project: 'p', dir, branches: ['main'], now: 1 });
    const second = exportSync({ repo, snapshots, project: 'p', dir, branches: ['main'], now: 2 });

    expect(second.branches[0].added).toBe(0);
    expect(second.branches[0].total).toBe(1);
  });

  test('dry-run writes nothing and marks nothing', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: 1, note: 'n', created_at_epoch: 10 });
    const result = exportSync({
      repo,
      snapshots: fakeSnapshots({ 1: { title: 't', body: 'b' } }),
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.branches[0].added).toBe(1);
    expect(existsSync(branchFilePath(dir, 'main'))).toBe(false);
    expect(repo.countUnsharedPins('p')).toBe(1);
  });

  test('preserves existing unparseable lines (forward-compat append-only)', () => {
    const file = branchFilePath(dir, 'main');
    mkdirSync(join(dir, 'branches'), { recursive: true });
    writeFileSync(file, '{"schema":999,"kind":"future","content_hash":"zzz"}\n', 'utf8');

    repo.addPin({ project: 'p', branch: 'main', observation_id: 1, note: 'n', created_at_epoch: 10 });
    exportSync({ repo, snapshots: fakeSnapshots({ 1: { title: 't', body: 'b' } }), project: 'p', dir, branches: ['main'], now: 1 });

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"schema":999'); // preserved verbatim
    expect(parseSyncLine(lines[1])).toMatchObject({ kind: 'pin', observation_id: 1 });
  });

  test('exports graduated facts to graduated.jsonl', () => {
    repo.graduateFact({ project: 'p', observation_id: 7, graduated_from_branch: 'feature/x', graduated_at_epoch: 200 });
    const result = exportSync({
      repo,
      snapshots: fakeSnapshots({ 7: { title: 'graduated title', body: 'g body' } }),
      project: 'p',
      dir,
      branches: [],
      now: 1,
      author: 'bob',
    });

    expect(result.graduated.added).toBe(1);
    const rows = readFileSync(graduatedFilePath(dir), 'utf8').trim().split('\n').map(parseSyncLine);
    expect(rows[0]).toMatchObject({
      kind: 'graduated',
      observation_id: 7,
      graduated_from_branch: 'feature/x',
      title: 'graduated title',
      author: 'bob',
    });
  });

  test('free-text pin (null observation_id) exports with null title/body', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: null, note: 'free text decision', created_at_epoch: 5 });
    exportSync({ repo, snapshots: fakeSnapshots({}), project: 'p', dir, branches: ['main'], now: 1 });

    const rows = readFileSync(branchFilePath(dir, 'main'), 'utf8').trim().split('\n').map(parseSyncLine);
    expect(rows[0]).toMatchObject({ observation_id: null, note: 'free text decision', title: null, body: null });
  });
});

describe('exportSync — privacy guard (T3D4)', () => {
  let tmp: string;
  let dir: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-export-priv-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
    dir = join(tmp, '.tre-mem');
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('fail-closed: a secret aborts export and writes nothing', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: 1, note: 'token AKIAIOSFODNN7EXAMPLE', created_at_epoch: 10 });
    expect(() =>
      exportSync({ repo, snapshots: fakeSnapshots({ 1: { title: 't', body: 'b' } }), project: 'p', dir, branches: ['main'], now: 1 }),
    ).toThrow(/blocked/);
    expect(existsSync(branchFilePath(dir, 'main'))).toBe(false);
    expect(repo.countUnsharedPins('p')).toBe(1); // not marked shared
  });

  test('redact mode replaces the secret and exports', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: 1, note: 'token AKIAIOSFODNN7EXAMPLE', created_at_epoch: 10 });
    const result = exportSync({
      repo,
      snapshots: fakeSnapshots({ 1: { title: 't', body: 'b' } }),
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
      redact: true,
    });
    expect(result.redacted).toBe(1);
    const row = readFileSync(branchFilePath(dir, 'main'), 'utf8');
    expect(row).toContain('[REDACTED:aws-access-key]');
    expect(row).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  test('shareignore excludes matching records', () => {
    repo.addPin({ project: 'p', branch: 'main', observation_id: 1, note: 'internal-only secret plan', created_at_epoch: 10 });
    repo.addPin({ project: 'p', branch: 'main', observation_id: 2, note: 'public decision', created_at_epoch: 11 });
    const result = exportSync({
      repo,
      snapshots: fakeSnapshots({ 1: { title: null, body: null }, 2: { title: null, body: null } }),
      project: 'p',
      dir,
      branches: ['main'],
      now: 1,
      shareignore: parseShareignore('internal-only\n'),
    });
    expect(result.ignored).toBe(1);
    const rows = readFileSync(branchFilePath(dir, 'main'), 'utf8').trim().split('\n').map(parseSyncLine);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ observation_id: 2 });
  });
});

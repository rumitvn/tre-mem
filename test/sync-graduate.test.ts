import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import { exportSync } from '../src/sync/export.js';
import { graduateBranch } from '../src/sync/graduate.js';
import { graduatedFilePath } from '../src/sync/layout.js';
import { parseSyncLine } from '../src/sync/format.js';

describe('graduateBranch', () => {
  let tmp: string;
  let dir: string;
  let repo: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-grad-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
    dir = join(tmp, '.tre-mem');
  });

  afterEach(() => {
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  function seedBranchExport(branch: string): void {
    repo.addPin({
      project: 'p',
      branch,
      observation_id: 1,
      note: 'webhook v3',
      created_at_epoch: 100,
    });
    repo.addPin({
      project: 'p',
      branch,
      observation_id: 2,
      note: 'use idempotency keys',
      created_at_epoch: 101,
    });
    repo.addPin({
      project: 'p',
      branch,
      observation_id: null,
      note: 'free-text musing',
      created_at_epoch: 102,
    });
    exportSync({
      repo,
      snapshots: {
        getSnapshots: (ids) => new Map(ids.map((id) => [id, { title: `t${id}`, body: `b${id}` }])),
      },
      project: 'p',
      dir,
      branches: [branch],
      now: 1,
    });
  }

  test("promotes a merged branch's observation pins into graduated.jsonl", () => {
    seedBranchExport('feature/payment');
    const result = graduateBranch({ dir, branch: 'feature/payment', now: 500, author: 'ci' });

    expect(result.graduated).toBe(2);
    expect(result.skippedFreeText).toBe(1);

    const rows = readFileSync(graduatedFilePath(dir), 'utf8').trim().split('\n').map(parseSyncLine);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'graduated')).toBe(true);
    expect(
      rows
        .map((r) => (r.kind === 'graduated' ? r.graduated_from_branch : ''))
        .every((b) => b === 'feature/payment'),
    ).toBe(true);
  });

  test('is idempotent: re-graduating the same branch adds nothing', () => {
    seedBranchExport('main');
    graduateBranch({ dir, branch: 'main', now: 1 });
    const second = graduateBranch({ dir, branch: 'main', now: 2 });
    expect(second.graduated).toBe(0);
    expect(second.alreadyGraduated).toBe(2);
  });

  test('dry-run computes but writes nothing', () => {
    seedBranchExport('main');
    const result = graduateBranch({ dir, branch: 'main', now: 1, dryRun: true });
    expect(result.graduated).toBe(2);
    const grad = graduatedFilePath(dir);
    expect(() => readFileSync(grad, 'utf8')).toThrow();
  });

  test('unknown branch graduates nothing', () => {
    const result = graduateBranch({ dir, branch: 'does/not-exist', now: 1 });
    expect(result).toMatchObject({ graduated: 0, skippedFreeText: 0, alreadyGraduated: 0 });
  });
});

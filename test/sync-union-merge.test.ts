import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  SYNC_SCHEMA_VERSION,
  pinContentHash,
  serializeSyncRecord,
  type PinRecord,
} from '../src/sync/format.js';
import { importDir } from '../src/sync/import.js';
import { ensureGitattributes } from '../src/sync/layout.js';
import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

describe('.gitattributes merge=union (keep both)', () => {
  let repo: string;
  let jsonl: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'tre-union-'));
    git(repo, 'init');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    const dir = join(repo, '.tre-mem', 'branches');
    mkdirSync(dir, { recursive: true });
    ensureGitattributes(join(repo, '.tre-mem'));
    jsonl = join(dir, 'main.jsonl');
    writeFileSync(jsonl, 'line0\n', 'utf8');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('concurrent appends merge without conflict, keeping both sides', () => {
    const base = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();

    git(repo, 'checkout', '-b', 'alice');
    writeFileSync(jsonl, 'line0\nalice-line\n', 'utf8');
    git(repo, 'commit', '-am', 'alice');

    git(repo, 'checkout', base);
    git(repo, 'checkout', '-b', 'bob');
    writeFileSync(jsonl, 'line0\nbob-line\n', 'utf8');
    git(repo, 'commit', '-am', 'bob');

    // Merge alice into bob — without merge=union this conflicts and throws.
    git(repo, 'checkout', 'alice');
    expect(() => git(repo, 'merge', 'bob', '--no-edit')).not.toThrow();

    const merged = readFileSync(jsonl, 'utf8');
    expect(merged).toContain('alice-line');
    expect(merged).toContain('bob-line');
    expect(merged).not.toContain('<<<<<<<'); // no conflict markers
  });
});

describe('import de-dupes duplicate lines (union may leave dupes)', () => {
  let tmp: string;
  let store: TreMemRepo;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-union-import-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    store = new TreMemRepo({ dbPath });
  });
  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('two identical pin lines import as one', () => {
    const rec: PinRecord = {
      schema: SYNC_SCHEMA_VERSION,
      kind: 'pin',
      content_hash: pinContentHash({
        project: 'p',
        branch: 'main',
        observation_id: 1,
        note: 'n',
        title: 't',
        body: 'b',
      }),
      project: 'p',
      branch: 'main',
      observation_id: 1,
      note: 'n',
      title: 't',
      body: 'b',
      author: 'a',
      tagged_at_epoch: 1,
    };
    const line = serializeSyncRecord(rec);
    const dir = join(tmp, '.tre-mem');
    mkdirSync(join(dir, 'branches'), { recursive: true });
    writeFileSync(join(dir, 'branches', 'main.jsonl'), `${line}\n${line}\n`, 'utf8');

    const result = importDir({ repo: store, dir, now: 1, force: false });
    expect(result.pins).toBe(1);
    expect(result.files[0]?.duplicates).toBe(1);
  });
});

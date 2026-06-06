import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { mergedBranchFromSubject } from '../src/git/merge.js';
import { installPostMergeHook } from '../src/setup.js';

describe('mergedBranchFromSubject', () => {
  test.each([
    ["Merge branch 'feature/payment'", 'feature/payment'],
    ["Merge branch 'feature/payment' into develop", 'feature/payment'],
    ["Merge branch 'fix/auth' of github.com:o/r into main", 'fix/auth'],
    ['Merge pull request #42 from acme/feature/payment', 'feature/payment'],
    ['Merge pull request #7 from acme/hotfix', 'hotfix'],
    ["Merge remote-tracking branch 'origin/feature/x'", 'feature/x'],
    ["Merge remote-tracking branch 'origin/feature/x' into main", 'feature/x'],
  ])('parses %j → %j', (subject, expected) => {
    expect(mergedBranchFromSubject(subject)).toBe(expected);
  });

  test.each(['Fix a bug in the parser', 'chore: bump version', 'Initial commit', ''])(
    'returns null for non-merge subject %j',
    (subject) => {
      expect(mergedBranchFromSubject(subject)).toBeNull();
    },
  );
});

describe('installPostMergeHook', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'tre-hook-'));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('no-git when there is no .git directory', () => {
    expect(installPostMergeHook(repo).status).toBe('no-git');
  });

  test('creates an executable hook that calls tre graduate-merge', () => {
    execFileSync('git', ['init'], { cwd: repo });
    const result = installPostMergeHook(repo);
    expect(result.status).toBe('created');
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, 'utf8')).toContain('tre graduate-merge');
    expect(statSync(result.path).mode & 0o111).not.toBe(0); // executable bit set
  });

  test('re-running is idempotent (present)', () => {
    execFileSync('git', ['init'], { cwd: repo });
    installPostMergeHook(repo);
    expect(installPostMergeHook(repo).status).toBe('present');
  });

  test('refuses to clobber a foreign hook', () => {
    execFileSync('git', ['init'], { cwd: repo });
    const path = join(repo, '.git', 'hooks', 'post-merge');
    writeFileSync(path, '#!/bin/sh\necho hi\n', 'utf8');
    const result = installPostMergeHook(repo);
    expect(result.status).toBe('foreign');
    expect(readFileSync(path, 'utf8')).toBe('#!/bin/sh\necho hi\n'); // untouched
  });
});

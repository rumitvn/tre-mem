import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalizeRemoteUrl, remoteSlug } from '../src/git/remote.js';

describe('canonicalizeRemoteUrl', () => {
  const cases: Array<[string, string | null]> = [
    // ssh scp short form
    ['git@github.com:rumitvn/tre-mem.git', 'github.com/rumitvn/tre-mem'],
    ['git@github.com:rumitvn/tre-mem', 'github.com/rumitvn/tre-mem'],
    // ssh url form
    ['ssh://git@github.com/rumitvn/tre-mem.git', 'github.com/rumitvn/tre-mem'],
    ['ssh://git@github.com:22/rumitvn/tre-mem.git', 'github.com/rumitvn/tre-mem'],
    // https
    ['https://github.com/rumitvn/tre-mem.git', 'github.com/rumitvn/tre-mem'],
    ['https://github.com/rumitvn/tre-mem', 'github.com/rumitvn/tre-mem'],
    ['http://github.com/rumitvn/tre-mem.git', 'github.com/rumitvn/tre-mem'],
    // https with embedded credentials (must be stripped)
    ['https://user:token@github.com/rumitvn/tre-mem.git', 'github.com/rumitvn/tre-mem'],
    [
      'https://x-access-token:ghp_abc123@github.com/rumitvn/tre-mem.git',
      'github.com/rumitvn/tre-mem',
    ],
    // git protocol
    ['git://github.com/rumitvn/tre-mem.git', 'github.com/rumitvn/tre-mem'],
    // case: host lowercased, whole slug lowercased
    ['https://GitHub.com/RumitVN/Tre-Mem.git', 'github.com/rumitvn/tre-mem'],
    // trailing slash
    ['https://github.com/rumitvn/tre-mem/', 'github.com/rumitvn/tre-mem'],
    // self-hosted gitlab with nested groups
    ['git@gitlab.example.com:team/sub/app.git', 'gitlab.example.com/team/sub/app'],
    // garbage / empty
    ['', null],
    ['   ', null],
  ];

  for (const [input, expected] of cases) {
    it(`normalizes ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(canonicalizeRemoteUrl(input)).toBe(expected);
    });
  }
});

describe('remoteSlug', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-mem-remote-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null for a non-existent directory', async () => {
    expect(await remoteSlug(join(tmp, 'nope'))).toBeNull();
  });

  it('returns null for a repo without an origin remote', async () => {
    await initRepo(tmp);
    expect(await remoteSlug(tmp)).toBeNull();
  });

  it('returns the canonical slug of origin', async () => {
    await initRepo(tmp);
    await simpleGit(tmp).addRemote('origin', 'git@github.com:rumitvn/tre-mem.git');
    expect(await remoteSlug(tmp)).toBe('github.com/rumitvn/tre-mem');
  });
});

async function initRepo(cwd: string): Promise<void> {
  const git = simpleGit(cwd);
  await git.init(['--initial-branch', 'main']);
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.addConfig('user.name', 'Test User', false, 'local');
  writeFileSync(join(cwd, 'README'), 'seed\n');
  await git.add('README');
  await git.commit('seed');
}

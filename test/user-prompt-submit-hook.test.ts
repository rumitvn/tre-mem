import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SearchHit } from '../src/retrieval/search.js';
import { runUserPromptSubmitHook } from '../src/hooks/user-prompt-submit.js';

function hit(partial: { id: number; title: string; source: SearchHit['source'] }): SearchHit {
  return {
    total: 1,
    breakdown: { semantic: 0, branch: 0, recency: 0, graduated: 0, pin: 1 },
    source: partial.source,
    observation: {
      id: partial.id,
      memory_session_id: '',
      project: 'p',
      text: null,
      type: 'pin',
      title: partial.title,
      subtitle: null,
      facts: null,
      narrative: null,
      concepts: null,
      files_read: null,
      files_modified: null,
      prompt_number: null,
      created_at: '',
      created_at_epoch: 0,
    },
  };
}

describe('runUserPromptSubmitHook', () => {
  let tmp: string;
  let repoDir: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-ups-'));
    repoDir = join(tmp, 'repo');
    mkdirSync(repoDir, { recursive: true });
    const git = simpleGit(repoDir);
    await git.init(['--initial-branch', 'feature/payment']);
    await git.addConfig('user.email', 't@e.com');
    await git.addConfig('user.name', 't');
    writeFileSync(join(repoDir, 'README'), 'x');
    await git.add('README');
    await git.commit('seed');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('injects branch-scoped context from search hits', async () => {
    const result = await runUserPromptSubmitHook(
      { cwd: repoDir, prompt: 'how do we handle webhooks?' },
      {
        getHits: () => [
          hit({ id: 1, title: 'use Stripe webhook v3', source: 'shared-pin' }),
          hit({ id: 2, title: 'Stripe is canonical', source: 'graduated' }),
        ],
      },
    );

    expect(result.branch).toBe('feature/payment');
    expect(result.injected).toBe(2);
    expect(result.context).toContain('feature/payment');
    expect(result.context).toContain('[shared] use Stripe webhook v3');
    expect(result.context).toContain('[graduated] Stripe is canonical');
  });

  it('returns empty context for an empty prompt (stays silent)', async () => {
    const result = await runUserPromptSubmitHook(
      { cwd: repoDir, prompt: '   ' },
      { getHits: () => [hit({ id: 1, title: 'x', source: 'shared-pin' })] },
    );
    expect(result.injected).toBe(0);
    expect(result.context).toBe('');
  });

  it('returns empty context when there are no hits', async () => {
    const result = await runUserPromptSubmitHook(
      { cwd: repoDir, prompt: 'anything' },
      { getHits: () => [] },
    );
    expect(result.injected).toBe(0);
    expect(result.context).toBe('');
  });

  it('caps injected hits at k', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      hit({ id: i, title: `t${i}`, source: 'observation' }),
    );
    const result = await runUserPromptSubmitHook(
      { cwd: repoDir, prompt: 'q' },
      { getHits: () => many, k: 3 },
    );
    expect(result.injected).toBe(3);
  });
});

import { describe, expect, test } from 'vitest';

import { branchFromCiEnv } from '../src/git/github.js';

describe('branchFromCiEnv', () => {
  test('returns null outside any recognized CI', () => {
    expect(branchFromCiEnv({})).toBeNull();
  });

  test('reads the GitHub Actions PR head ref', () => {
    expect(branchFromCiEnv({ GITHUB_HEAD_REF: 'feature/pay' })).toBe('feature/pay');
  });

  test('reads the GitLab MR source branch', () => {
    expect(branchFromCiEnv({ CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'mr/widget' })).toBe('mr/widget');
  });

  test('reads the Bitbucket branch', () => {
    expect(branchFromCiEnv({ BITBUCKET_BRANCH: 'bb/topic' })).toBe('bb/topic');
  });

  test('prefers the PR head ref over the plain ref name', () => {
    expect(branchFromCiEnv({ GITHUB_HEAD_REF: 'pr-head', GITHUB_REF_NAME: 'main' })).toBe(
      'pr-head',
    );
  });

  test('ignores blank values', () => {
    expect(branchFromCiEnv({ GITHUB_HEAD_REF: '  ', CI_COMMIT_REF_NAME: 'dev' })).toBe('dev');
  });
});

import { describe, expect, test } from 'vitest';

import { RedactionError, redactText, scanForSecrets } from '../src/sync/redact.js';
import { parseShareignore } from '../src/sync/shareignore.js';

describe('scanForSecrets', () => {
  const cases: Array<{ rule: string; sample: string }> = [
    { rule: 'openai-key', sample: 'key is sk-proj-abcdefghijklmnopqrstuvwxyz123456' },
    { rule: 'anthropic-key', sample: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' },
    { rule: 'aws-access-key', sample: 'AKIAIOSFODNN7EXAMPLE here' },
    { rule: 'github-token', sample: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB' },
    { rule: 'google-api-key', sample: 'AIzaSyA1234567890abcdefghijklmnopqrstuvw' },
    { rule: 'slack-token', sample: 'xoxb-1234567890-abcdefg' },
    {
      rule: 'jwt',
      sample: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    },
    { rule: 'private-key', sample: '-----BEGIN RSA PRIVATE KEY-----' },
  ];

  for (const { rule, sample } of cases) {
    test(`detects ${rule}`, () => {
      const matches = scanForSecrets([{ field: 'note', value: sample }]);
      expect(matches.map((m) => m.rule)).toContain(rule);
    });
  }

  test('preview never leaks the raw secret', () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const [match] = scanForSecrets([{ field: 'body', value: secret }]);
    expect(match?.preview).not.toContain('mnopqrstuvwxyz');
    expect(match?.field).toBe('body');
  });

  test('clean text produces no matches (no false positives on prose)', () => {
    const prose = 'We decided to use the Stripe webhook v3 for idempotency on the payment branch.';
    expect(scanForSecrets([{ field: 'note', value: prose }])).toEqual([]);
  });

  test('null fields are skipped', () => {
    expect(scanForSecrets([{ field: 'note', value: null }])).toEqual([]);
  });

  test('finds multiple occurrences across fields', () => {
    const matches = scanForSecrets([
      { field: 'note', value: 'AKIAIOSFODNN7EXAMPLE' },
      { field: 'body', value: 'AKIAIOSFODNN7EXAMPLE again' },
    ]);
    expect(matches).toHaveLength(2);
  });
});

describe('redactText', () => {
  test('replaces a secret with a labeled placeholder', () => {
    const { redacted, count } = redactText('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB done');
    expect(count).toBe(1);
    expect(redacted).toBe('token=[REDACTED:github-token] done');
  });

  test('leaves clean text untouched', () => {
    const { redacted, count } = redactText('nothing to see here');
    expect(count).toBe(0);
    expect(redacted).toBe('nothing to see here');
  });

  test('labels an Anthropic key as anthropic-key, not openai-key', () => {
    const { redacted } = redactText('key sk-ant-api03-abcdefghijklmnopqrstuvwxyz here');
    expect(redacted).toContain('[REDACTED:anthropic-key]');
    expect(redacted).not.toContain('openai-key');
  });
});

describe('RedactionError', () => {
  test('carries the matches and a helpful message', () => {
    const err = new RedactionError([{ rule: 'openai-key', field: 'note', preview: 'sk-…12' }]);
    expect(err.matches).toHaveLength(1);
    expect(err.message).toMatch(/blocked/);
  });
});

describe('parseShareignore', () => {
  test('ignores records whose text matches a glob', () => {
    const m = parseShareignore('# secrets\n*password*\ninternal-only\n');
    expect(m.ignores('here is my password=hunter2')).toBe(true);
    expect(m.ignores('INTERNAL-ONLY note')).toBe(true); // case-insensitive
    expect(m.ignores('a normal pinned decision')).toBe(false);
  });

  test('blank content matches nothing', () => {
    const m = parseShareignore('\n# just a comment\n');
    expect(m.patterns).toHaveLength(0);
    expect(m.ignores('anything')).toBe(false);
  });
});

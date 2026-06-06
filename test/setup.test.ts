import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { setupClaudeCode, setupTool } from '../src/setup.js';

describe('setupClaudeCode', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-setup-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('writes the SessionStart hook into a fresh .claude/settings.json', () => {
    const result = setupClaudeCode(tmp);
    expect(result.hookAdded).toBe(true);

    const settings = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'));
    const cmds = settings.hooks.SessionStart.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((h) => h.command),
    );
    expect(cmds).toContain('tre hook session-start');
  });

  test('is idempotent: a second run does not duplicate the hook', () => {
    setupClaudeCode(tmp);
    const second = setupClaudeCode(tmp);
    expect(second.hookAdded).toBe(false);

    const settings = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  test('preserves existing unrelated settings and hooks', () => {
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    writeFileSync(
      join(tmp, '.claude', 'settings.json'),
      JSON.stringify({
        model: 'opus',
        hooks: {
          PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'prettier' }] }],
        },
      }),
      'utf8',
    );

    setupClaudeCode(tmp);
    const settings = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'));
    expect(settings.model).toBe('opus');
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  test('--auto-inject also wires the UserPromptSubmit hook', () => {
    const result = setupClaudeCode(tmp, { autoInject: true });
    expect(result.hookAdded).toBe(true);
    const settings = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'));
    const upsCmds = settings.hooks.UserPromptSubmit.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((h) => h.command),
    );
    expect(upsCmds).toContain('tre hook user-prompt-submit');
    // without auto-inject, UserPromptSubmit is absent
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });
});

describe('setupTool', () => {
  test('unknown tool reports supported tools', () => {
    const r = setupTool('emacs', '/tmp');
    expect(r.supported).toBe(false);
    expect(r.message).toMatch(/claude-code/);
  });
});

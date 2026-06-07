import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  dedupeSessionStartHooks,
  detectTools,
  scanSessionStartHooks,
  setupClaudeCode,
  setupTool,
} from '../src/setup.js';

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

describe('duplicate SessionStart hook detection', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-dup-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeSettings(
    name: string,
    command: string | null,
  ): { path: string; scope: 'project' | 'global' } {
    const path = join(tmp, name);
    const settings = command
      ? { hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command }] }] } }
      : { hooks: {} };
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8');
    return { path, scope: name.includes('global') ? 'global' : 'project' };
  }

  test('scan counts a tre-mem session-start hook per file', () => {
    const project = writeSettings('project.json', 'tre hook session-start');
    const global = writeSettings('global.json', '/abs/path/dist/cli.js hook session-start');
    const scans = scanSessionStartHooks(tmp, [project, global]);
    expect(scans.map((s) => s.count)).toEqual([1, 1]);
  });

  test('scan ignores unrelated hooks', () => {
    const project = writeSettings('project.json', 'some-other-tool run');
    const scans = scanSessionStartHooks(tmp, [project]);
    expect(scans[0]?.count).toBe(0);
  });

  test('dedupe defaults to keeping the project copy (canonical, committed)', () => {
    const project = writeSettings('project.json', 'tre hook session-start');
    const global = writeSettings('global.json', '/abs/dist/cli.js hook session-start');
    const result = dedupeSessionStartHooks(tmp, undefined, [project, global]);

    expect(result.kept).toBe(project.path);
    expect(result.removed).toEqual([{ path: global.path, count: 1 }]);
    // global leftover stripped; committed project hook untouched
    expect(scanSessionStartHooks(tmp, [project, global]).map((s) => s.count)).toEqual([1, 0]);
  });

  test('dedupe can keep the global copy when asked', () => {
    const project = writeSettings('project.json', 'tre hook session-start');
    const global = writeSettings('global.json', '/abs/dist/cli.js hook session-start');
    const result = dedupeSessionStartHooks(tmp, 'global', [project, global]);

    expect(result.kept).toBe(global.path);
    expect(result.removed).toEqual([{ path: project.path, count: 1 }]);
    expect(scanSessionStartHooks(tmp, [project, global]).map((s) => s.count)).toEqual([0, 1]);
  });

  test('detectTools marks claude-code wired from the session-start hook (no "tre-mem" literal)', () => {
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    writeFileSync(
      join(tmp, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { matcher: '*', hooks: [{ type: 'command', command: 'tre hook session-start' }] },
          ],
        },
      }),
      'utf8',
    );
    const claude = detectTools(tmp).find((t) => t.tool === 'claude-code');
    expect(claude?.wired).toBe(true);
  });

  test('dedupe is a no-op when only one registration exists', () => {
    const project = writeSettings('project.json', 'tre hook session-start');
    const global = writeSettings('global.json', null);
    const result = dedupeSessionStartHooks(tmp, 'global', [project, global]);
    expect(result.kept).toBe(project.path);
    expect(result.removed).toEqual([]);
  });
});

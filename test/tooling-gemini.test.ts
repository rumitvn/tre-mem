import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupTool } from '../src/setup.js';
import { geminiSettingsPath, registerGeminiMcp } from '../src/tooling/gemini.js';

describe('registerGeminiMcp', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tre-gemini-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('adds tre-mem to mcpServers in a fresh settings.json', () => {
    const r = registerGeminiMcp({ home });
    expect(r.changed).toBe(true);
    const json = JSON.parse(readFileSync(geminiSettingsPath(home), 'utf8'));
    expect(json.mcpServers['tre-mem']).toEqual({ command: 'tre', args: ['mcp'] });
  });

  it('is idempotent and preserves other servers + keys', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      geminiSettingsPath(home),
      JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x', args: [] } } }),
    );
    registerGeminiMcp({ home });
    const second = registerGeminiMcp({ home });
    expect(second.changed).toBe(false);
    expect(second.alreadyPresent).toBe(true);
    const json = JSON.parse(readFileSync(geminiSettingsPath(home), 'utf8'));
    expect(json.theme).toBe('dark');
    expect(json.mcpServers.other).toEqual({ command: 'x', args: [] });
    expect(json.mcpServers['tre-mem']).toBeDefined();
  });

  it('rejects invalid JSON rather than clobbering it', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(geminiSettingsPath(home), '{ not json');
    expect(() => registerGeminiMcp({ home })).toThrow(/invalid JSON/);
  });
});

describe('setupTool gemini dispatch', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tre-gemini-setup-'));
    process.env.GEMINI_HOME = home;
  });

  afterEach(() => {
    delete process.env.GEMINI_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('gemini is supported and registers MCP', () => {
    const r = setupTool('gemini', '/tmp');
    expect(r.supported).toBe(true);
    expect(r.settingsPath).toBe(geminiSettingsPath(home));
    const json = JSON.parse(readFileSync(geminiSettingsPath(home), 'utf8'));
    expect(json.mcpServers['tre-mem']).toBeDefined();
  });
});

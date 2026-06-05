import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectTools, setupAll, setupTool } from '../src/setup.js';
import { antigravityMcpPaths, registerAntigravityMcp } from '../src/tooling/antigravity.js';
import { cursorMcpPath, registerCursorMcp } from '../src/tooling/cursor.js';

describe('registerAntigravityMcp', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tre-ag-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('writes mcp_config.json for both IDE and CLI surfaces', () => {
    const r = registerAntigravityMcp({ home });
    expect(r.changed).toBe(true);
    for (const p of antigravityMcpPaths(home)) {
      const json = JSON.parse(readFileSync(p, 'utf8'));
      expect(json.mcpServers['tre-mem']).toEqual({ command: 'tre', args: ['mcp'] });
    }
  });
});

describe('registerCursorMcp', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tre-cursor-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('writes ~/.cursor/mcp.json mcpServers entry', () => {
    registerCursorMcp({ home });
    const json = JSON.parse(readFileSync(cursorMcpPath(home), 'utf8'));
    expect(json.mcpServers['tre-mem']).toBeDefined();
  });

  it('cursor is supported via setupTool', () => {
    const r = setupTool('cursor', '/tmp', {});
    expect(r.supported).toBe(true);
  });
});

describe('detectTools + setupAll', () => {
  let envHome: string;
  let cwd: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    envHome = mkdtempSync(join(tmpdir(), 'tre-detect-'));
    cwd = mkdtempSync(join(tmpdir(), 'tre-detect-cwd-'));
    for (const k of ['CODEX_HOME', 'GEMINI_HOME', 'CURSOR_HOME']) saved[k] = process.env[k];
    process.env.CODEX_HOME = join(envHome, '.codex');
    process.env.GEMINI_HOME = join(envHome, '.gemini');
    process.env.CURSOR_HOME = join(envHome, '.cursor');
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(envHome, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reports installed=false when no tool dirs exist', () => {
    const present = detectTools(cwd);
    const codex = present.find((t) => t.tool === 'codex');
    expect(codex?.installed).toBe(false);
    expect(codex?.wired).toBe(false);
  });

  it('detects an installed-but-unwired tool, then wired after setup', () => {
    mkdirSync(join(envHome, '.codex'), { recursive: true });
    let codex = detectTools(cwd).find((t) => t.tool === 'codex');
    expect(codex?.installed).toBe(true);
    expect(codex?.wired).toBe(false);

    setupTool('codex', cwd, {});
    codex = detectTools(cwd).find((t) => t.tool === 'codex');
    expect(codex?.wired).toBe(true);
  });

  it('setupAll wires claude-code (repo) + every installed tool', () => {
    mkdirSync(join(envHome, '.gemini'), { recursive: true });
    const results = setupAll(cwd, {});
    const tools = results.map((r) => r.tool);
    expect(tools).toContain('claude-code');
    expect(tools).toContain('gemini');
    // codex dir absent → not set up
    expect(tools).not.toContain('codex');
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(true);
  });
});

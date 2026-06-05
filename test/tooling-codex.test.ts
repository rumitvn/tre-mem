import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { codexConfigPath, registerCodexMcp } from '../src/tooling/codex.js';
import { setupTool } from '../src/setup.js';

describe('registerCodexMcp', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tre-codex-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('writes the mcp_servers.tre-mem section into a fresh config', () => {
    const r = registerCodexMcp({ home });
    expect(r.changed).toBe(true);
    expect(r.alreadyPresent).toBe(false);
    const toml = readFileSync(codexConfigPath(home), 'utf8');
    expect(toml).toContain('[mcp_servers.tre-mem]');
    expect(toml).toContain('command = "tre"');
    expect(toml).toContain('args = ["mcp"]');
  });

  it('is idempotent — a second run does not duplicate the section', () => {
    registerCodexMcp({ home });
    const second = registerCodexMcp({ home });
    expect(second.changed).toBe(false);
    expect(second.alreadyPresent).toBe(true);
    const toml = readFileSync(codexConfigPath(home), 'utf8');
    expect(toml.match(/\[mcp_servers\.tre-mem\]/g)).toHaveLength(1);
  });

  it('preserves existing config content (non-clobbering append)', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(codexConfigPath(home), 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n');
    registerCodexMcp({ home });
    const toml = readFileSync(codexConfigPath(home), 'utf8');
    expect(toml).toContain('model = "o3"');
    expect(toml).toContain('[mcp_servers.other]');
    expect(toml).toContain('[mcp_servers.tre-mem]');
  });

  it('honors a custom command', () => {
    registerCodexMcp({ home, command: 'node /opt/tre/cli.js' });
    const toml = readFileSync(codexConfigPath(home), 'utf8');
    expect(toml).toContain('command = "node /opt/tre/cli.js"');
  });
});

describe('setupTool codex dispatch', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tre-codex-setup-'));
    process.env.CODEX_HOME = home;
  });

  afterEach(() => {
    delete process.env.CODEX_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('codex is supported and registers MCP', () => {
    const r = setupTool('codex', '/tmp');
    expect(r.supported).toBe(true);
    expect(r.settingsPath).toBe(codexConfigPath(home));
    expect(readFileSync(codexConfigPath(home), 'utf8')).toContain('[mcp_servers.tre-mem]');
  });

  it('codex-desktop shares the same Codex config', () => {
    setupTool('codex', '/tmp');
    const r = setupTool('codex-desktop', '/tmp');
    expect(r.supported).toBe(true);
    // already registered by the codex run → no duplicate
    expect(readFileSync(codexConfigPath(home), 'utf8').match(/tre-mem/g)?.length).toBe(1);
  });
});

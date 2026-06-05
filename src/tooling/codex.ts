import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Codex CLI / Codex Desktop integration.
 *
 * Codex registers stdio MCP servers under `[mcp_servers.<name>]` in
 * `~/.codex/config.toml` (overridable via `CODEX_HOME`). Codex Desktop shares
 * the same config, so wiring the CLI wires the desktop app too.
 *
 * We do NOT parse the whole TOML (no dep): registration is an idempotent,
 * non-clobbering append — if the `[mcp_servers.tre-mem]` section already exists
 * we leave the file untouched.
 */
export const CODEX_MCP_SECTION = '[mcp_servers.tre-mem]';

export function codexHome(home?: string): string {
  if (home && home.trim() !== '') return home;
  const env = process.env.CODEX_HOME;
  return env && env.trim() !== '' ? env : join(homedir(), '.codex');
}

export function codexConfigPath(home?: string): string {
  return join(codexHome(home), 'config.toml');
}

export interface CodexRegisterOptions {
  /** Override the Codex home dir (tests). */
  home?: string;
  /** The command Codex should spawn for the MCP server (default: `tre`). */
  command?: string;
}

export interface CodexRegisterResult {
  path: string;
  changed: boolean;
  alreadyPresent: boolean;
}

function mcpBlock(command: string): string {
  return `${CODEX_MCP_SECTION}\ncommand = "${command}"\nargs = ["mcp"]\n`;
}

/** Idempotently add the tre-mem MCP server to Codex's config.toml. */
export function registerCodexMcp(opts: CodexRegisterOptions = {}): CodexRegisterResult {
  const path = codexConfigPath(opts.home);
  const command = opts.command ?? 'tre';
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';

  if (existing.includes(CODEX_MCP_SECTION)) {
    return { path, changed: false, alreadyPresent: true };
  }

  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  const lead = existing === '' ? '' : '\n';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${existing}${separator}${lead}${mcpBlock(command)}`, 'utf8');
  return { path, changed: true, alreadyPresent: false };
}

import { join } from 'node:path';

import { geminiHome } from './gemini.js';
import { registerJsonMcp, type JsonMcpResult } from './json-mcp.js';

/**
 * Google Antigravity integration — MCP only.
 *
 * Antigravity registers stdio MCP servers in a dedicated `mcp_config.json`
 * (`{mcpServers:{name:{command,args}}}`, no `type` field), under per-surface
 * dirs in `~/.gemini`. Its session lifecycle hooks are exposed through a
 * Python SDK, not a declarative config file, so tre-mem integrates as an
 * inject-only MCP memory server (a strong fit — Antigravity has no native
 * memory of its own).
 */
export function antigravityMcpPaths(home?: string): string[] {
  const base = geminiHome(home);
  return [
    join(base, 'antigravity', 'mcp_config.json'), // IDE
    join(base, 'antigravity-cli', 'mcp_config.json'), // CLI
  ];
}

export interface AntigravityRegisterOptions {
  home?: string;
  command?: string;
}

export interface AntigravityRegisterResult {
  results: JsonMcpResult[];
  changed: boolean;
}

/** Register tre-mem's MCP server for both Antigravity surfaces (IDE + CLI). */
export function registerAntigravityMcp(
  opts: AntigravityRegisterOptions = {},
): AntigravityRegisterResult {
  const results = antigravityMcpPaths(opts.home).map((path) =>
    registerJsonMcp(path, 'tre-mem', { command: opts.command ?? 'tre', args: ['mcp'] }),
  );
  return { results, changed: results.some((r) => r.changed) };
}

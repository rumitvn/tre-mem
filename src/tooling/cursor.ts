import { homedir } from 'node:os';
import { join } from 'node:path';

import { registerJsonMcp, type JsonMcpResult } from './json-mcp.js';

/**
 * Cursor integration — MCP. Cursor reads stdio MCP servers from the `mcpServers`
 * map in `~/.cursor/mcp.json` (project-scoped: `<repo>/.cursor/mcp.json`).
 */
export function cursorHome(home?: string): string {
  if (home && home.trim() !== '') return home;
  const env = process.env.CURSOR_HOME;
  return env && env.trim() !== '' ? env : join(homedir(), '.cursor');
}

export function cursorMcpPath(home?: string): string {
  return join(cursorHome(home), 'mcp.json');
}

export interface CursorRegisterOptions {
  home?: string;
  command?: string;
}

export function registerCursorMcp(opts: CursorRegisterOptions = {}): JsonMcpResult {
  return registerJsonMcp(cursorMcpPath(opts.home), 'tre-mem', {
    command: opts.command ?? 'tre',
    args: ['mcp'],
  });
}

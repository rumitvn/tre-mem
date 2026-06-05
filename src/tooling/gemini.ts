import { homedir } from 'node:os';
import { join } from 'node:path';

import { registerJsonMcp, type JsonMcpResult } from './json-mcp.js';

/**
 * Gemini CLI integration. Gemini reads stdio MCP servers from the `mcpServers`
 * map in `~/.gemini/settings.json` (home overridable via `GEMINI_HOME`).
 */
export function geminiHome(home?: string): string {
  if (home && home.trim() !== '') return home;
  const env = process.env.GEMINI_HOME;
  return env && env.trim() !== '' ? env : join(homedir(), '.gemini');
}

export function geminiSettingsPath(home?: string): string {
  return join(geminiHome(home), 'settings.json');
}

export interface GeminiRegisterOptions {
  home?: string;
  command?: string;
}

export function registerGeminiMcp(opts: GeminiRegisterOptions = {}): JsonMcpResult {
  return registerJsonMcp(geminiSettingsPath(opts.home), 'tre-mem', {
    command: opts.command ?? 'tre',
    args: ['mcp'],
  });
}

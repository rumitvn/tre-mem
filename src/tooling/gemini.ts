import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  readJsonObject,
  registerJsonMcp,
  writeJsonObject,
  type JsonMcpResult,
  type JsonObject,
} from './json-mcp.js';

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

interface GeminiHookEntry {
  hooks?: Array<{ type?: string; command?: string; name?: string }>;
  [key: string]: unknown;
}

export interface GeminiHooksOptions extends GeminiRegisterOptions {
  /** Also wire the BeforeModel inject hook (Gemini has no UserPromptSubmit event). */
  autoInject?: boolean;
}

export interface GeminiHooksResult {
  path: string;
  sessionStartAdded: boolean;
  beforeModelAdded: boolean;
}

function hasHookCommand(entries: GeminiHookEntry[], command: string): boolean {
  return entries.some((e) => e.hooks?.some((h) => h.command === command));
}

/**
 * Idempotently merge Gemini command hooks into settings.json. Gemini has no
 * `UserPromptSubmit`, so per-prompt injection maps to `BeforeModel`. Output
 * contract is `hookSpecificOutput.additionalContext` (no `hookEventName`).
 */
export function registerGeminiHooks(opts: GeminiHooksOptions = {}): GeminiHooksResult {
  const path = geminiSettingsPath(opts.home);
  const base = opts.command ?? 'tre';
  const sessionCmd = `${base} hook session-start --format=gemini`;
  const beforeCmd = `${base} hook user-prompt-submit --format=gemini`;

  const settings = readJsonObject(path) as {
    hooks?: Record<string, GeminiHookEntry[]>;
  } & JsonObject;
  const hooks: Record<string, GeminiHookEntry[]> = { ...(settings.hooks ?? {}) };

  let sessionStartAdded = false;
  let beforeModelAdded = false;

  const session = hooks.SessionStart ?? [];
  if (!hasHookCommand(session, sessionCmd)) {
    hooks.SessionStart = [
      ...session,
      { matcher: 'startup', hooks: [{ type: 'command', command: sessionCmd, name: 'tre-mem' }] },
    ];
    sessionStartAdded = true;
  }

  if (opts.autoInject) {
    const before = hooks.BeforeModel ?? [];
    if (!hasHookCommand(before, beforeCmd)) {
      hooks.BeforeModel = [
        ...before,
        { hooks: [{ type: 'command', command: beforeCmd, name: 'tre-mem' }] },
      ];
      beforeModelAdded = true;
    }
  }

  if (sessionStartAdded || beforeModelAdded) {
    writeJsonObject(path, { ...settings, hooks });
  }
  return { path, sessionStartAdded, beforeModelAdded };
}

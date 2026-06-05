import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Shared helper for tools that register MCP servers as a JSON `mcpServers` map
 * (Gemini CLI's settings.json, Antigravity's mcp_config.json, …). Idempotent
 * and non-clobbering: existing keys are preserved, and a server already present
 * is left untouched.
 */
export interface JsonMcpEntry {
  command: string;
  args: string[];
}

export interface JsonMcpResult {
  path: string;
  changed: boolean;
  alreadyPresent: boolean;
}

export type JsonObject = Record<string, unknown>;

/** Read a JSON object config, tolerating absent/empty files; throws on invalid JSON. */
export function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  if (raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`tre setup: ${path} contains invalid JSON — fix it before running setup`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`tre setup: ${path} is not a JSON object`);
  }
  return parsed as JsonObject;
}

export function writeJsonObject(path: string, obj: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

export function registerJsonMcp(path: string, name: string, entry: JsonMcpEntry): JsonMcpResult {
  const settings = readJsonObject(path) as { mcpServers?: Record<string, unknown> } & JsonObject;
  const servers = settings.mcpServers ?? {};
  if (Object.prototype.hasOwnProperty.call(servers, name)) {
    return { path, changed: false, alreadyPresent: true };
  }
  const next: JsonObject = {
    ...settings,
    mcpServers: { ...servers, [name]: { command: entry.command, args: entry.args } },
  };
  writeJsonObject(path, next);
  return { path, changed: true, alreadyPresent: false };
}

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

export interface CodexHooksOptions extends CodexRegisterOptions {
  /** Also wire the UserPromptSubmit inject hook (not just SessionStart). */
  autoInject?: boolean;
}

export interface CodexHooksResult {
  path: string;
  sessionStartAdded: boolean;
  userPromptAdded: boolean;
}

function sessionStartHookBlock(cmd: string): string {
  return (
    `[[hooks.SessionStart]]\nmatcher = "startup|resume"\n\n` +
    `[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "${cmd}"\n`
  );
}

function userPromptHookBlock(cmd: string): string {
  return `[[hooks.UserPromptSubmit]]\n\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = "${cmd}"\n`;
}

/**
 * Idempotently append Codex command hooks to config.toml. SessionStart auto-imports
 * teammate `.tre-mem/` + injects branch context; UserPromptSubmit (opt-in via
 * `autoInject`) injects branch-scoped memory per prompt. Codex's output contract
 * matches Claude Code's (`hookSpecificOutput.{hookEventName,additionalContext}`).
 */
export function registerCodexHooks(opts: CodexHooksOptions = {}): CodexHooksResult {
  const path = codexConfigPath(opts.home);
  const base = opts.command ?? 'tre';
  const sessionCmd = `${base} hook session-start --format=codex`;
  const promptCmd = `${base} hook user-prompt-submit --format=codex`;

  let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  let sessionStartAdded = false;
  let userPromptAdded = false;

  const append = (block: string): void => {
    const sep = content === '' || content.endsWith('\n') ? '' : '\n';
    const lead = content === '' ? '' : '\n';
    content = `${content}${sep}${lead}${block}`;
  };

  if (!content.includes(sessionCmd)) {
    append(sessionStartHookBlock(sessionCmd));
    sessionStartAdded = true;
  }
  if (opts.autoInject && !content.includes(promptCmd)) {
    append(userPromptHookBlock(promptCmd));
    userPromptAdded = true;
  }

  if (sessionStartAdded || userPromptAdded) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return { path, sessionStartAdded, userPromptAdded };
}

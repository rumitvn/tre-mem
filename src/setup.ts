import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { antigravityMcpPaths, registerAntigravityMcp } from './tooling/antigravity.js';
import {
  codexConfigPath,
  codexHome,
  registerCodexHooks,
  registerCodexMcp,
} from './tooling/codex.js';
import { cursorHome, cursorMcpPath, registerCursorMcp } from './tooling/cursor.js';
import {
  geminiHome,
  geminiSettingsPath,
  registerGeminiHooks,
  registerGeminiMcp,
} from './tooling/gemini.js';

const SESSION_START_COMMAND = 'tre hook session-start';
const USER_PROMPT_COMMAND = 'tre hook user-prompt-submit';

export type SetupTool =
  | 'claude-code'
  | 'codex'
  | 'codex-desktop'
  | 'gemini'
  | 'cursor'
  | 'antigravity';

export interface SetupOptions {
  /** Also wire the (conservative-by-default) UserPromptSubmit auto-inject hook. */
  autoInject?: boolean;
}

export interface SetupResult {
  tool: SetupTool;
  supported: boolean;
  settingsPath?: string;
  hookAdded: boolean;
  message: string;
}

interface ClaudeHookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

interface ClaudeSettings {
  hooks?: {
    SessionStart?: ClaudeHookEntry[];
    UserPromptSubmit?: ClaudeHookEntry[];
  } & Record<string, unknown>;
  [key: string]: unknown;
}

function readSettings(path: string): ClaudeSettings {
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
  return parsed as ClaudeSettings;
}

function hasCommand(entries: ClaudeHookEntry[], command: string): boolean {
  return entries.some((entry) => entry.hooks?.some((h) => h.command === command));
}

/** Idempotently add a command hook for `event` to a Claude Code settings object. */
function withHook(
  settings: ClaudeSettings,
  event: 'SessionStart' | 'UserPromptSubmit',
  command: string,
): { next: ClaudeSettings; added: boolean } {
  const existing = settings.hooks?.[event] ?? [];
  if (hasCommand(existing, command)) return { next: settings, added: false };
  const entry: ClaudeHookEntry = { matcher: '*', hooks: [{ type: 'command', command }] };
  const next: ClaudeSettings = {
    ...settings,
    hooks: { ...settings.hooks, [event]: [...existing, entry] },
  };
  return { next, added: true };
}

export function setupClaudeCode(cwd: string, opts: SetupOptions = {}): SetupResult {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  let settings = readSettings(settingsPath);

  const session = withHook(settings, 'SessionStart', SESSION_START_COMMAND);
  settings = session.next;
  const added = session.added;

  let autoInjectAdded = false;
  if (opts.autoInject) {
    const ups = withHook(settings, 'UserPromptSubmit', USER_PROMPT_COMMAND);
    settings = ups.next;
    autoInjectAdded = ups.added;
  }

  if (added || autoInjectAdded) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }

  const parts = [added ? 'added SessionStart hook' : 'SessionStart hook already present'];
  if (opts.autoInject) {
    parts.push(
      autoInjectAdded
        ? 'added UserPromptSubmit auto-inject hook'
        : 'auto-inject hook already present',
    );
  }
  return {
    tool: 'claude-code',
    supported: true,
    settingsPath,
    hookAdded: added,
    message: `tre-mem: ${parts.join('; ')}.`,
  };
}

const CONSUME_NOTE =
  '  This registers tre-mem (branch-aware team memory) over MCP. Full branch search\n' +
  '  needs claude-mem installed too (it ingests observations) — `tre doctor` shows the mode.';

/** MCP-only registration result (Cursor): no lifecycle hooks wired. */
function mcpOnlyResult(
  tool: SetupTool,
  surface: string,
  reg: { path: string; changed: boolean },
): SetupResult {
  const parts = [`tre setup ${tool}: ${surface}`];
  parts.push(reg.changed ? '  ✓ registered MCP server' : '  · MCP server already registered');
  parts.push(`  Restart ${surface} to load the changes.`, CONSUME_NOTE);
  return {
    tool,
    supported: true,
    settingsPath: reg.path,
    hookAdded: false,
    message: parts.join('\n'),
  };
}

function setupCodexTool(tool: 'codex' | 'codex-desktop', opts: SetupOptions): SetupResult {
  const surface = tool === 'codex-desktop' ? 'Codex Desktop' : 'Codex CLI';
  const mcp = registerCodexMcp();
  const hooks = registerCodexHooks({ autoInject: opts.autoInject ?? false });
  const parts = [`tre setup ${tool}: ${surface}`];
  parts.push(mcp.changed ? '  ✓ registered MCP server' : '  · MCP server already registered');
  parts.push(
    hooks.sessionStartAdded ? '  ✓ added SessionStart hook' : '  · SessionStart hook present',
  );
  if (opts.autoInject) {
    parts.push(
      hooks.userPromptAdded
        ? '  ✓ added UserPromptSubmit inject hook'
        : '  · UserPromptSubmit hook present',
    );
  }
  parts.push(`  Restart ${surface} to load the changes.`, CONSUME_NOTE);
  return {
    tool,
    supported: true,
    settingsPath: mcp.path,
    hookAdded: hooks.sessionStartAdded || hooks.userPromptAdded,
    message: parts.join('\n'),
  };
}

function setupGeminiTool(opts: SetupOptions): SetupResult {
  const mcp = registerGeminiMcp();
  const hooks = registerGeminiHooks({ autoInject: opts.autoInject ?? false });
  const parts = ['tre setup gemini: Gemini CLI'];
  parts.push(mcp.changed ? '  ✓ registered MCP server' : '  · MCP server already registered');
  parts.push(
    hooks.sessionStartAdded ? '  ✓ added SessionStart hook' : '  · SessionStart hook present',
  );
  if (opts.autoInject) {
    parts.push(
      hooks.beforeModelAdded ? '  ✓ added BeforeModel inject hook' : '  · BeforeModel hook present',
    );
  }
  parts.push('  Restart Gemini CLI to load the changes.', CONSUME_NOTE);
  return {
    tool: 'gemini',
    supported: true,
    settingsPath: mcp.path,
    hookAdded: hooks.sessionStartAdded || hooks.beforeModelAdded,
    message: parts.join('\n'),
  };
}

function setupAntigravityTool(): SetupResult {
  const reg = registerAntigravityMcp();
  const parts = ['tre setup antigravity: Antigravity (MCP only)'];
  parts.push(reg.changed ? '  ✓ registered MCP server' : '  · MCP server already registered');
  for (const r of reg.results) parts.push(`    ${r.path}`);
  parts.push(
    '  Antigravity has no native memory — tre-mem fills that gap over MCP.',
    '  (Lifecycle hooks there are Python-SDK only, so this is inject-only.)',
    CONSUME_NOTE,
  );
  return {
    tool: 'antigravity',
    supported: true,
    settingsPath: reg.results[0]?.path,
    hookAdded: false,
    message: parts.join('\n'),
  };
}

export function setupTool(tool: string, cwd: string, opts: SetupOptions = {}): SetupResult {
  if (tool === 'claude-code') return setupClaudeCode(cwd, opts);
  if (tool === 'codex' || tool === 'codex-desktop') return setupCodexTool(tool, opts);
  if (tool === 'gemini') return setupGeminiTool(opts);
  if (tool === 'antigravity') return setupAntigravityTool();
  if (tool === 'cursor') return mcpOnlyResult('cursor', 'Cursor', registerCursorMcp());
  return {
    tool: tool as SetupTool,
    supported: false,
    hookAdded: false,
    message: `tre setup: unknown tool "${tool}". Supported: claude-code, codex, codex-desktop, gemini, cursor, antigravity.`,
  };
}

export interface ToolPresence {
  tool: SetupTool;
  /** The tool's config dir/file exists on this machine. */
  installed: boolean;
  /** tre-mem is already wired into that tool's config. */
  wired: boolean;
  configPath: string;
}

function configHasTreMem(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, 'utf8').includes('tre-mem');
  } catch {
    return false;
  }
}

/**
 * Detect which harnesses are installed on this machine and whether tre-mem is
 * already wired into each. `cwd` is used for the repo-local Claude Code config.
 */
export function detectTools(cwd: string): ToolPresence[] {
  const claudePath = join(cwd, '.claude', 'settings.json');
  const codexPath = codexConfigPath();
  const geminiPath = geminiSettingsPath();
  const antigravityPath = antigravityMcpPaths()[0] as string;
  return [
    {
      tool: 'claude-code',
      installed: existsSync(join(cwd, '.claude')) || existsSync(claudePath),
      wired: configHasTreMem(claudePath),
      configPath: claudePath,
    },
    {
      tool: 'codex',
      installed: existsSync(codexHome()),
      wired: configHasTreMem(codexPath),
      configPath: codexPath,
    },
    {
      tool: 'gemini',
      installed: existsSync(geminiHome()),
      wired: configHasTreMem(geminiPath),
      configPath: geminiPath,
    },
    {
      tool: 'antigravity',
      installed: existsSync(join(geminiHome(), 'antigravity')) || existsSync(antigravityPath),
      wired: configHasTreMem(antigravityPath),
      configPath: antigravityPath,
    },
    {
      tool: 'cursor',
      installed: existsSync(cursorHome()),
      wired: configHasTreMem(cursorMcpPath()),
      configPath: cursorMcpPath(),
    },
  ];
}

const POST_MERGE_HOOK = `#!/bin/sh
# tre-mem: after a merge/pull, graduate the just-merged branch's pins to
# .tre-mem/graduated.jsonl. Provider-agnostic + CI-free. Never blocks git.
tre graduate-merge >/dev/null 2>&1 || true
`;

const POST_MERGE_MARKER = 'tre graduate-merge';

export interface HookInstallResult {
  path: string;
  status: 'created' | 'present' | 'foreign' | 'no-git';
}

/**
 * Install a `.git/hooks/post-merge` hook that graduates merged-branch pins
 * locally — the CI-free, any-provider alternative to the GitHub Action. Refuses
 * to clobber a pre-existing non-tre-mem hook.
 */
export function installPostMergeHook(cwd: string): HookInstallResult {
  const hooksDir = join(cwd, '.git', 'hooks');
  const path = join(hooksDir, 'post-merge');
  if (!existsSync(join(cwd, '.git'))) return { path, status: 'no-git' };

  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8');
    if (existing.includes(POST_MERGE_MARKER)) return { path, status: 'present' };
    return { path, status: 'foreign' };
  }

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(path, POST_MERGE_HOOK, 'utf8');
  chmodSync(path, 0o755);
  return { path, status: 'created' };
}

/** Set up every installed harness (claude-code is always included for the repo). */
export function setupAll(cwd: string, opts: SetupOptions = {}): SetupResult[] {
  const present = detectTools(cwd);
  const results: SetupResult[] = [setupTool('claude-code', cwd, opts)];
  for (const p of present) {
    if (p.tool === 'claude-code') continue;
    if (p.installed) results.push(setupTool(p.tool, cwd, opts));
  }
  return results;
}

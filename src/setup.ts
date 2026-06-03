import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SESSION_START_COMMAND = 'tre hook session-start';
const USER_PROMPT_COMMAND = 'tre hook user-prompt-submit';

export type SetupTool = 'claude-code' | 'cursor' | 'codex';

export interface SetupOptions {
  withAction?: boolean;
  /** Also wire the (conservative-by-default) UserPromptSubmit auto-inject hook. */
  autoInject?: boolean;
}

export interface SetupResult {
  tool: SetupTool;
  supported: boolean;
  settingsPath?: string;
  hookAdded: boolean;
  workflowPath?: string;
  workflowAdded: boolean;
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

const WORKFLOW_YML = `name: tre-mem graduate
on:
  pull_request:
    types: [closed]

permissions:
  contents: write

jobs:
  graduate:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.base.ref }}
      - uses: rumitvn/tre-mem/actions/graduate-on-merge@v0.2
`;

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

  let workflowPath: string | undefined;
  let workflowAdded = false;
  if (opts.withAction) {
    workflowPath = join(cwd, '.github', 'workflows', 'tre-mem-graduate.yml');
    if (!existsSync(workflowPath)) {
      mkdirSync(dirname(workflowPath), { recursive: true });
      writeFileSync(workflowPath, WORKFLOW_YML, 'utf8');
      workflowAdded = true;
    }
  }

  const parts = [added ? 'added SessionStart hook' : 'SessionStart hook already present'];
  if (opts.autoInject) {
    parts.push(
      autoInjectAdded
        ? 'added UserPromptSubmit auto-inject hook'
        : 'auto-inject hook already present',
    );
  }
  if (opts.withAction) {
    parts.push(workflowAdded ? 'wrote graduate workflow' : 'graduate workflow already present');
  }
  return {
    tool: 'claude-code',
    supported: true,
    settingsPath,
    hookAdded: added,
    workflowPath,
    workflowAdded,
    message: `tre-mem: ${parts.join('; ')}.`,
  };
}

export function setupTool(tool: string, cwd: string, opts: SetupOptions = {}): SetupResult {
  if (tool === 'claude-code') return setupClaudeCode(cwd, opts);
  if (tool === 'cursor' || tool === 'codex') {
    return {
      tool,
      supported: false,
      hookAdded: false,
      workflowAdded: false,
      message: `tre setup: ${tool} support is coming in V3. Today only "claude-code" is wired.`,
    };
  }
  return {
    tool: tool as SetupTool,
    supported: false,
    hookAdded: false,
    workflowAdded: false,
    message: `tre setup: unknown tool "${tool}". Supported: claude-code (cursor/codex coming in V3).`,
  };
}

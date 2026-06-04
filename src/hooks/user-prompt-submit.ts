import { basename } from 'node:path';

import { currentBranch } from '../git/resolver.js';
import { log } from '../log/logger.js';
import type { SearchHit } from '../retrieval/search.js';

export interface UserPromptSubmitInput {
  hook_event_name?: string;
  cwd?: string;
  prompt?: string;
}

export interface UserPromptSubmitDeps {
  /** Branch-aware retrieval, injected so the handler stays testable. */
  getHits: (args: { query: string; project: string; branch: string }) => SearchHit[];
  k?: number;
}

export interface UserPromptSubmitResult {
  project: string;
  branch: string;
  injected: number;
  context: string;
}

const DEFAULT_K = 5;

function hitLine(hit: SearchHit): string {
  const tag =
    hit.source === 'shared-pin' ? '[shared] ' : hit.source === 'graduated' ? '[graduated] ' : '';
  const obs = hit.observation;
  const title = obs.title ?? obs.subtitle ?? (obs.text ?? '').slice(0, 80) ?? '(untitled)';
  return `- ${tag}${title}`;
}

/**
 * Build branch-scoped memory context to inject into a user prompt. Opt-in via
 * `tre setup claude-code --auto-inject`. Returns empty context for empty prompts
 * or no matches so the hook stays silent when it has nothing useful to add.
 */
export async function runUserPromptSubmitHook(
  input: UserPromptSubmitInput,
  deps: UserPromptSubmitDeps,
): Promise<UserPromptSubmitResult> {
  const cwd = input.cwd ?? process.cwd();
  const project = basename(cwd);
  const prompt = (input.prompt ?? '').trim();
  const branch = await currentBranch(cwd);
  const startedMs = Date.now();

  if (prompt === '') return { project, branch, injected: 0, context: '' };

  const hits = deps.getHits({ query: prompt, project, branch }).slice(0, deps.k ?? DEFAULT_K);
  if (hits.length === 0) return { project, branch, injected: 0, context: '' };

  const context =
    `tre-mem — memory relevant to branch "${branch}":\n` + hits.map(hitLine).join('\n');
  // Stay silent on empty/no-match prompts to avoid per-keystroke spam; only log a hit.
  log({
    level: 'info',
    component: 'hook',
    event: 'prompt_inject',
    fields: { project, branch, injected: hits.length, ms: Date.now() - startedMs },
  });
  return { project, branch, injected: hits.length, context };
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

export interface BranchTransition {
  /** Unix epoch (seconds) when HEAD moved to `to_branch`. */
  at_epoch: number;
  /** Branch HEAD moved away from, if parseable. */
  from_branch: string | null;
  /** Branch HEAD moved to. */
  to_branch: string;
}

const CHECKOUT_RE = /^checkout: moving from (.+) to (.+)$/;
const SELECTOR_EPOCH_RE = /@\{(\d+)\}/;

export async function readHeadReflog(cwd: string): Promise<BranchTransition[]> {
  if (!existsSync(cwd) || !existsSync(join(cwd, '.git'))) return [];

  const git = simpleGit(cwd);
  let raw: string;
  try {
    raw = await git.raw(['reflog', 'show', 'HEAD', '--date=unix', '--pretty=format:%gd|%gs']);
  } catch {
    return [];
  }

  return parseHeadReflog(raw);
}

export function parseHeadReflog(raw: string): BranchTransition[] {
  const out: BranchTransition[] = [];
  // git reflog emits newest-first. Iterate oldest-first so same-epoch ties land
  // in chronological order (Array.sort is stable in modern V8).
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = (lines[i] ?? '').trim();
    if (!trimmed) continue;
    const pipe = trimmed.indexOf('|');
    if (pipe === -1) continue;
    const selector = trimmed.slice(0, pipe);
    const subject = trimmed.slice(pipe + 1);

    const checkout = CHECKOUT_RE.exec(subject);
    if (!checkout) continue;

    const epochMatch = SELECTOR_EPOCH_RE.exec(selector);
    if (!epochMatch) continue;

    out.push({
      at_epoch: Number.parseInt(epochMatch[1] as string, 10),
      from_branch: (checkout[1] as string) || null,
      to_branch: checkout[2] as string,
    });
  }
  out.sort((a, b) => a.at_epoch - b.at_epoch);
  return out;
}

/**
 * Returns the branch HEAD was on at `epoch` based on transitions.
 *
 * Strategy:
 *   - Walk sorted transitions; track the most recent transition with
 *     `at_epoch <= epoch`. Its `to_branch` is the answer.
 *   - If `epoch` precedes every transition, fall back to the `from_branch`
 *     of the earliest transition (the implied initial branch).
 *   - If transitions list is empty or no fallback available, return null.
 */
export function resolveBranchAt(transitions: BranchTransition[], epoch: number): string | null {
  let candidate: string | null = null;
  for (const t of transitions) {
    if (t.at_epoch > epoch) break;
    candidate = t.to_branch;
  }
  if (candidate !== null) return candidate;
  if (transitions.length > 0) return transitions[0]?.from_branch ?? null;
  return null;
}

import { basename } from 'node:path';

import { remoteSlug } from '../git/remote.js';
import type { TreMemRepo } from './repo.js';

/**
 * Resolved project identity for a working directory.
 *
 * - `project` is the WRITE key — `basename(cwd)` — unchanged from v0.x. New pins,
 *   graduations and branch tags are always stored under this label.
 * - `aliases` is the READ key set — every project label that shares this repo's
 *   git remote (always includes `project`). Reads union over these so memory
 *   crosses multiple local clones of the same repo.
 */
export interface ProjectIdentity {
  project: string;
  remote: string | null;
  aliases: string[];
}

export interface ResolveIdentityOptions {
  /** Explicit project override (`--project`). Bypasses cross-clone union. */
  project?: string;
  /** Injectable remote resolver for tests (defaults to reading git origin). */
  resolveRemote?: (cwd: string) => Promise<string | null>;
  /** Force cross-clone on/off, overriding the env default. */
  crossClone?: boolean;
}

/**
 * Whether cross-clone memory unioning is enabled. Default ON; disabled by setting
 * `TRE_MEM_CROSS_CLONE` to `0`/`false`/`off`/`no` (mirrors the other boolean envs).
 */
export function crossCloneEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.TRE_MEM_CROSS_CLONE ?? '').trim().toLowerCase();
  return !(flag === '0' || flag === 'false' || flag === 'off' || flag === 'no');
}

/**
 * Resolve the project identity for `cwd`. Best-effort and never throws: when there
 * is no git remote, cross-clone is disabled, or an explicit `project` override is
 * given, `aliases` collapses to `[project]` (exactly the pre-v0.10 behavior).
 */
export async function resolveProjectIdentity(
  repo: Pick<TreMemRepo, 'projectAliases' | 'setRemoteForCwd'>,
  cwd: string,
  opts: ResolveIdentityOptions = {},
): Promise<ProjectIdentity> {
  // An explicit project override is a deliberate single-project scope.
  if (opts.project !== undefined) {
    return { project: opts.project, remote: null, aliases: [opts.project] };
  }

  const project = basename(cwd);
  const enabled = opts.crossClone ?? crossCloneEnabled();
  if (!enabled) return { project, remote: null, aliases: [project] };

  const resolve = opts.resolveRemote ?? remoteSlug;
  let remote: string | null = null;
  try {
    remote = await resolve(cwd);
  } catch {
    remote = null;
  }
  // Eagerly register this clone's remote so any tre invocation (status, MCP, web)
  // — not just session-start — lets siblings discover it. No-op until the row
  // exists; cheap idempotent UPDATE otherwise.
  if (remote !== null) {
    try {
      repo.setRemoteForCwd(cwd, remote);
    } catch {
      /* registration is best-effort, never block resolution */
    }
  }
  const aliases = repo.projectAliases(project, remote);
  return { project, remote, aliases };
}

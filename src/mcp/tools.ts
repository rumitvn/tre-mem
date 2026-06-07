import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import type { Observation } from '../adapter/types.js';
import { gitAuthor } from '../git/identity.js';
import { currentBranch, isDetached, NO_GIT } from '../git/resolver.js';
import type { RerankBreakdown } from '../retrieval/rerank.js';
import { searchBranchContext } from '../retrieval/search.js';
import { resolveProjectIdentity } from '../store/aliases.js';
import type { TreMemRepo } from '../store/repo.js';
import { exportSync, type SnapshotProvider } from '../sync/export.js';
import { forgetGraduated, forgetPin } from '../sync/forget.js';
import { SYNC_DIR_NAME, ensureSyncScaffold } from '../sync/layout.js';
import { RedactionError } from '../sync/redact.js';
import { shareToGit, simpleGitShare } from '../sync/share.js';
import { loadShareignore } from '../sync/shareignore.js';
import { AdapterSnapshotProvider } from '../sync/snapshot.js';

export interface ToolDeps {
  /** Null in shared-memory-only mode (claude-mem absent): full-text/observation
   *  signals are skipped; pins + graduated still surface from the sidecar. */
  adapter: ClaudeMemAdapter | null;
  repo: TreMemRepo;
  defaultCwd?: string;
  resolveBranch?: (cwd: string) => Promise<string>;
  /** Injectable git-remote resolver for cross-clone identity (tests override). */
  resolveRemote?: (cwd: string) => Promise<string | null>;
  now?: () => number;
}

export interface GetBranchContextInput {
  query: string;
  project?: string;
  branch?: string;
  cwd?: string;
  k?: number;
}

export interface GetBranchContextResult {
  project: string;
  branch: string;
  query: string;
  k: number;
  hits: Array<{
    observation_id: number;
    title: string | null;
    subtitle: string | null;
    text: string | null;
    type: string;
    created_at: string;
    created_at_epoch: number;
    total: number;
    breakdown: RerankBreakdown;
  }>;
}

export interface GetBranchTimelineInput {
  branch: string;
  project?: string;
  cwd?: string;
  limit?: number;
  sinceEpoch?: number;
  untilEpoch?: number;
}

export interface GetBranchTimelineResult {
  project: string;
  branch: string;
  limit: number;
  entries: Array<{
    observation_id: number;
    title: string | null;
    subtitle: string | null;
    type: string;
    created_at: string;
    created_at_epoch: number;
    tagged_at_epoch: number;
    source: string;
  }>;
}

export interface ListBranchesInput {
  project?: string;
  cwd?: string;
}

export interface ListBranchesResult {
  project: string;
  branches: Array<{ branch: string; count: number }>;
}

export interface PinFactInput {
  observation_id: number;
  branch?: string;
  project?: string;
  cwd?: string;
  note?: string;
}

export interface PinFactResult {
  pin_id: number;
  project: string;
  branch: string;
  observation_id: number;
  note: string | null;
  created_at_epoch: number;
}

export interface GraduateFactInput {
  observation_id: number;
  branch?: string;
  project?: string;
  cwd?: string;
}

export interface GraduateFactResult {
  graduated_id: number;
  project: string;
  observation_id: number;
  graduated_from_branch: string;
  graduated_at_epoch: number;
  /** Workflow nudge: graduating only writes the sidecar; export to publish. */
  hint: string;
}

export interface UnpinFactInput {
  observation_id: number;
  branch?: string;
  project?: string;
  cwd?: string;
}

export interface UnpinFactResult {
  project: string;
  branch: string;
  observation_id: number;
  removed_count: number;
  /** True when a tombstone was written to propagate the removal to teammates. */
  tombstoned: boolean;
  hint: string;
}

export interface UngraduateFactInput {
  observation_id: number;
  project?: string;
  cwd?: string;
}

export interface UngraduateFactResult {
  project: string;
  observation_id: number;
  removed: boolean;
  tombstoned: boolean;
  hint: string;
}

export interface ExportMemoryInput {
  cwd?: string;
  project?: string;
  branch?: string;
  all?: boolean;
  message?: string;
  force?: boolean;
}

export interface ExportMemoryResult {
  project: string;
  files: string[];
  total_added: number;
  graduated_added: number;
  committed: boolean;
  /** Always false — export_memory never pushes; the user pushes when ready. */
  pushed: boolean;
  /** Exact command to publish the local commit (e.g. `git push -u origin <branch>`). */
  commit_hint: string | null;
  note: string | null;
  /** Present when the fail-closed secret scan blocked the export (no files written). */
  redaction_blocked?: { categories: string[]; count: number; instruction: string };
}

export interface ShareStatusInput {
  cwd?: string;
  project?: string;
}

export interface ShareStatusResult {
  project: string;
  pending_export: number;
  shared_pins: number;
  total_pins: number;
  graduated: number;
  has_sync_dir: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'get_branch_context',
    description:
      'Branch-aware semantic + recency + pin search across claude-mem observations. ' +
      'Returns top-K observations relevant to the query, weighted to the current branch.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query' },
        project: {
          type: 'string',
          description: 'Project slug (defaults to basename of cwd)',
        },
        branch: {
          type: 'string',
          description: 'Branch override (defaults to current branch in cwd)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory used to derive project + branch (defaults to server cwd)',
        },
        k: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Max results to return (default 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_branch_timeline',
    description: 'Chronological list of observations tagged on a specific branch (newest first).',
    inputSchema: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch name' },
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
        cwd: { type: 'string', description: 'Working directory used to derive project' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Max entries (default 50)',
        },
      },
      required: ['branch'],
    },
  },
  {
    name: 'list_branches',
    description: 'List branches with tagged-observation counts for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
        cwd: { type: 'string', description: 'Working directory used to derive project' },
      },
    },
  },
  {
    name: 'pin_fact',
    description:
      'Pin an observation to a branch so it floats to the top of every get_branch_context call.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: { type: 'integer', minimum: 1 },
        branch: { type: 'string', description: 'Branch to pin on (defaults to current branch)' },
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
        cwd: { type: 'string', description: 'Working directory used to derive project + branch' },
        note: { type: 'string', description: 'Free-form note attached to the pin' },
      },
      required: ['observation_id'],
    },
  },
  {
    name: 'graduate_fact',
    description: 'Promote a branch-scoped observation to a project-wide graduated fact.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: { type: 'integer', minimum: 1 },
        branch: {
          type: 'string',
          description: 'Source branch the fact graduated from (defaults to current branch)',
        },
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
        cwd: { type: 'string', description: 'Working directory used to derive project + branch' },
      },
      required: ['observation_id'],
    },
  },
  {
    name: 'unpin_fact',
    description:
      'Remove a pin from a branch (the inverse of pin_fact). If the pin was already shared, writes a tombstone to .tre-mem/ so teammates lose it on their next import — call export_memory afterward to publish the removal.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: { type: 'integer', minimum: 1 },
        branch: {
          type: 'string',
          description: 'Branch to unpin from (defaults to current branch)',
        },
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
        cwd: { type: 'string', description: 'Working directory used to derive project + branch' },
      },
      required: ['observation_id'],
    },
  },
  {
    name: 'ungraduate_fact',
    description:
      'Remove a project-wide graduated fact (the inverse of graduate_fact). Use this when a fact becomes wrong after PR feedback or QC. If the fact was shared, writes a tombstone to .tre-mem/ so teammates lose it on their next import — call export_memory afterward to publish the removal. To correct a fact, ungraduate it then graduate_fact the corrected observation.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: { type: 'integer', minimum: 1 },
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
        cwd: { type: 'string', description: 'Working directory used to derive project' },
      },
      required: ['observation_id'],
    },
  },
  {
    name: 'export_memory',
    description:
      'Publish curated memory (pins + graduated facts) to the repo-local .tre-mem/ files and make a local git commit. Does NOT push — the user pushes when ready (the result carries the exact push command). Call this after pin_fact/graduate_fact to share with the team. Fail-closed on detected secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repo root (defaults to server cwd)' },
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
        branch: {
          type: 'string',
          description: 'Export a single branch (defaults to current branch)',
        },
        all: { type: 'boolean', description: 'Export every branch that has pins' },
        message: {
          type: 'string',
          description: 'Commit message (defaults to a generated summary)',
        },
        force: {
          type: 'boolean',
          description:
            'Redact detected secrets with placeholders instead of aborting (use with care)',
        },
      },
    },
  },
  {
    name: 'get_share_status',
    description:
      'Report how much curated memory is waiting to be shared: unshared pins, shared pins, total pins, graduated facts, and whether a .tre-mem/ directory exists. Use to nudge the user to export.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repo root (defaults to server cwd)' },
        project: { type: 'string', description: 'Project slug (defaults to basename of cwd)' },
      },
    },
  },
] as const;

export async function getBranchContext(
  deps: ToolDeps,
  input: GetBranchContextInput,
): Promise<GetBranchContextResult> {
  const cwd = resolveCwd(deps, input.cwd);
  const identity = await resolveIdentity(deps, cwd, input.project);
  const branch = input.branch ?? (await resolveBranch(deps, cwd));
  const k = input.k ?? 10;
  const nowEpoch = (deps.now ?? defaultNow)();

  const hits = searchBranchContext(
    { adapter: deps.adapter, repo: deps.repo },
    { query: input.query, projects: identity.aliases, branch, k, nowEpoch },
  );

  return {
    project: identity.project,
    branch,
    query: input.query,
    k,
    hits: hits.map((h) => ({
      observation_id: h.observation.id,
      title: h.observation.title,
      subtitle: h.observation.subtitle,
      text: truncate(h.observation.text, 2000),
      type: h.observation.type,
      created_at: h.observation.created_at,
      created_at_epoch: h.observation.created_at_epoch,
      total: h.total,
      breakdown: h.breakdown,
      source: h.source,
    })),
  };
}

export async function getBranchTimeline(
  deps: ToolDeps,
  input: GetBranchTimelineInput,
): Promise<GetBranchTimelineResult> {
  const cwd = resolveCwd(deps, input.cwd);
  const identity = await resolveIdentity(deps, cwd, input.project);
  const limit = input.limit ?? 50;

  const tags = deps.repo.listBranchTagsForBranchAcross(identity.aliases, input.branch, limit);
  const ids = tags.map((t) => t.observation_id);
  const observations = deps.adapter && ids.length > 0 ? deps.adapter.getObservationsByIds(ids) : [];
  const byId = new Map(observations.map((o) => [o.id, o]));

  const entries: GetBranchTimelineResult['entries'] = [];
  for (const tag of tags) {
    const obs: Observation | undefined = byId.get(tag.observation_id);
    if (obs === undefined) continue;
    entries.push({
      observation_id: obs.id,
      title: obs.title,
      subtitle: obs.subtitle,
      type: obs.type,
      created_at: obs.created_at,
      created_at_epoch: obs.created_at_epoch,
      tagged_at_epoch: tag.tagged_at_epoch,
      source: tag.source,
    });
  }

  return { project: identity.project, branch: input.branch, limit, entries };
}

export async function listBranches(
  deps: ToolDeps,
  input: ListBranchesInput,
): Promise<ListBranchesResult> {
  const cwd = resolveCwd(deps, input.cwd);
  const identity = await resolveIdentity(deps, cwd, input.project);
  return {
    project: identity.project,
    branches: deps.repo.listBranchesForProjectAcross(identity.aliases),
  };
}

export async function pinFact(deps: ToolDeps, input: PinFactInput): Promise<PinFactResult> {
  if (!Number.isInteger(input.observation_id) || input.observation_id <= 0) {
    throw new Error(`pin_fact: invalid observation_id "${String(input.observation_id)}"`);
  }
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd);
  const branch = input.branch ?? (await resolveBranch(deps, cwd));
  const created_at_epoch = (deps.now ?? defaultNow)();

  const pin = deps.repo.addPin({
    project,
    branch,
    observation_id: input.observation_id,
    note: input.note ?? null,
    created_at_epoch,
  });

  return {
    pin_id: pin.id,
    project: pin.project,
    branch: pin.branch,
    observation_id: pin.observation_id ?? input.observation_id,
    note: pin.note,
    created_at_epoch: pin.created_at_epoch,
  };
}

export async function graduateFact(
  deps: ToolDeps,
  input: GraduateFactInput,
): Promise<GraduateFactResult> {
  if (!Number.isInteger(input.observation_id) || input.observation_id <= 0) {
    throw new Error(`graduate_fact: invalid observation_id "${String(input.observation_id)}"`);
  }
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd);
  const branch = input.branch ?? (await resolveBranch(deps, cwd));
  const graduated_at_epoch = (deps.now ?? defaultNow)();

  const g = deps.repo.graduateFact({
    project,
    observation_id: input.observation_id,
    graduated_from_branch: branch,
    graduated_at_epoch,
  });

  return {
    graduated_id: g.id,
    project: g.project,
    observation_id: g.observation_id,
    graduated_from_branch: g.graduated_from_branch,
    graduated_at_epoch: g.graduated_at_epoch,
    hint: 'Graduated to the sidecar. Call export_memory to publish it to your team (writes .tre-mem/ and commits locally — you push when ready).',
  };
}

export async function unpinFact(deps: ToolDeps, input: UnpinFactInput): Promise<UnpinFactResult> {
  if (!Number.isInteger(input.observation_id) || input.observation_id <= 0) {
    throw new Error(`unpin_fact: invalid observation_id "${String(input.observation_id)}"`);
  }
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd); // WRITE key — per-clone removal
  const branch = input.branch ?? (await resolveBranch(deps, cwd));
  const dir = resolve(cwd, SYNC_DIR_NAME);
  const now = (deps.now ?? defaultNow)();
  const author = await gitAuthor(cwd);

  const result = forgetPin({
    repo: deps.repo,
    dir,
    project,
    branch,
    observation_id: input.observation_id,
    now,
    author,
  });

  return {
    project,
    branch,
    observation_id: input.observation_id,
    removed_count: result.removed,
    tombstoned: result.tombstoned,
    hint: result.tombstoned
      ? 'Removed locally and wrote a tombstone to .tre-mem/. Call export_memory to publish the removal to your team.'
      : 'Removed locally. Nothing was shared, so no tombstone was needed.',
  };
}

export async function ungraduateFact(
  deps: ToolDeps,
  input: UngraduateFactInput,
): Promise<UngraduateFactResult> {
  if (!Number.isInteger(input.observation_id) || input.observation_id <= 0) {
    throw new Error(`ungraduate_fact: invalid observation_id "${String(input.observation_id)}"`);
  }
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd); // WRITE key — per-clone removal
  const dir = resolve(cwd, SYNC_DIR_NAME);
  const now = (deps.now ?? defaultNow)();
  const author = await gitAuthor(cwd);

  const result = forgetGraduated({
    repo: deps.repo,
    dir,
    project,
    observation_id: input.observation_id,
    now,
    author,
  });

  return {
    project,
    observation_id: input.observation_id,
    removed: result.removed > 0,
    tombstoned: result.tombstoned,
    hint: result.tombstoned
      ? 'Removed locally and wrote a tombstone to .tre-mem/. Call export_memory to publish the removal to your team.'
      : result.removed > 0
        ? 'Removed locally. Nothing was shared, so no tombstone was needed.'
        : 'No graduated fact found for that observation_id.',
  };
}

export async function exportMemory(
  deps: ToolDeps,
  input: ExportMemoryInput,
): Promise<ExportMemoryResult> {
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd); // WRITE key — export the current clone's facts
  const dir = resolve(cwd, SYNC_DIR_NAME);
  const author = await gitAuthor(cwd);
  const now = (deps.now ?? defaultNow)();

  let branches: string[];
  if (input.all) {
    branches = deps.repo.listPinBranches(project);
  } else if (input.branch) {
    branches = [input.branch];
  } else {
    const cur = await resolveBranch(deps, cwd);
    branches = cur === NO_GIT || isDetached(cur) ? deps.repo.listPinBranches(project) : [cur];
  }

  const snapshots: SnapshotProvider = deps.adapter
    ? new AdapterSnapshotProvider(deps.adapter)
    : { getSnapshots: () => new Map() };

  let result;
  try {
    result = exportSync({
      repo: deps.repo,
      snapshots,
      project,
      dir,
      branches,
      now,
      author,
      shareignore: loadShareignore(dir),
      redact: input.force ?? false,
      dryRun: false,
    });
  } catch (err) {
    if (err instanceof RedactionError) {
      const categories = [...new Set(err.matches.map((m) => m.rule))];
      return {
        project,
        files: [],
        total_added: 0,
        graduated_added: 0,
        committed: false,
        pushed: false,
        commit_hint: null,
        note: `export blocked: ${err.matches.length} potential secret(s) detected`,
        redaction_blocked: {
          categories,
          count: err.matches.length,
          instruction:
            'Remove the secret(s) from the pinned facts, add a .tre-mem/.shareignore pattern, or run `tre share --force` in a terminal to redact with placeholders. No secret values are returned here.',
        },
      };
    }
    throw err;
  }

  const totalAdded = result.branches.reduce((s, b) => s + b.added, 0) + result.graduated.added;
  const files = [
    ...result.branches.filter((b) => b.added > 0).map((b) => b.file),
    ...(result.graduated.added > 0 ? [result.graduated.file] : []),
  ];

  let committed = false;
  let commitHint: string | null = null;
  let note: string | null = null;
  if (totalAdded > 0) {
    ensureSyncScaffold(result.dir);
    try {
      const share = await shareToGit({
        git: simpleGitShare(cwd),
        dir: result.dir,
        pathspec: SYNC_DIR_NAME,
        message:
          input.message ?? `chore(tre-mem): export ${totalAdded} memory fact(s) for ${project}`,
        commit: true,
        push: false,
      });
      committed = share.committed;
      note = share.note;
      if (share.committed) {
        commitHint = share.upstream ? 'git push' : `git push -u origin ${share.branch}`;
      }
    } catch (err) {
      note = `export written, but git commit was skipped (${err instanceof Error ? err.message.split('\n')[0] : 'git unavailable'})`;
    }
  } else {
    note = 'nothing new to export — curated facts are already in .tre-mem/';
  }

  return {
    project,
    files,
    total_added: totalAdded,
    graduated_added: result.graduated.added,
    committed,
    pushed: false,
    commit_hint: commitHint,
    note,
  };
}

export function getShareStatus(deps: ToolDeps, input: ShareStatusInput): ShareStatusResult {
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd); // WRITE key — pending share is per-clone
  const pins = deps.repo.listPinsForProject(project);
  return {
    project,
    pending_export: deps.repo.countUnsharedPins(project),
    shared_pins: pins.filter((p) => p.shared_at_epoch !== null).length,
    total_pins: pins.length,
    graduated: deps.repo.listGraduated(project).length,
    has_sync_dir: existsSync(join(cwd, SYNC_DIR_NAME)),
  };
}

export async function callTool(
  deps: ToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'get_branch_context':
      return getBranchContext(deps, args as unknown as GetBranchContextInput);
    case 'get_branch_timeline':
      return getBranchTimeline(deps, args as unknown as GetBranchTimelineInput);
    case 'list_branches':
      return listBranches(deps, args as unknown as ListBranchesInput);
    case 'export_memory':
      return exportMemory(deps, args as unknown as ExportMemoryInput);
    case 'get_share_status':
      return getShareStatus(deps, args as unknown as ShareStatusInput);
    case 'pin_fact':
      return pinFact(deps, args as unknown as PinFactInput);
    case 'graduate_fact':
      return graduateFact(deps, args as unknown as GraduateFactInput);
    case 'unpin_fact':
      return unpinFact(deps, args as unknown as UnpinFactInput);
    case 'ungraduate_fact':
      return ungraduateFact(deps, args as unknown as UngraduateFactInput);
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

function resolveCwd(deps: ToolDeps, override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  return deps.defaultCwd ?? process.cwd();
}

async function resolveBranch(deps: ToolDeps, cwd: string): Promise<string> {
  return deps.resolveBranch ? deps.resolveBranch(cwd) : currentBranch(cwd);
}

function resolveIdentity(deps: ToolDeps, cwd: string, project?: string) {
  return resolveProjectIdentity(deps.repo, cwd, { project, resolveRemote: deps.resolveRemote });
}

function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}

function truncate(s: string | null, max: number): string | null {
  if (s === null) return null;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

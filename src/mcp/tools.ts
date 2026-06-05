import { basename } from 'node:path';

import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import type { Observation } from '../adapter/types.js';
import { currentBranch } from '../git/resolver.js';
import type { RerankBreakdown } from '../retrieval/rerank.js';
import { searchBranchContext } from '../retrieval/search.js';
import type { TreMemRepo } from '../store/repo.js';

export interface ToolDeps {
  /** Null in shared-memory-only mode (claude-mem absent): full-text/observation
   *  signals are skipped; pins + graduated still surface from the sidecar. */
  adapter: ClaudeMemAdapter | null;
  repo: TreMemRepo;
  defaultCwd?: string;
  resolveBranch?: (cwd: string) => Promise<string>;
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
] as const;

export async function getBranchContext(
  deps: ToolDeps,
  input: GetBranchContextInput,
): Promise<GetBranchContextResult> {
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd);
  const branch = input.branch ?? (await resolveBranch(deps, cwd));
  const k = input.k ?? 10;
  const nowEpoch = (deps.now ?? defaultNow)();

  const hits = searchBranchContext(
    { adapter: deps.adapter, repo: deps.repo },
    { query: input.query, project, branch, k, nowEpoch },
  );

  return {
    project,
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
  const project = input.project ?? basename(cwd);
  const limit = input.limit ?? 50;

  const tags = deps.repo.listBranchTagsForBranch(project, input.branch, limit);
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

  return { project, branch: input.branch, limit, entries };
}

export function listBranches(deps: ToolDeps, input: ListBranchesInput): ListBranchesResult {
  const cwd = resolveCwd(deps, input.cwd);
  const project = input.project ?? basename(cwd);
  return { project, branches: deps.repo.listBranchesForProject(project) };
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
    case 'pin_fact':
      return pinFact(deps, args as unknown as PinFactInput);
    case 'graduate_fact':
      return graduateFact(deps, args as unknown as GraduateFactInput);
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

function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}

function truncate(s: string | null, max: number): string | null {
  if (s === null) return null;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

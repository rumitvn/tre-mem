import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Observation } from '../adapter/types.js';
import { branchAuthors } from '../git/identity.js';
import { searchBranchContext } from '../retrieval/search.js';
import type { BranchPin, Graduated, TreMemRepo } from '../store/repo.js';
import { SYNC_DIR_NAME } from '../sync/layout.js';
import { readSyncRecords } from '../sync/read.js';

import {
  aggregateContributors,
  buildGitContributors,
  buildGitGraph,
  buildGraph,
  type BranchAuthors,
} from './grove.js';
import { sendError, sendJson } from './respond.js';
import { type Route, type RouteCtx, webMode } from './types.js';

/** Project from `?project=`, else the repo the server was launched in. */
function resolveProject(ctx: RouteCtx): string {
  const q = ctx.query.get('project');
  return q && q.trim() !== '' ? q.trim() : ctx.deps.project;
}

/** Branch from `?branch=`, else the live branch_state for cwd, else first branch. */
function resolveBranch(ctx: RouteCtx, project: string): string {
  const q = ctx.query.get('branch');
  if (q && q.trim() !== '') return q.trim();
  const state = ctx.deps.repo.getBranchState(ctx.deps.cwd);
  if (state && state.project === project) return state.current_branch;
  const branches = ctx.deps.repo.listBranchesForProject(project);
  return branches[0]?.branch ?? '(no-git)';
}

function listProjects(
  repo: TreMemRepo,
  adapter: RouteCtx['deps']['adapter'],
  current: string,
): string[] {
  const set = new Set<string>([current]);
  for (const s of repo.listBranchStates()) set.add(s.project);
  if (adapter) for (const p of adapter.listProjects()) set.add(p);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function pinView(p: BranchPin): Record<string, unknown> {
  return {
    id: p.id,
    branch: p.branch,
    observation_id: p.observation_id,
    note: p.note,
    title: p.title,
    body: p.body,
    created_at_epoch: p.created_at_epoch,
    shared: p.shared_at_epoch !== null,
    shared_at_epoch: p.shared_at_epoch,
  };
}

function graduatedView(g: Graduated): Record<string, unknown> {
  return {
    id: g.id,
    observation_id: g.observation_id,
    from_branch: g.graduated_from_branch,
    title: g.title,
    body: g.body,
    graduated_at_epoch: g.graduated_at_epoch,
    shared: g.shared_at_epoch !== null,
  };
}

function snippet(text: string | null, max = 200): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** `?fallback=git` (default on) lets solo/unshared repos light up via git authors. */
function fallbackEnabled(ctx: RouteCtx): boolean {
  const q = ctx.query.get('fallback');
  return q === null || q === '' || q === 'git' || q === '1' || q === 'true';
}

/** Commit authors for every branch tre-mem knows about — the git-fallback source. */
async function gitBranchAuthors(
  repo: TreMemRepo,
  cwd: string,
  project: string,
): Promise<BranchAuthors[]> {
  const branches = repo.listBranchesForProject(project).map((b) => b.branch);
  const out: BranchAuthors[] = [];
  for (const branch of branches) {
    const authors = await branchAuthors(cwd, branch);
    if (authors.length > 0) out.push({ branch, authors });
  }
  return out;
}

const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    handler: (_req, res, ctx) => {
      sendJson(res, 200, {
        ok: true,
        version: ctx.deps.version,
        mode: webMode(ctx.deps),
        project: ctx.deps.project,
        cwd: ctx.deps.cwd,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects',
    handler: (_req, res, ctx) => {
      sendJson(res, 200, {
        current: ctx.deps.project,
        projects: listProjects(ctx.deps.repo, ctx.deps.adapter, ctx.deps.project),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/branches',
    handler: (_req, res, ctx) => {
      const project = resolveProject(ctx);
      const { repo } = ctx.deps;
      const pinsByBranch = new Map<string, number>();
      for (const p of repo.listPinsForProject(project)) {
        pinsByBranch.set(p.branch, (pinsByBranch.get(p.branch) ?? 0) + 1);
      }
      const state = repo.getBranchState(ctx.deps.cwd);
      const branches = repo.listBranchesForProject(project).map((b) => {
        const newest = repo.listBranchTagsForBranch(project, b.branch, 1)[0];
        return {
          branch: b.branch,
          count: b.count,
          pins: pinsByBranch.get(b.branch) ?? 0,
          last_active_epoch: newest?.tagged_at_epoch ?? null,
        };
      });
      sendJson(res, 200, {
        project,
        current_branch: state && state.project === project ? state.current_branch : null,
        branches,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/branch/:branch',
    handler: (_req, res, ctx) => {
      const project = resolveProject(ctx);
      const branch = decodeURIComponent(ctx.params.branch ?? '');
      const { repo, adapter } = ctx.deps;
      const tags = repo.listBranchTagsForBranch(project, branch);
      const byId = new Map<number, Observation>();
      if (adapter && tags.length > 0) {
        for (const o of adapter.getObservationsByIds(tags.map((t) => t.observation_id))) {
          byId.set(o.id, o);
        }
      }
      const timeline = tags.map((t) => {
        const o = byId.get(t.observation_id);
        return {
          observation_id: t.observation_id,
          title: o?.title ?? null,
          type: o?.type ?? null,
          tagged_at_epoch: t.tagged_at_epoch,
          source: t.source,
        };
      });
      sendJson(res, 200, {
        project,
        branch,
        timeline,
        pins: repo.listPinsForBranch(project, branch).map(pinView),
        graduated: repo
          .listGraduated(project)
          .filter((g) => g.graduated_from_branch === branch)
          .map(graduatedView),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/pins',
    handler: (_req, res, ctx) => {
      const project = resolveProject(ctx);
      sendJson(res, 200, {
        project,
        pins: ctx.deps.repo.listPinsForProject(project).map(pinView),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/graduated',
    handler: (_req, res, ctx) => {
      const project = resolveProject(ctx);
      sendJson(res, 200, {
        project,
        graduated: ctx.deps.repo.listGraduated(project).map(graduatedView),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/share-status',
    handler: (_req, res, ctx) => {
      const project = resolveProject(ctx);
      const { repo } = ctx.deps;
      const pins = repo.listPinsForProject(project);
      const graduated = repo.listGraduated(project);
      sendJson(res, 200, {
        project,
        pending_export: repo.countUnsharedPins(project),
        shared_pins: pins.filter((p) => p.shared_at_epoch !== null).length,
        total_pins: pins.length,
        graduated: graduated.length,
        has_sync_dir: existsSync(join(ctx.deps.cwd, SYNC_DIR_NAME)),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/observation/:id',
    handler: (_req, res, ctx) => {
      const id = Number(ctx.params.id);
      if (!Number.isInteger(id)) return sendError(res, 400, 'invalid observation id');
      if (!ctx.deps.adapter) {
        return sendJson(res, 200, { observation: null, mode: 'shared-only' });
      }
      const [observation] = ctx.deps.adapter.getObservationsByIds([id]);
      if (!observation) return sendError(res, 404, `observation ${id} not found`);
      return sendJson(res, 200, { observation });
    },
  },
  {
    method: 'GET',
    pattern: '/api/search',
    handler: (_req, res, ctx) => {
      const project = resolveProject(ctx);
      const branch = resolveBranch(ctx, project);
      const query = (ctx.query.get('q') ?? '').trim();
      const k = Math.min(Math.max(Number(ctx.query.get('k')) || 10, 1), 50);
      if (query === '') return sendJson(res, 200, { project, branch, query, hits: [] });

      if (ctx.deps.adapter) {
        const hits = searchBranchContext(
          { adapter: ctx.deps.adapter, repo: ctx.deps.repo },
          { query, project, branch, k, nowEpoch: ctx.deps.now() },
        ).map((h) => ({
          observation_id: h.observation.id,
          title: h.observation.title,
          type: h.observation.type,
          snippet: snippet(h.observation.text ?? h.observation.narrative),
          source: h.source,
          total: h.total,
          breakdown: h.breakdown,
        }));
        return sendJson(res, 200, { project, branch, query, mode: 'full', hits });
      }
      return sendJson(res, 200, {
        project,
        branch,
        query,
        mode: 'shared-only',
        hits: degradedSearch(ctx.deps.repo, project, branch, query, k),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/contributors',
    handler: async (_req, res, ctx) => {
      const project = resolveProject(ctx);
      const dir = join(ctx.deps.cwd, SYNC_DIR_NAME);
      const records = readSyncRecords(dir);
      const { contributors, attributed_total, unattributed_total } = aggregateContributors(
        records,
        project,
        ctx.deps.now(),
      );
      if (attributed_total === 0 && fallbackEnabled(ctx)) {
        const perBranch = await gitBranchAuthors(ctx.deps.repo, ctx.deps.cwd, project);
        if (perBranch.length > 0) {
          return sendJson(res, 200, {
            project,
            source: 'git-fallback',
            contributors: buildGitContributors(perBranch, ctx.deps.now()),
            attributed_total: 0,
            unattributed_total,
            has_sync_dir: existsSync(dir),
          });
        }
      }
      return sendJson(res, 200, {
        project,
        source: 'shared',
        contributors,
        attributed_total,
        unattributed_total,
        has_sync_dir: existsSync(dir),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/graph',
    handler: async (_req, res, ctx) => {
      const project = resolveProject(ctx);
      const dir = join(ctx.deps.cwd, SYNC_DIR_NAME);
      const records = readSyncRecords(dir);
      const hasFacts = records.some((r) => r.project === project);
      if (!hasFacts && fallbackEnabled(ctx)) {
        const perBranch = await gitBranchAuthors(ctx.deps.repo, ctx.deps.cwd, project);
        if (perBranch.length > 0) {
          const { nodes, edges } = buildGitGraph(perBranch, project);
          return sendJson(res, 200, {
            project,
            source: 'git-fallback',
            nodes,
            edges,
            has_sync_dir: existsSync(dir),
          });
        }
      }
      const extraBranches = ctx.deps.repo.listBranchesForProject(project).map((b) => b.branch);
      const { nodes, edges } = buildGraph(records, extraBranches, project);
      return sendJson(res, 200, {
        project,
        source: 'shared',
        nodes,
        edges,
        has_sync_dir: existsSync(dir),
      });
    },
  },
];

/**
 * Shared-memory-only search: when claude-mem is absent we cannot run the FTS5
 * semantic signal, so match the query as a substring over the self-contained
 * pin/graduated snapshots and rank branch-local rows first.
 */
function degradedSearch(
  repo: TreMemRepo,
  project: string,
  branch: string,
  query: string,
  k: number,
): Array<Record<string, unknown>> {
  const needle = query.toLowerCase();
  const matches = (parts: Array<string | null>): boolean =>
    parts.some((p) => p && p.toLowerCase().includes(needle));

  const pinHits = repo
    .listPinsForProject(project)
    .filter((p) => matches([p.title, p.note, p.body]))
    .map((p) => ({
      observation_id: p.observation_id,
      title: p.title ?? p.note ?? '(pinned)',
      type: 'pin',
      snippet: snippet(p.body ?? p.note),
      source: 'shared-pin' as const,
      total: p.branch === branch ? 1.4 : 1.0,
    }));

  const gradHits = repo
    .listGraduated(project)
    .filter((g) => matches([g.title, g.body]))
    .map((g) => ({
      observation_id: g.observation_id,
      title: g.title ?? '(graduated)',
      type: 'graduated',
      snippet: snippet(g.body),
      source: 'graduated' as const,
      total: 0.9,
    }));

  return [...pinHits, ...gradHits].sort((a, b) => b.total - a.total).slice(0, k);
}

export function apiRoutes(): Route[] {
  return ROUTES;
}

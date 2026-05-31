import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import type { Observation } from '../adapter/types.js';
import type { TreMemRepo } from '../store/repo.js';

import { rerank, type RerankBreakdown, type RerankWeights } from './rerank.js';
import { Fts5SemanticSearcher, type SemanticSearcher } from './semantic.js';
import { branchSignal, recencySignal, semanticSignal } from './signals.js';

const DEFAULT_K = 10;
const DEFAULT_FETCH_MULTIPLIER = 4;
const DEFAULT_RECENCY_WINDOW_DAYS = 14;
const SECONDS_PER_DAY = 86_400;

export interface SearchHit {
  observation: Observation;
  total: number;
  breakdown: RerankBreakdown;
}

export interface SearchOptions {
  query: string;
  project: string;
  branch: string;
  k?: number;
  weights?: Partial<RerankWeights>;
  nowEpoch?: number;
  recencyWindowDays?: number;
  semantic?: SemanticSearcher;
}

export interface SearchDeps {
  adapter: ClaudeMemAdapter;
  repo: TreMemRepo;
}

export function searchBranchContext(deps: SearchDeps, opts: SearchOptions): SearchHit[] {
  const k = opts.k ?? DEFAULT_K;
  const fetchK = k * DEFAULT_FETCH_MULTIPLIER;
  const nowEpoch = opts.nowEpoch ?? Math.floor(Date.now() / 1000);
  const windowDays = opts.recencyWindowDays ?? DEFAULT_RECENCY_WINDOW_DAYS;
  const sinceEpoch = nowEpoch - windowDays * SECONDS_PER_DAY;

  const searcher = opts.semantic ?? new Fts5SemanticSearcher(deps.adapter);

  const semHits = searcher.search({
    query: opts.query,
    project: opts.project,
    k: fetchK,
  });
  const branchTags = deps.repo.listBranchTagsForBranch(opts.project, opts.branch, fetchK);
  const recentObs = deps.adapter.getObservations({
    project: opts.project,
    sinceEpoch,
    limit: fetchK,
  });
  const pins = deps.repo.listPinsForBranch(opts.project, opts.branch);

  const ranked = rerank(
    {
      semantic: semanticSignal(semHits),
      branch: branchSignal({ tags: branchTags, currentBranch: opts.branch }),
      recency: recencySignal({
        observations: recentObs,
        nowEpoch,
      }),
      pins: pins.map((p) => p.observation_id).filter((id): id is number => id !== null),
    },
    { weights: opts.weights, limit: k },
  );

  if (ranked.length === 0) return [];

  const ids = ranked.map((r) => r.observationId);
  const observations = deps.adapter.getObservationsByIds(ids);
  const byId = new Map(observations.map((o) => [o.id, o]));

  const out: SearchHit[] = [];
  for (const r of ranked) {
    const observation = byId.get(r.observationId);
    if (observation === undefined) continue;
    out.push({ observation, total: r.total, breakdown: r.breakdown });
  }
  return out;
}

import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import type { Observation } from '../adapter/types.js';
import type { BranchPin, Graduated, TreMemRepo } from '../store/repo.js';

import { rerank, type RerankBreakdown, type RerankWeights } from './rerank.js';
import { Fts5SemanticSearcher, type SemanticSearcher } from './semantic.js';
import { branchSignal, graduatedSignal, recencySignal, semanticSignal } from './signals.js';

const DEFAULT_K = 10;
const DEFAULT_FETCH_MULTIPLIER = 4;
const DEFAULT_RECENCY_WINDOW_DAYS = 14;
const SECONDS_PER_DAY = 86_400;

export interface SearchHit {
  observation: Observation;
  total: number;
  breakdown: RerankBreakdown;
  /** Where the surfaced observation came from when it isn't a local claude-mem row. */
  source: 'observation' | 'shared-pin' | 'graduated';
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

/** Synthesize a minimal display observation for a shared row we lack locally. */
function synthObservation(opts: {
  id: number;
  project: string;
  title: string | null;
  text: string | null;
  epoch: number;
  type: string;
}): Observation {
  return {
    id: opts.id,
    memory_session_id: '',
    project: opts.project,
    text: opts.text,
    type: opts.type,
    title: opts.title,
    subtitle: null,
    facts: null,
    narrative: opts.text,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: null,
    created_at: '',
    created_at_epoch: opts.epoch,
  };
}

function pinAsObservation(id: number, pin: BranchPin): Observation {
  return synthObservation({
    id,
    project: pin.project,
    title: pin.title ?? pin.note ?? '(pinned)',
    text: pin.body ?? pin.note,
    epoch: pin.created_at_epoch,
    type: 'pin',
  });
}

function graduatedAsObservation(g: Graduated): Observation {
  return synthObservation({
    id: g.observation_id,
    project: g.project,
    title: g.title ?? '(graduated)',
    text: g.body,
    epoch: g.graduated_at_epoch,
    type: 'graduated',
  });
}

export function searchBranchContext(deps: SearchDeps, opts: SearchOptions): SearchHit[] {
  const k = opts.k ?? DEFAULT_K;
  const fetchK = k * DEFAULT_FETCH_MULTIPLIER;
  const nowEpoch = opts.nowEpoch ?? Math.floor(Date.now() / 1000);
  const windowDays = opts.recencyWindowDays ?? DEFAULT_RECENCY_WINDOW_DAYS;
  const sinceEpoch = nowEpoch - windowDays * SECONDS_PER_DAY;

  const searcher = opts.semantic ?? new Fts5SemanticSearcher(deps.adapter);

  const semHits = searcher.search({ query: opts.query, project: opts.project, k: fetchK });
  const branchTags = deps.repo.listBranchTagsForBranch(opts.project, opts.branch, fetchK);
  const recentObs = deps.adapter.getObservations({ project: opts.project, sinceEpoch, limit: fetchK });

  // Pins: a free-text pin (no observation) still surfaces, via a stable
  // negative synthetic id so it flows through the id-keyed reranker.
  const pins = deps.repo.listPinsForBranch(opts.project, opts.branch);
  const pinEntries = pins.map((pin) => ({ id: pin.observation_id ?? -pin.id, pin }));
  const pinById = new Map(pinEntries.map((e) => [e.id, e.pin]));

  // Cap the always-on graduated boost to the most-recent fetchK (listGraduated
  // is ordered newest-first) so a repo with many merged PRs can't crowd out
  // query-relevant observations from the k result slots.
  const graduated = deps.repo.listGraduated(opts.project).slice(0, fetchK);
  const gradByObsId = new Map(graduated.map((g) => [g.observation_id, g]));

  const ranked = rerank(
    {
      semantic: semanticSignal(semHits),
      branch: branchSignal({ tags: branchTags, currentBranch: opts.branch }),
      recency: recencySignal({ observations: recentObs, nowEpoch }),
      graduated: graduatedSignal(graduated.map((g) => g.observation_id)),
      pins: pinEntries.map((e) => e.id),
    },
    { weights: opts.weights, limit: k },
  );

  if (ranked.length === 0) return [];

  const positiveIds = ranked.map((r) => r.observationId).filter((id) => id > 0);
  const byId = new Map(deps.adapter.getObservationsByIds(positiveIds).map((o) => [o.id, o]));

  const out: SearchHit[] = [];
  for (const r of ranked) {
    const real = r.observationId > 0 ? byId.get(r.observationId) : undefined;
    if (real !== undefined) {
      out.push({ observation: real, total: r.total, breakdown: r.breakdown, source: 'observation' });
      continue;
    }
    // No local observation — fall back to the shared pin / graduated snapshot.
    const pin = pinById.get(r.observationId);
    if (pin !== undefined) {
      out.push({
        observation: pinAsObservation(r.observationId, pin),
        total: r.total,
        breakdown: r.breakdown,
        source: 'shared-pin',
      });
      continue;
    }
    const grad = gradByObsId.get(r.observationId);
    if (grad !== undefined) {
      out.push({
        observation: graduatedAsObservation(grad),
        total: r.total,
        breakdown: r.breakdown,
        source: 'graduated',
      });
    }
  }
  return out;
}

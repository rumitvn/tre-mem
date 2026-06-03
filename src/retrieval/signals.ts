import type { Observation } from '../adapter/types.js';
import type { BranchTag } from '../store/repo.js';

import type { SemanticHit } from './semantic.js';

export interface ScoredObservation {
  observationId: number;
  score: number;
}

const SECONDS_PER_DAY = 86_400;
const DEFAULT_RECENCY_HALF_LIFE_DAYS = 3;

export function semanticSignal(hits: ReadonlyArray<SemanticHit>): ScoredObservation[] {
  return hits.map((hit) => ({
    observationId: hit.observationId,
    score: hit.similarity,
  }));
}

export interface BranchSignalInput {
  tags: ReadonlyArray<BranchTag>;
  currentBranch: string;
}

export function branchSignal({ tags, currentBranch }: BranchSignalInput): ScoredObservation[] {
  return tags
    .filter((tag) => tag.branch === currentBranch)
    .map((tag) => ({ observationId: tag.observation_id, score: 1 }));
}

/**
 * Graduated facts are repo-wide knowledge promoted off a branch. They surface
 * on every branch with a flat boost so cross-branch decisions flow naturally.
 */
export function graduatedSignal(observationIds: ReadonlyArray<number>): ScoredObservation[] {
  return observationIds.map((observationId) => ({ observationId, score: 1 }));
}

export interface RecencySignalInput {
  observations: ReadonlyArray<Observation>;
  nowEpoch: number;
  halfLifeDays?: number;
}

export function recencySignal({
  observations,
  nowEpoch,
  halfLifeDays = DEFAULT_RECENCY_HALF_LIFE_DAYS,
}: RecencySignalInput): ScoredObservation[] {
  const halfLifeSeconds = halfLifeDays * SECONDS_PER_DAY;
  return observations.map((obs) => {
    const ageSeconds = Math.max(0, nowEpoch - obs.created_at_epoch);
    const score = Math.pow(0.5, ageSeconds / halfLifeSeconds);
    return { observationId: obs.id, score };
  });
}

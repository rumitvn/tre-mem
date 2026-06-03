import type { ScoredObservation } from './signals.js';

export interface RerankWeights {
  semantic: number;
  branch: number;
  recency: number;
  graduated: number;
  pin: number;
}

export const DEFAULT_RERANK_WEIGHTS: RerankWeights = {
  semantic: 0.4,
  branch: 0.4,
  recency: 0.2,
  graduated: 0.3,
  pin: 1,
};

export interface RerankInput {
  semantic: ReadonlyArray<ScoredObservation>;
  branch: ReadonlyArray<ScoredObservation>;
  recency: ReadonlyArray<ScoredObservation>;
  graduated?: ReadonlyArray<ScoredObservation>;
  pins: ReadonlyArray<number>;
}

export interface RerankBreakdown {
  semantic: number;
  branch: number;
  recency: number;
  graduated: number;
  pin: number;
}

export interface RerankResult {
  observationId: number;
  total: number;
  breakdown: RerankBreakdown;
}

export interface RerankOptions {
  weights?: Partial<RerankWeights>;
  limit?: number;
}

export function rerank(input: RerankInput, opts: RerankOptions = {}): RerankResult[] {
  const weights: RerankWeights = { ...DEFAULT_RERANK_WEIGHTS, ...opts.weights };

  const sem = collapseMax(input.semantic);
  const br = collapseMax(input.branch);
  const rec = collapseMax(input.recency);
  const grad = collapseMax(input.graduated ?? []);
  const pinSet = new Set<number>(input.pins);

  const ids = new Set<number>();
  for (const id of sem.keys()) ids.add(id);
  for (const id of br.keys()) ids.add(id);
  for (const id of rec.keys()) ids.add(id);
  for (const id of grad.keys()) ids.add(id);
  for (const id of pinSet) ids.add(id);

  const results: RerankResult[] = [];
  for (const id of ids) {
    const breakdown: RerankBreakdown = {
      semantic: (sem.get(id) ?? 0) * weights.semantic,
      branch: (br.get(id) ?? 0) * weights.branch,
      recency: (rec.get(id) ?? 0) * weights.recency,
      graduated: (grad.get(id) ?? 0) * weights.graduated,
      pin: pinSet.has(id) ? weights.pin : 0,
    };
    const total =
      breakdown.semantic +
      breakdown.branch +
      breakdown.recency +
      breakdown.graduated +
      breakdown.pin;
    results.push({ observationId: id, total, breakdown });
  }

  results.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.observationId - b.observationId;
  });

  if (opts.limit !== undefined && opts.limit >= 0) {
    return results.slice(0, opts.limit);
  }
  return results;
}

function collapseMax(scored: ReadonlyArray<ScoredObservation>): Map<number, number> {
  const out = new Map<number, number>();
  for (const { observationId, score } of scored) {
    const prev = out.get(observationId);
    if (prev === undefined || score > prev) out.set(observationId, score);
  }
  return out;
}

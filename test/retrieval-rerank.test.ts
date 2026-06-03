import { describe, expect, it } from 'vitest';

import { DEFAULT_RERANK_WEIGHTS, rerank } from '../src/retrieval/rerank.js';

describe('rerank', () => {
  it('returns an empty list when all signals are empty', () => {
    expect(rerank({ semantic: [], branch: [], recency: [], pins: [] })).toEqual([]);
  });

  it('weights a single semantic hit at semantic-weight * similarity', () => {
    const out = rerank({
      semantic: [{ observationId: 1, score: 1 }],
      branch: [],
      recency: [],
      pins: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.observationId).toBe(1);
    expect(out[0]!.total).toBeCloseTo(DEFAULT_RERANK_WEIGHTS.semantic, 6);
    expect(out[0]!.breakdown).toEqual({
      semantic: DEFAULT_RERANK_WEIGHTS.semantic,
      branch: 0,
      recency: 0,
      graduated: 0,
      pin: 0,
    });
  });

  it('sums weighted contributions across signals for the same observation', () => {
    const out = rerank({
      semantic: [{ observationId: 7, score: 1 }],
      branch: [{ observationId: 7, score: 1 }],
      recency: [{ observationId: 7, score: 1 }],
      pins: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.total).toBeCloseTo(
      DEFAULT_RERANK_WEIGHTS.semantic +
        DEFAULT_RERANK_WEIGHTS.branch +
        DEFAULT_RERANK_WEIGHTS.recency,
      6,
    );
  });

  it('boosts pinned observations above any non-pinned candidate', () => {
    const out = rerank({
      semantic: [
        { observationId: 1, score: 1 },
        { observationId: 2, score: 0.9 },
      ],
      branch: [{ observationId: 1, score: 1 }],
      recency: [{ observationId: 1, score: 1 }],
      pins: [2],
    });
    expect(out[0]!.observationId).toBe(2);
    expect(out[0]!.breakdown.pin).toBe(DEFAULT_RERANK_WEIGHTS.pin);
    expect(out[0]!.total).toBeGreaterThan(out[1]!.total);
  });

  it('sorts results by total DESC then by observationId ASC for ties', () => {
    const out = rerank({
      semantic: [
        { observationId: 3, score: 0.5 },
        { observationId: 1, score: 0.5 },
        { observationId: 2, score: 0.5 },
      ],
      branch: [],
      recency: [],
      pins: [],
    });
    expect(out.map((r) => r.observationId)).toEqual([1, 2, 3]);
  });

  it('dedupes duplicates within a signal by taking the max score', () => {
    const out = rerank({
      semantic: [
        { observationId: 5, score: 0.3 },
        { observationId: 5, score: 0.9 },
        { observationId: 5, score: 0.1 },
      ],
      branch: [],
      recency: [],
      pins: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.breakdown.semantic).toBeCloseTo(0.9 * DEFAULT_RERANK_WEIGHTS.semantic, 6);
  });

  it('respects a custom limit', () => {
    const out = rerank(
      {
        semantic: [
          { observationId: 1, score: 0.9 },
          { observationId: 2, score: 0.8 },
          { observationId: 3, score: 0.7 },
        ],
        branch: [],
        recency: [],
        pins: [],
      },
      { limit: 2 },
    );
    expect(out.map((r) => r.observationId)).toEqual([1, 2]);
  });

  it('honors custom weights', () => {
    const out = rerank(
      {
        semantic: [{ observationId: 1, score: 1 }],
        branch: [{ observationId: 1, score: 1 }],
        recency: [{ observationId: 1, score: 1 }],
        pins: [],
      },
      { weights: { semantic: 0.1, branch: 0.5, recency: 0.4, pin: 0 } },
    );
    expect(out[0]!.total).toBeCloseTo(1, 6);
    expect(out[0]!.breakdown).toEqual({
      semantic: 0.1,
      branch: 0.5,
      recency: 0.4,
      graduated: 0,
      pin: 0,
    });
  });

  it('emits pin-only observations even with no other signals', () => {
    const out = rerank({
      semantic: [],
      branch: [],
      recency: [],
      pins: [42],
    });
    expect(out).toEqual([
      {
        observationId: 42,
        total: DEFAULT_RERANK_WEIGHTS.pin,
        breakdown: {
          semantic: 0,
          branch: 0,
          recency: 0,
          graduated: 0,
          pin: DEFAULT_RERANK_WEIGHTS.pin,
        },
      },
    ]);
  });

  it('merges the same id across signals without duplicating', () => {
    const out = rerank({
      semantic: [{ observationId: 9, score: 1 }],
      branch: [{ observationId: 9, score: 1 }],
      recency: [{ observationId: 9, score: 1 }],
      pins: [9],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.observationId).toBe(9);
  });
});

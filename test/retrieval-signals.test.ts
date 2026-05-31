import { describe, expect, it } from 'vitest';

import { branchSignal, recencySignal, semanticSignal } from '../src/retrieval/signals.js';
import type { SemanticHit } from '../src/retrieval/semantic.js';
import type { BranchTag } from '../src/store/repo.js';

describe('semanticSignal', () => {
  it('passes through observationId and similarity unchanged', () => {
    const hits: SemanticHit[] = [
      { observationId: 10, similarity: 1 },
      { observationId: 20, similarity: 0.42 },
    ];
    expect(semanticSignal(hits)).toEqual([
      { observationId: 10, score: 1 },
      { observationId: 20, score: 0.42 },
    ]);
  });

  it('returns an empty list for an empty input', () => {
    expect(semanticSignal([])).toEqual([]);
  });
});

describe('branchSignal', () => {
  const tag = (observation_id: number, branch: string, tagged_at_epoch = 1000): BranchTag => ({
    observation_id,
    project: 'p',
    branch,
    tagged_at_epoch,
    source: 'live',
  });

  it('scores 1.0 for tags matching the current branch, omits others', () => {
    const scored = branchSignal({
      tags: [
        tag(1, 'feature/payment'),
        tag(2, 'feature/payment'),
        tag(3, 'main'),
        tag(4, 'fix/auth'),
      ],
      currentBranch: 'feature/payment',
    });
    const ids = scored.map((s) => s.observationId).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
    expect(scored.every((s) => s.score === 1)).toBe(true);
  });

  it('returns an empty list when no tags match', () => {
    const scored = branchSignal({
      tags: [tag(1, 'main')],
      currentBranch: 'feature/payment',
    });
    expect(scored).toEqual([]);
  });

  it('handles an empty tag list', () => {
    expect(branchSignal({ tags: [], currentBranch: 'main' })).toEqual([]);
  });
});

describe('recencySignal', () => {
  const obs = (id: number, created_at_epoch: number) => ({
    id,
    memory_session_id: 's',
    project: 'p',
    text: null,
    type: 'observation',
    title: null,
    subtitle: null,
    facts: null,
    narrative: null,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: null,
    created_at: '',
    created_at_epoch,
  });

  const ONE_DAY = 86_400;

  it('scores an observation created right now at 1.0', () => {
    const now = 10_000_000;
    const scored = recencySignal({
      observations: [obs(1, now)],
      nowEpoch: now,
    });
    expect(scored).toHaveLength(1);
    expect(scored[0]!.score).toBeCloseTo(1, 6);
  });

  it('scores an observation one half-life old at ~0.5', () => {
    const now = 10_000_000;
    const halfLifeDays = 3;
    const scored = recencySignal({
      observations: [obs(1, now - halfLifeDays * ONE_DAY)],
      nowEpoch: now,
      halfLifeDays,
    });
    expect(scored[0]!.score).toBeCloseTo(0.5, 6);
  });

  it('orders newer observations above older ones', () => {
    const now = 10_000_000;
    const scored = recencySignal({
      observations: [obs(1, now - 5 * ONE_DAY), obs(2, now - 1 * ONE_DAY), obs(3, now)],
      nowEpoch: now,
    });
    const byId = new Map(scored.map((s) => [s.observationId, s.score]));
    expect(byId.get(3)!).toBeGreaterThan(byId.get(2)!);
    expect(byId.get(2)!).toBeGreaterThan(byId.get(1)!);
  });

  it('clamps future-dated observations to 1.0 instead of going above', () => {
    const now = 10_000_000;
    const scored = recencySignal({
      observations: [obs(1, now + ONE_DAY)],
      nowEpoch: now,
    });
    expect(scored[0]!.score).toBe(1);
  });

  it('returns an empty list for empty input', () => {
    expect(recencySignal({ observations: [], nowEpoch: 0 })).toEqual([]);
  });
});

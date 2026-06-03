import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import type { Observation } from '../adapter/types.js';

import type { ObservationSnapshot, SnapshotProvider } from './export.js';

/**
 * Collapse a claude-mem observation into the title/body snapshot that travels in
 * the shared `.tre-mem/` files, so a teammate who lacks the raw observation can
 * still read what was pinned.
 */
export function observationSnapshot(obs: Observation): ObservationSnapshot {
  const title = obs.title ?? obs.subtitle ?? null;
  const body = obs.narrative ?? obs.text ?? obs.facts ?? null;
  return { title, body };
}

export class AdapterSnapshotProvider implements SnapshotProvider {
  constructor(private readonly adapter: ClaudeMemAdapter) {}

  getSnapshots(ids: ReadonlyArray<number>): Map<number, ObservationSnapshot> {
    const out = new Map<number, ObservationSnapshot>();
    if (ids.length === 0) return out;
    for (const obs of this.adapter.getObservationsByIds(ids)) {
      out.set(obs.id, observationSnapshot(obs));
    }
    return out;
  }
}

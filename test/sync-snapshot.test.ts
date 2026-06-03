import { describe, expect, test } from 'vitest';

import type { Observation } from '../src/adapter/types.js';
import { observationSnapshot } from '../src/sync/snapshot.js';

function obs(overrides: Partial<Observation>): Observation {
  return {
    id: 1,
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
    created_at_epoch: 0,
    ...overrides,
  };
}

describe('observationSnapshot', () => {
  test('prefers title then subtitle', () => {
    expect(observationSnapshot(obs({ title: 'T', subtitle: 'S' })).title).toBe('T');
    expect(observationSnapshot(obs({ title: null, subtitle: 'S' })).title).toBe('S');
    expect(observationSnapshot(obs({ title: null, subtitle: null })).title).toBeNull();
  });

  test('prefers narrative then text then facts for body', () => {
    expect(observationSnapshot(obs({ narrative: 'N', text: 'X', facts: 'F' })).body).toBe('N');
    expect(observationSnapshot(obs({ narrative: null, text: 'X', facts: 'F' })).body).toBe('X');
    expect(observationSnapshot(obs({ narrative: null, text: null, facts: 'F' })).body).toBe('F');
    expect(observationSnapshot(obs({ narrative: null, text: null, facts: null })).body).toBeNull();
  });
});

import { describe, expect, test } from 'vitest';

import {
  SYNC_SCHEMA_VERSION,
  graduatedContentHash,
  parseSyncLine,
  pinContentHash,
  serializeSyncRecord,
  type GraduatedRecord,
  type PinRecord,
} from '../src/sync/format.js';

function samplePin(overrides: Partial<PinRecord> = {}): PinRecord {
  const base = {
    project: 'tre-mem',
    branch: 'feature/payment',
    observation_id: 42,
    note: 'use Stripe webhook v3',
    title: 'Stripe webhook decision',
    body: 'We standardized on webhook v3 for idempotency.',
  };
  return {
    schema: SYNC_SCHEMA_VERSION,
    kind: 'pin',
    content_hash: pinContentHash(base),
    author: 'alice',
    tagged_at_epoch: 1_780_000_000,
    ...base,
    ...overrides,
  };
}

function sampleGraduated(overrides: Partial<GraduatedRecord> = {}): GraduatedRecord {
  const base = {
    project: 'tre-mem',
    observation_id: 99,
    graduated_from_branch: 'feature/payment',
    title: 'Stripe is the payment provider',
    body: 'Graduated repo-wide.',
  };
  return {
    schema: SYNC_SCHEMA_VERSION,
    kind: 'graduated',
    content_hash: graduatedContentHash(base),
    author: 'bob',
    graduated_at_epoch: 1_780_000_500,
    ...base,
    ...overrides,
  };
}

describe('content hashing', () => {
  test('pin hash is stable for identical semantic content', () => {
    const a = pinContentHash({
      project: 'p',
      branch: 'b',
      observation_id: 1,
      note: 'n',
      title: 't',
      body: 'x',
    });
    const b = pinContentHash({
      project: 'p',
      branch: 'b',
      observation_id: 1,
      note: 'n',
      title: 't',
      body: 'x',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('pin hash ignores author and timestamp (dedupe across devs)', () => {
    const alice = samplePin({ author: 'alice', tagged_at_epoch: 1 });
    const bob = samplePin({ author: 'bob', tagged_at_epoch: 999 });
    expect(alice.content_hash).toBe(bob.content_hash);
  });

  test('null note and a single-space note hash differently (no sentinel collision)', () => {
    const base = { project: 'p', branch: 'b', observation_id: 1, title: 't', body: 'x' };
    const nullNote = pinContentHash({ ...base, note: null });
    const spaceNote = pinContentHash({ ...base, note: ' ' });
    expect(nullNote).not.toBe(spaceNote);
  });

  test('pin hash changes when note changes', () => {
    const a = samplePin();
    const b = samplePin({ note: 'different note' });
    b.content_hash = pinContentHash({
      project: b.project,
      branch: b.branch,
      observation_id: b.observation_id,
      note: b.note,
      title: b.title,
      body: b.body,
    });
    expect(a.content_hash).not.toBe(b.content_hash);
  });

  test('graduated hash is independent of branch of origin? no — branch is identity', () => {
    const a = graduatedContentHash({
      project: 'p',
      observation_id: 1,
      graduated_from_branch: 'feature/x',
      title: 't',
      body: 'b',
    });
    const b = graduatedContentHash({
      project: 'p',
      observation_id: 1,
      graduated_from_branch: 'feature/y',
      title: 't',
      body: 'b',
    });
    expect(a).not.toBe(b);
  });
});

describe('serialize / parse round-trip', () => {
  test('pin round-trips through JSONL', () => {
    const pin = samplePin();
    const line = serializeSyncRecord(pin);
    expect(line).not.toContain('\n');
    const parsed = parseSyncLine(line);
    expect(parsed).toEqual(pin);
  });

  test('graduated round-trips through JSONL', () => {
    const grad = sampleGraduated();
    const parsed = parseSyncLine(serializeSyncRecord(grad));
    expect(parsed).toEqual(grad);
  });

  test('serialized keys are in a stable order', () => {
    const line = serializeSyncRecord(
      samplePin({ content_hash: 'x', author: 'a', tagged_at_epoch: 1 }),
    );
    expect(line.indexOf('"schema"')).toBeLessThan(line.indexOf('"kind"'));
    expect(line.indexOf('"kind"')).toBeLessThan(line.indexOf('"content_hash"'));
  });

  test('parse rejects malformed JSON', () => {
    expect(() => parseSyncLine('{not json')).toThrow();
  });

  test('parse rejects unknown kind', () => {
    const line = JSON.stringify({ schema: 1, kind: 'bogus', content_hash: 'x' });
    expect(() => parseSyncLine(line)).toThrow(/kind/);
  });

  test('parse rejects unsupported schema version', () => {
    const pin = samplePin();
    const line = serializeSyncRecord({ ...pin, schema: 999 });
    expect(() => parseSyncLine(line)).toThrow(/schema/);
  });

  test('parse rejects pin missing required field', () => {
    const line = JSON.stringify({ schema: 1, kind: 'pin', content_hash: 'x' });
    expect(() => parseSyncLine(line)).toThrow();
  });
});

import { createHash } from 'node:crypto';

/**
 * On-disk JSONL format for the committed `.tre-mem/` directory.
 *
 * Each row is one self-describing record carrying a `schema` version so the
 * format can evolve without breaking older clients. Append-only semantics mean
 * git merges the files as union-merges; `content_hash` is the dedupe key that
 * lets two devs converge on the same pin without a real conflict.
 */
export const SYNC_SCHEMA_VERSION = 1;

const UNIT = '\x1f'; // ASCII Unit Separator — safe payload delimiter for hashing.

export type SyncKind = 'pin' | 'graduated' | 'tombstone';

export interface PinRecord {
  schema: number;
  kind: 'pin';
  content_hash: string;
  project: string;
  branch: string;
  observation_id: number | null;
  note: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
  tagged_at_epoch: number;
}

export interface GraduatedRecord {
  schema: number;
  kind: 'graduated';
  content_hash: string;
  project: string;
  observation_id: number;
  graduated_from_branch: string;
  title: string | null;
  body: string | null;
  author: string | null;
  graduated_at_epoch: number;
}

/**
 * A removal marker. Travels through git like a pin/graduated row and tells every
 * clone to delete the fact whose `content_hash` it carries on the next import.
 * Kept at schema v1 deliberately: pre-tombstone clients hit "unknown kind" in
 * `parseSyncLine`, count an error, and skip it — graceful degradation, no break.
 * Lives in the SAME jsonl file as its target so per-file import resolves cleanly
 * (pin → branches/<branch>.jsonl, graduated → graduated.jsonl).
 */
export interface TombstoneRecord {
  schema: number;
  kind: 'tombstone';
  /** content_hash of the pin/graduated fact being removed. */
  content_hash: string;
  target_kind: 'pin' | 'graduated';
  project: string;
  /** Set for pin tombstones; null for graduated. Human-readable diff aid. */
  branch: string | null;
  observation_id: number | null;
  author: string | null;
  tombstoned_at_epoch: number;
}

export type SyncRecord = PinRecord | GraduatedRecord | TombstoneRecord;

// Fixed key orders → deterministic serialization (stable git diffs).
const PIN_KEYS: ReadonlyArray<keyof PinRecord> = [
  'schema',
  'kind',
  'content_hash',
  'project',
  'branch',
  'observation_id',
  'note',
  'title',
  'body',
  'author',
  'tagged_at_epoch',
];

const GRADUATED_KEYS: ReadonlyArray<keyof GraduatedRecord> = [
  'schema',
  'kind',
  'content_hash',
  'project',
  'observation_id',
  'graduated_from_branch',
  'title',
  'body',
  'author',
  'graduated_at_epoch',
];

const TOMBSTONE_KEYS: ReadonlyArray<keyof TombstoneRecord> = [
  'schema',
  'kind',
  'content_hash',
  'target_kind',
  'project',
  'branch',
  'observation_id',
  'author',
  'tombstoned_at_epoch',
];

export interface PinHashInput {
  project: string;
  branch: string;
  observation_id: number | null;
  note: string | null;
  title: string | null;
  body: string | null;
}

export interface GraduatedHashInput {
  project: string;
  observation_id: number;
  graduated_from_branch: string;
  title: string | null;
  body: string | null;
}

const NULL_SENTINEL = '\x00';

function sha256(parts: Array<string | number | null>): string {
  const canonical = parts.map((p) => (p === null ? NULL_SENTINEL : String(p))).join(UNIT);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Hash a pin over its *semantic content only* — excludes author and timestamp
 * so two devs pinning the same fact on the same branch dedupe to one row.
 */
export function pinContentHash(input: PinHashInput): string {
  return sha256([
    'pin',
    input.project,
    input.branch,
    input.observation_id,
    input.note,
    input.title,
    input.body,
  ]);
}

export function graduatedContentHash(input: GraduatedHashInput): string {
  return sha256([
    'graduated',
    input.project,
    input.observation_id,
    input.graduated_from_branch,
    input.title,
    input.body,
  ]);
}

export function serializeSyncRecord(record: SyncRecord): string {
  if (record.kind === 'pin') {
    return JSON.stringify(record, PIN_KEYS as string[]);
  }
  if (record.kind === 'tombstone') {
    return JSON.stringify(record, TOMBSTONE_KEYS as string[]);
  }
  return JSON.stringify(record, GRADUATED_KEYS as string[]);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`sync record: field "${field}" must be a string`);
  return value;
}

function asNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`sync record: field "${field}" must be a string or null`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`sync record: field "${field}" must be a finite number`);
  }
  return value;
}

function asNullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return asNumber(value, field);
}

export function parseSyncLine(line: string): SyncRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new Error(`sync record: invalid JSON line`);
  }
  if (raw === null || typeof raw !== 'object') {
    throw new Error('sync record: line is not an object');
  }
  const obj = raw as Record<string, unknown>;

  const schema = asNumber(obj.schema, 'schema');
  if (schema !== SYNC_SCHEMA_VERSION) {
    throw new Error(
      `sync record: unsupported schema version ${schema} (expected ${SYNC_SCHEMA_VERSION})`,
    );
  }

  const kind = obj.kind;
  if (kind === 'pin') {
    return {
      schema,
      kind: 'pin',
      content_hash: asString(obj.content_hash, 'content_hash'),
      project: asString(obj.project, 'project'),
      branch: asString(obj.branch, 'branch'),
      observation_id: asNullableNumber(obj.observation_id, 'observation_id'),
      note: asNullableString(obj.note, 'note'),
      title: asNullableString(obj.title, 'title'),
      body: asNullableString(obj.body, 'body'),
      author: asNullableString(obj.author, 'author'),
      tagged_at_epoch: asNumber(obj.tagged_at_epoch, 'tagged_at_epoch'),
    };
  }
  if (kind === 'graduated') {
    return {
      schema,
      kind: 'graduated',
      content_hash: asString(obj.content_hash, 'content_hash'),
      project: asString(obj.project, 'project'),
      observation_id: asNumber(obj.observation_id, 'observation_id'),
      graduated_from_branch: asString(obj.graduated_from_branch, 'graduated_from_branch'),
      title: asNullableString(obj.title, 'title'),
      body: asNullableString(obj.body, 'body'),
      author: asNullableString(obj.author, 'author'),
      graduated_at_epoch: asNumber(obj.graduated_at_epoch, 'graduated_at_epoch'),
    };
  }
  if (kind === 'tombstone') {
    const targetKind = obj.target_kind;
    if (targetKind !== 'pin' && targetKind !== 'graduated') {
      throw new Error(`sync record: tombstone target_kind must be "pin" or "graduated"`);
    }
    return {
      schema,
      kind: 'tombstone',
      content_hash: asString(obj.content_hash, 'content_hash'),
      target_kind: targetKind,
      project: asString(obj.project, 'project'),
      branch: asNullableString(obj.branch, 'branch'),
      observation_id: asNullableNumber(obj.observation_id, 'observation_id'),
      author: asNullableString(obj.author, 'author'),
      tombstoned_at_epoch: asNumber(obj.tombstoned_at_epoch, 'tombstoned_at_epoch'),
    };
  }
  throw new Error(`sync record: unknown kind "${String(kind)}"`);
}

import type Database from 'better-sqlite3';

/**
 * claude-mem compatibility surface.
 *
 * tre-mem reads claude-mem's SQLite columns directly, so the real
 * compatibility signal is two-fold:
 *   1. the columns we SELECT must exist  → hard requirement (block if missing)
 *   2. the DB schema version vs. what we tested → soft signal (warn if newer)
 *
 * claude-mem records its applied schema migrations in the `schema_versions`
 * table; the MAX(version) is its effective schema version.
 */

/** Columns the adapter SELECTs from `observations`. Missing any → incompatible. */
export const REQUIRED_OBSERVATION_COLUMNS = [
  'id',
  'project',
  'text',
  'type',
  'title',
  'subtitle',
  'facts',
  'narrative',
  'concepts',
  'files_read',
  'files_modified',
  'prompt_number',
  'created_at',
  'created_at_epoch',
] as const;

/**
 * Highest claude-mem `schema_versions` version this tre-mem release was tested
 * against. A higher installed version is allowed but triggers a non-fatal
 * upgrade hint. Bump this when a new claude-mem schema has been verified.
 */
export const CLAUDE_MEM_TESTED_SCHEMA = 32;

/** MAX(version) from claude-mem's `schema_versions`, or null if absent/empty. */
export function readSchemaVersion(db: Database.Database): number | null {
  try {
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as
      | { v: number | null }
      | undefined;
    return row?.v ?? null;
  } catch {
    // schema_versions table does not exist on this DB.
    return null;
  }
}

/** Required `observations` columns that are absent on this DB (empty = compatible). */
export function missingObservationColumns(db: Database.Database): string[] {
  let present: Set<string>;
  try {
    const rows = db.prepare('PRAGMA table_info(observations)').all() as Array<{ name: string }>;
    present = new Set(rows.map((r) => r.name));
  } catch {
    // observations table missing entirely → report every required column.
    return [...REQUIRED_OBSERVATION_COLUMNS];
  }
  return REQUIRED_OBSERVATION_COLUMNS.filter((c) => !present.has(c));
}

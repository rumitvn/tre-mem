import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

import { log } from '../log/logger.js';
import { CLAUDE_MEM_DB_PATH, DB_BUSY_TIMEOUT_MS } from '../store/paths.js';

import type { ListQuery, Observation, PendingMessage, SessionSummary } from './types.js';
import { toSecondsEpoch } from './types.js';
import {
  CLAUDE_MEM_TESTED_SCHEMA,
  missingObservationColumns,
  readSchemaVersion,
} from './version.js';

const REQUIRED_TABLES = [
  'observations',
  'session_summaries',
  'sdk_sessions',
  'pending_messages',
] as const;

type EpochUnit = 'seconds' | 'milliseconds';

export interface AdapterOptions {
  dbPath?: string;
}

export class ClaudeMemAdapter {
  readonly dbPath: string;
  readonly upstreamEpochUnit: EpochUnit;
  /** claude-mem's effective schema version, or null if unknown. */
  readonly schemaVersion: number | null;
  private readonly db: Database.Database;
  private closed = false;

  constructor(opts: AdapterOptions = {}) {
    this.dbPath = opts.dbPath ?? CLAUDE_MEM_DB_PATH;
    if (!existsSync(this.dbPath)) {
      throw new Error(
        `tre-mem adapter: claude-mem.db not found at ${this.dbPath}. ` +
          `claude-mem may not be installed — run \`tre doctor\` for setup steps.`,
      );
    }
    this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    this.db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    this.db.pragma('query_only = ON');
    this.assertSchema();
    this.assertColumns();
    this.schemaVersion = readSchemaVersion(this.db);
    this.warnIfNewerThanTested();
    this.upstreamEpochUnit = detectEpochUnit(this.db);
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  assertSchema(): void {
    const placeholders = REQUIRED_TABLES.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name IN (${placeholders})`,
      )
      .all(...REQUIRED_TABLES) as Array<{ name: string }>;
    const found = new Set(rows.map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !found.has(t));
    if (missing.length > 0) {
      throw new Error(
        `tre-mem adapter: claude-mem schema sanity check failed at ${this.dbPath}; missing [${missing.join(', ')}]`,
      );
    }
  }

  /**
   * Hard compatibility gate: every column the adapter SELECTs must exist. This
   * catches a breaking claude-mem upgrade precisely (and version-proof), rather
   * than letting it surface later as an opaque SQLite error mid-query.
   */
  assertColumns(): void {
    const missing = missingObservationColumns(this.db);
    if (missing.length > 0) {
      throw new Error(
        `tre-mem adapter: claude-mem schema is incompatible — observations is missing [${missing.join(
          ', ',
        )}]. Upgrade tre-mem: npm i -g tre-mem@latest`,
      );
    }
  }

  /** Soft signal: a newer-than-tested schema works but is worth flagging. */
  private warnIfNewerThanTested(): void {
    if (this.schemaVersion !== null && this.schemaVersion > CLAUDE_MEM_TESTED_SCHEMA) {
      log({
        level: 'warn',
        component: 'store',
        event: 'claude_mem_schema_newer_than_tested',
        fields: { schemaVersion: this.schemaVersion, testedSchema: CLAUDE_MEM_TESTED_SCHEMA },
      });
    }
  }

  listProjects(): string[] {
    return (
      this.db.prepare('SELECT DISTINCT project FROM observations ORDER BY project').all() as Array<{
        project: string;
      }>
    ).map((r) => r.project);
  }

  getObservations(query: ListQuery): Observation[] {
    if (query.projects.length === 0) return [];
    const { sql, params } = this.buildRangeQuery(
      `SELECT id, memory_session_id, project, text, type, title, subtitle,
              facts, narrative, concepts, files_read, files_modified,
              prompt_number, created_at, created_at_epoch
         FROM observations`,
      query,
    );
    const rows = this.db.prepare(sql).all(params) as Observation[];
    return rows.map((r) => ({ ...r, created_at_epoch: toSecondsEpoch(r.created_at_epoch) }));
  }

  getSessionSummaries(query: ListQuery): SessionSummary[] {
    if (query.projects.length === 0) return [];
    const { sql, params } = this.buildRangeQuery(
      `SELECT id, memory_session_id, project, request, investigated, learned,
              completed, next_steps, files_read, files_edited, notes,
              prompt_number, created_at, created_at_epoch
         FROM session_summaries`,
      query,
    );
    const rows = this.db.prepare(sql).all(params) as SessionSummary[];
    return rows.map((r) => ({ ...r, created_at_epoch: toSecondsEpoch(r.created_at_epoch) }));
  }

  getObservationsByIds(ids: ReadonlyArray<number>): Observation[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, memory_session_id, project, text, type, title, subtitle,
                facts, narrative, concepts, files_read, files_modified,
                prompt_number, created_at, created_at_epoch
           FROM observations
          WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Observation[];
    return rows.map((r) => ({ ...r, created_at_epoch: toSecondsEpoch(r.created_at_epoch) }));
  }

  fts5SearchObservations(opts: {
    match: string;
    projects: string[];
    k: number;
  }): Array<{ id: number; rank: number }> {
    if (opts.projects.length === 0) return [];
    const params: Record<string, unknown> = { match: opts.match, k: opts.k };
    const inClause = bindList(params, 'p', opts.projects);
    const sql = `
      SELECT o.id AS id, bm25(observations_fts) AS rank
        FROM observations_fts
        JOIN observations o ON o.id = observations_fts.rowid
       WHERE observations_fts MATCH @match
         AND o.project IN (${inClause})
       ORDER BY rank ASC
       LIMIT @k
    `;
    return this.db.prepare(sql).all(params) as Array<{ id: number; rank: number }>;
  }

  getPendingMessages(query: ListQuery): PendingMessage[] {
    if (query.projects.length === 0) return [];
    const params: Record<string, unknown> = {};
    const where: string[] = [`s.project IN (${bindList(params, 'proj', query.projects)})`];
    if (query.sinceEpoch !== undefined) {
      where.push('p.created_at_epoch >= @sinceEpoch');
      params.sinceEpoch = this.toUpstreamEpoch(query.sinceEpoch);
    }
    if (query.untilEpoch !== undefined) {
      where.push('p.created_at_epoch <= @untilEpoch');
      params.untilEpoch = this.toUpstreamEpoch(query.untilEpoch);
    }
    let sql = `
      SELECT p.id, p.session_db_id, p.content_session_id, p.message_type,
             p.tool_name, p.cwd, p.prompt_number, p.status, p.created_at_epoch,
             s.project AS project
        FROM pending_messages p
        JOIN sdk_sessions s ON s.id = p.session_db_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.created_at_epoch DESC
    `;
    if (query.limit !== undefined) {
      sql += ' LIMIT @limit';
      params.limit = query.limit;
    }
    const rows = this.db.prepare(sql).all(params) as PendingMessage[];
    return rows.map((r) => ({ ...r, created_at_epoch: toSecondsEpoch(r.created_at_epoch) }));
  }

  private buildRangeQuery(
    selectClause: string,
    query: ListQuery,
  ): { sql: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = {};
    const where: string[] = [`project IN (${bindList(params, 'proj', query.projects)})`];
    if (query.sinceEpoch !== undefined) {
      where.push('created_at_epoch >= @sinceEpoch');
      params.sinceEpoch = this.toUpstreamEpoch(query.sinceEpoch);
    }
    if (query.untilEpoch !== undefined) {
      where.push('created_at_epoch <= @untilEpoch');
      params.untilEpoch = this.toUpstreamEpoch(query.untilEpoch);
    }
    let sql = `${selectClause}\n       WHERE ${where.join(' AND ')}\n       ORDER BY created_at_epoch DESC`;
    if (query.limit !== undefined) {
      sql += '\n       LIMIT @limit';
      params.limit = query.limit;
    }
    return { sql, params };
  }

  private toUpstreamEpoch(secondsEpoch: number): number {
    return this.upstreamEpochUnit === 'milliseconds' ? secondsEpoch * 1000 : secondsEpoch;
  }
}

/**
 * Bind a list of values as named params (`@prefix0`, `@prefix1`, ...) and return
 * the comma-joined placeholder string for an `IN (...)` clause. Mutates `params`.
 */
function bindList(params: Record<string, unknown>, prefix: string, values: string[]): string {
  return values
    .map((v, i) => {
      const key = `${prefix}${i}`;
      params[key] = v;
      return `@${key}`;
    })
    .join(', ');
}

function detectEpochUnit(db: Database.Database): EpochUnit {
  const row = db
    .prepare('SELECT created_at_epoch AS e FROM observations ORDER BY id DESC LIMIT 1')
    .get() as { e: number } | undefined;
  if (row === undefined) return 'seconds';
  return row.e >= 10_000_000_000 ? 'milliseconds' : 'seconds';
}

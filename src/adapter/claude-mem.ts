import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

import { CLAUDE_MEM_DB_PATH } from '../store/paths.js';

import type {
  ListQuery,
  Observation,
  PendingMessage,
  SessionSummary,
} from './types.js';

const REQUIRED_TABLES = [
  'observations',
  'session_summaries',
  'sdk_sessions',
  'pending_messages',
] as const;

export interface AdapterOptions {
  dbPath?: string;
}

export class ClaudeMemAdapter {
  readonly dbPath: string;
  private readonly db: Database.Database;
  private closed = false;

  constructor(opts: AdapterOptions = {}) {
    this.dbPath = opts.dbPath ?? CLAUDE_MEM_DB_PATH;
    if (!existsSync(this.dbPath)) {
      throw new Error(`tre-mem adapter: claude-mem.db not found at ${this.dbPath}`);
    }
    this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    this.db.pragma('query_only = ON');
    this.assertSchema();
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

  listProjects(): string[] {
    return (
      this.db
        .prepare('SELECT DISTINCT project FROM observations ORDER BY project')
        .all() as Array<{ project: string }>
    ).map((r) => r.project);
  }

  getObservations(query: ListQuery): Observation[] {
    const { sql, params } = buildRangeQuery(
      `SELECT id, memory_session_id, project, text, type, title, subtitle,
              facts, narrative, concepts, files_read, files_modified,
              prompt_number, created_at, created_at_epoch
         FROM observations`,
      query,
    );
    return this.db.prepare(sql).all(params) as Observation[];
  }

  getSessionSummaries(query: ListQuery): SessionSummary[] {
    const { sql, params } = buildRangeQuery(
      `SELECT id, memory_session_id, project, request, investigated, learned,
              completed, next_steps, files_read, files_edited, notes,
              prompt_number, created_at, created_at_epoch
         FROM session_summaries`,
      query,
    );
    return this.db.prepare(sql).all(params) as SessionSummary[];
  }

  getPendingMessages(query: ListQuery): PendingMessage[] {
    const where: string[] = ['s.project = @project'];
    const params: Record<string, unknown> = { project: query.project };
    if (query.sinceEpoch !== undefined) {
      where.push('p.created_at_epoch >= @sinceEpoch');
      params.sinceEpoch = query.sinceEpoch;
    }
    if (query.untilEpoch !== undefined) {
      where.push('p.created_at_epoch <= @untilEpoch');
      params.untilEpoch = query.untilEpoch;
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
    return this.db.prepare(sql).all(params) as PendingMessage[];
  }
}

function buildRangeQuery(
  selectClause: string,
  query: ListQuery,
): { sql: string; params: Record<string, unknown> } {
  const where: string[] = ['project = @project'];
  const params: Record<string, unknown> = { project: query.project };
  if (query.sinceEpoch !== undefined) {
    where.push('created_at_epoch >= @sinceEpoch');
    params.sinceEpoch = query.sinceEpoch;
  }
  if (query.untilEpoch !== undefined) {
    where.push('created_at_epoch <= @untilEpoch');
    params.untilEpoch = query.untilEpoch;
  }
  let sql = `${selectClause}\n       WHERE ${where.join(' AND ')}\n       ORDER BY created_at_epoch DESC`;
  if (query.limit !== undefined) {
    sql += '\n       LIMIT @limit';
    params.limit = query.limit;
  }
  return { sql, params };
}

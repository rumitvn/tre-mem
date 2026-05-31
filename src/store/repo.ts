import Database from 'better-sqlite3';

import { TRE_MEM_DB_PATH } from './paths.js';

export interface BranchState {
  cwd: string;
  project: string;
  current_branch: string;
  updated_at_epoch: number;
}

export interface RepoOptions {
  dbPath?: string;
}

export class TreMemRepo {
  readonly dbPath: string;
  private readonly db: Database.Database;
  private closed = false;

  constructor(opts: RepoOptions = {}) {
    this.dbPath = opts.dbPath ?? TRE_MEM_DB_PATH;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  upsertBranchState(state: BranchState): void {
    this.db
      .prepare(
        `INSERT INTO branch_state (cwd, project, current_branch, updated_at_epoch)
         VALUES (@cwd, @project, @current_branch, @updated_at_epoch)
         ON CONFLICT(cwd) DO UPDATE SET
           project          = excluded.project,
           current_branch   = excluded.current_branch,
           updated_at_epoch = excluded.updated_at_epoch`,
      )
      .run(state);
  }

  getBranchState(cwd: string): BranchState | null {
    const row = this.db
      .prepare(
        `SELECT cwd, project, current_branch, updated_at_epoch
           FROM branch_state
          WHERE cwd = ?`,
      )
      .get(cwd) as BranchState | undefined;
    return row ?? null;
  }

  listBranchStates(): BranchState[] {
    return this.db
      .prepare(
        `SELECT cwd, project, current_branch, updated_at_epoch
           FROM branch_state
          ORDER BY project, cwd`,
      )
      .all() as BranchState[];
  }
}

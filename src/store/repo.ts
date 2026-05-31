import Database from 'better-sqlite3';

import { TRE_MEM_DB_PATH } from './paths.js';

export interface BranchState {
  cwd: string;
  project: string;
  current_branch: string;
  updated_at_epoch: number;
}

export type BranchTagSource = 'live' | 'reflog-backfill' | 'manual';

export interface BranchTag {
  observation_id: number;
  project: string;
  branch: string;
  tagged_at_epoch: number;
  source: BranchTagSource;
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

  upsertBranchTag(tag: BranchTag): void {
    this.db
      .prepare(
        `INSERT INTO branch_tag (observation_id, project, branch, tagged_at_epoch, source)
         VALUES (@observation_id, @project, @branch, @tagged_at_epoch, @source)
         ON CONFLICT(observation_id) DO UPDATE SET
           project          = excluded.project,
           branch           = excluded.branch,
           tagged_at_epoch  = excluded.tagged_at_epoch,
           source           = excluded.source`,
      )
      .run(tag);
  }

  hasBranchTag(observationId: number): boolean {
    return (
      this.db
        .prepare('SELECT 1 AS x FROM branch_tag WHERE observation_id = ?')
        .get(observationId) !== undefined
    );
  }

  getBranchTag(observationId: number): BranchTag | null {
    const row = this.db
      .prepare(
        `SELECT observation_id, project, branch, tagged_at_epoch, source
           FROM branch_tag
          WHERE observation_id = ?`,
      )
      .get(observationId) as BranchTag | undefined;
    return row ?? null;
  }

  countBranchTags(project: string, branch?: string): number {
    if (branch !== undefined) {
      const row = this.db
        .prepare(
          'SELECT COUNT(*) AS n FROM branch_tag WHERE project = ? AND branch = ?',
        )
        .get(project, branch) as { n: number };
      return row.n;
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM branch_tag WHERE project = ?')
      .get(project) as { n: number };
    return row.n;
  }

  listBranchesForProject(project: string): Array<{ branch: string; count: number }> {
    return this.db
      .prepare(
        `SELECT branch, COUNT(*) AS count
           FROM branch_tag
          WHERE project = ?
          GROUP BY branch
          ORDER BY count DESC, branch ASC`,
      )
      .all(project) as Array<{ branch: string; count: number }>;
  }
}

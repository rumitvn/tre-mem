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

export interface BranchPin {
  id: number;
  project: string;
  branch: string;
  observation_id: number | null;
  note: string | null;
  created_at_epoch: number;
}

export interface BranchPinInsert {
  project: string;
  branch: string;
  observation_id?: number | null;
  note?: string | null;
  created_at_epoch: number;
}

export interface Graduated {
  id: number;
  project: string;
  observation_id: number;
  graduated_from_branch: string;
  graduated_at_epoch: number;
}

export interface GraduatedInsert {
  project: string;
  observation_id: number;
  graduated_from_branch: string;
  graduated_at_epoch: number;
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
        .prepare('SELECT COUNT(*) AS n FROM branch_tag WHERE project = ? AND branch = ?')
        .get(project, branch) as { n: number };
      return row.n;
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM branch_tag WHERE project = ?')
      .get(project) as { n: number };
    return row.n;
  }

  listBranchTagsForBranch(project: string, branch: string, limit?: number): BranchTag[] {
    let sql = `SELECT observation_id, project, branch, tagged_at_epoch, source
                 FROM branch_tag
                WHERE project = ? AND branch = ?
                ORDER BY tagged_at_epoch DESC`;
    const params: unknown[] = [project, branch];
    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    return this.db.prepare(sql).all(...params) as BranchTag[];
  }

  addPin(pin: BranchPinInsert): BranchPin {
    const info = this.db
      .prepare(
        `INSERT INTO branch_pin (project, branch, observation_id, note, created_at_epoch)
         VALUES (@project, @branch, @observation_id, @note, @created_at_epoch)`,
      )
      .run({
        project: pin.project,
        branch: pin.branch,
        observation_id: pin.observation_id ?? null,
        note: pin.note ?? null,
        created_at_epoch: pin.created_at_epoch,
      });
    return this.getPinById(Number(info.lastInsertRowid)) as BranchPin;
  }

  getPinById(id: number): BranchPin | null {
    const row = this.db
      .prepare(
        `SELECT id, project, branch, observation_id, note, created_at_epoch
           FROM branch_pin
          WHERE id = ?`,
      )
      .get(id) as BranchPin | undefined;
    return row ?? null;
  }

  listPinsForBranch(project: string, branch: string): BranchPin[] {
    return this.db
      .prepare(
        `SELECT id, project, branch, observation_id, note, created_at_epoch
           FROM branch_pin
          WHERE project = ? AND branch = ?
          ORDER BY created_at_epoch DESC, id DESC`,
      )
      .all(project, branch) as BranchPin[];
  }

  listPinsForProject(project: string): BranchPin[] {
    return this.db
      .prepare(
        `SELECT id, project, branch, observation_id, note, created_at_epoch
           FROM branch_pin
          WHERE project = ?
          ORDER BY created_at_epoch DESC, id DESC`,
      )
      .all(project) as BranchPin[];
  }

  graduateFact(input: GraduatedInsert): Graduated {
    this.db
      .prepare(
        `INSERT INTO graduated (project, observation_id, graduated_from_branch, graduated_at_epoch)
         VALUES (@project, @observation_id, @graduated_from_branch, @graduated_at_epoch)
         ON CONFLICT(project, observation_id) DO UPDATE SET
           graduated_from_branch = excluded.graduated_from_branch,
           graduated_at_epoch    = excluded.graduated_at_epoch`,
      )
      .run(input);
    return this.getGraduated(input.project, input.observation_id) as Graduated;
  }

  getGraduated(project: string, observationId: number): Graduated | null {
    const row = this.db
      .prepare(
        `SELECT id, project, observation_id, graduated_from_branch, graduated_at_epoch
           FROM graduated
          WHERE project = ? AND observation_id = ?`,
      )
      .get(project, observationId) as Graduated | undefined;
    return row ?? null;
  }

  listGraduated(project: string): Graduated[] {
    return this.db
      .prepare(
        `SELECT id, project, observation_id, graduated_from_branch, graduated_at_epoch
           FROM graduated
          WHERE project = ?
          ORDER BY graduated_at_epoch DESC, id DESC`,
      )
      .all(project) as Graduated[];
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

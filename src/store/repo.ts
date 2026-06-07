import Database from 'better-sqlite3';

import { TRE_MEM_DB_PATH } from './paths.js';

export interface BranchState {
  cwd: string;
  project: string;
  current_branch: string;
  updated_at_epoch: number;
  /** Canonical git remote slug (host/org/repo), null when there's no origin. */
  remote?: string | null;
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
  content_hash: string | null;
  shared_at_epoch: number | null;
  title: string | null;
  body: string | null;
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
  content_hash: string | null;
  shared_at_epoch: number | null;
  title: string | null;
  body: string | null;
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
        `INSERT INTO branch_state (cwd, project, current_branch, updated_at_epoch, remote)
         VALUES (@cwd, @project, @current_branch, @updated_at_epoch, @remote)
         ON CONFLICT(cwd) DO UPDATE SET
           project          = excluded.project,
           current_branch   = excluded.current_branch,
           updated_at_epoch = excluded.updated_at_epoch,
           remote           = excluded.remote`,
      )
      .run({ ...state, remote: state.remote ?? null });
  }

  getBranchState(cwd: string): BranchState | null {
    const row = this.db
      .prepare(
        `SELECT cwd, project, current_branch, updated_at_epoch, remote
           FROM branch_state
          WHERE cwd = ?`,
      )
      .get(cwd) as BranchState | undefined;
    return row ?? null;
  }

  listBranchStates(): BranchState[] {
    return this.db
      .prepare(
        `SELECT cwd, project, current_branch, updated_at_epoch, remote
           FROM branch_state
          ORDER BY project, cwd`,
      )
      .all() as BranchState[];
  }

  /** Update the remote slug for a known cwd. No-op if the row doesn't exist yet
   *  (session-start / the git watcher create it). Lets any tre invocation register
   *  the current clone's remote so cross-clone siblings can find each other. */
  setRemoteForCwd(cwd: string, remote: string | null): void {
    this.db.prepare(`UPDATE branch_state SET remote = ? WHERE cwd = ?`).run(remote, cwd);
  }

  /** The remote slug recorded for any clone of `project`, or null if none known. */
  remoteForProject(project: string): string | null {
    const row = this.db
      .prepare(`SELECT remote FROM branch_state WHERE project = ? AND remote IS NOT NULL LIMIT 1`)
      .get(project) as { remote: string } | undefined;
    return row?.remote ?? null;
  }

  /**
   * The set of project labels (directory basenames) that share a git remote with
   * `project`, always including `project` itself. This is the cross-clone read
   * key: when several local clones of one repo report the same `remote`, their
   * memory is unioned. Returns `[project]` when `remote` is null/empty (no origin
   * or cross-clone disabled) — i.e. single-project behavior.
   */
  projectAliases(project: string, remote: string | null | undefined): string[] {
    if (remote === null || remote === undefined || remote === '') return [project];
    const rows = this.db
      .prepare(`SELECT DISTINCT project FROM branch_state WHERE remote = ?`)
      .all(remote) as Array<{ project: string }>;
    const set = new Set(rows.map((r) => r.project));
    set.add(project);
    return [...set].sort();
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
    return this.countBranchTagsAcross([project], branch);
  }

  countBranchTagsAcross(projects: string[], branch?: string): number {
    if (projects.length === 0) return 0;
    const ph = placeholders(projects.length);
    if (branch !== undefined) {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM branch_tag WHERE project IN (${ph}) AND branch = ?`)
        .get(...projects, branch) as { n: number };
      return row.n;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM branch_tag WHERE project IN (${ph})`)
      .get(...projects) as { n: number };
    return row.n;
  }

  listBranchTagsForBranch(project: string, branch: string, limit?: number): BranchTag[] {
    return this.listBranchTagsForBranchAcross([project], branch, limit);
  }

  listBranchTagsForBranchAcross(projects: string[], branch: string, limit?: number): BranchTag[] {
    if (projects.length === 0) return [];
    let sql = `SELECT observation_id, project, branch, tagged_at_epoch, source
                 FROM branch_tag
                WHERE project IN (${placeholders(projects.length)}) AND branch = ?
                ORDER BY tagged_at_epoch DESC`;
    const params: unknown[] = [...projects, branch];
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
        `SELECT id, project, branch, observation_id, note, created_at_epoch, content_hash, shared_at_epoch, title, body
           FROM branch_pin
          WHERE id = ?`,
      )
      .get(id) as BranchPin | undefined;
    return row ?? null;
  }

  listPinsForBranch(project: string, branch: string): BranchPin[] {
    return this.listPinsForBranchAcross([project], branch);
  }

  listPinsForBranchAcross(projects: string[], branch: string): BranchPin[] {
    if (projects.length === 0) return [];
    return this.db
      .prepare(
        `SELECT id, project, branch, observation_id, note, created_at_epoch, content_hash, shared_at_epoch, title, body
           FROM branch_pin
          WHERE project IN (${placeholders(projects.length)}) AND branch = ?
          ORDER BY created_at_epoch DESC, id DESC`,
      )
      .all(...projects, branch) as BranchPin[];
  }

  listPinsForProject(project: string): BranchPin[] {
    return this.listPinsForProjectAcross([project]);
  }

  listPinsForProjectAcross(projects: string[]): BranchPin[] {
    if (projects.length === 0) return [];
    return this.db
      .prepare(
        `SELECT id, project, branch, observation_id, note, created_at_epoch, content_hash, shared_at_epoch, title, body
           FROM branch_pin
          WHERE project IN (${placeholders(projects.length)})
          ORDER BY created_at_epoch DESC, id DESC`,
      )
      .all(...projects) as BranchPin[];
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
        `SELECT id, project, observation_id, graduated_from_branch, graduated_at_epoch, content_hash, shared_at_epoch, title, body
           FROM graduated
          WHERE project = ? AND observation_id = ?`,
      )
      .get(project, observationId) as Graduated | undefined;
    return row ?? null;
  }

  listGraduated(project: string): Graduated[] {
    return this.listGraduatedAcross([project]);
  }

  listGraduatedAcross(projects: string[]): Graduated[] {
    if (projects.length === 0) return [];
    return this.db
      .prepare(
        `SELECT id, project, observation_id, graduated_from_branch, graduated_at_epoch, content_hash, shared_at_epoch, title, body
           FROM graduated
          WHERE project IN (${placeholders(projects.length)})
          ORDER BY graduated_at_epoch DESC, id DESC`,
      )
      .all(...projects) as Graduated[];
  }

  listBranchesForProject(project: string): Array<{ branch: string; count: number }> {
    return this.listBranchesForProjectAcross([project]);
  }

  listBranchesForProjectAcross(projects: string[]): Array<{ branch: string; count: number }> {
    if (projects.length === 0) return [];
    return this.db
      .prepare(
        `SELECT branch, COUNT(*) AS count
           FROM branch_tag
          WHERE project IN (${placeholders(projects.length)})
          GROUP BY branch
          ORDER BY count DESC, branch ASC`,
      )
      .all(...projects) as Array<{ branch: string; count: number }>;
  }

  // --- Phase 2 sync (schema v2) ---

  listPinBranches(project: string): string[] {
    return this.listPinBranchesAcross([project]);
  }

  listPinBranchesAcross(projects: string[]): string[] {
    if (projects.length === 0) return [];
    return (
      this.db
        .prepare(
          `SELECT DISTINCT branch FROM branch_pin WHERE project IN (${placeholders(projects.length)}) ORDER BY branch ASC`,
        )
        .all(...projects) as Array<{ branch: string }>
    ).map((r) => r.branch);
  }

  markPinShared(id: number, contentHash: string, sharedAtEpoch: number): void {
    this.db
      .prepare(`UPDATE branch_pin SET content_hash = ?, shared_at_epoch = ? WHERE id = ?`)
      .run(contentHash, sharedAtEpoch, id);
  }

  markGraduatedShared(id: number, contentHash: string, sharedAtEpoch: number): void {
    this.db
      .prepare(`UPDATE graduated SET content_hash = ?, shared_at_epoch = ? WHERE id = ?`)
      .run(contentHash, sharedAtEpoch, id);
  }

  // --- Removal (forget / tombstone) ---

  deletePinById(id: number): boolean {
    return this.db.prepare(`DELETE FROM branch_pin WHERE id = ?`).run(id).changes > 0;
  }

  /** Remove every pin matching (project, branch, observation_id). Returns rows removed. */
  deletePinsByObservation(project: string, branch: string, observationId: number): number {
    return this.db
      .prepare(`DELETE FROM branch_pin WHERE project = ? AND branch = ? AND observation_id = ?`)
      .run(project, branch, observationId).changes;
  }

  /** Used by import to honor a teammate's pin tombstone. Returns rows removed. */
  deletePinsByContentHash(contentHash: string): number {
    return this.db.prepare(`DELETE FROM branch_pin WHERE content_hash = ?`).run(contentHash)
      .changes;
  }

  deleteGraduatedByObservation(project: string, observationId: number): boolean {
    return (
      this.db
        .prepare(`DELETE FROM graduated WHERE project = ? AND observation_id = ?`)
        .run(project, observationId).changes > 0
    );
  }

  /** Used by import to honor a teammate's graduated tombstone. Returns rows removed. */
  deleteGraduatedByContentHash(contentHash: string): number {
    return this.db.prepare(`DELETE FROM graduated WHERE content_hash = ?`).run(contentHash).changes;
  }

  countUnsharedPins(project: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM branch_pin WHERE project = ? AND shared_at_epoch IS NULL`)
      .get(project) as { n: number };
    return row.n;
  }

  getImportState(
    filePath: string,
  ): { file_path: string; last_sha: string; imported_at_epoch: number } | null {
    const row = this.db
      .prepare(
        `SELECT file_path, last_sha, imported_at_epoch FROM import_state WHERE file_path = ?`,
      )
      .get(filePath) as
      | { file_path: string; last_sha: string; imported_at_epoch: number }
      | undefined;
    return row ?? null;
  }

  upsertImportState(filePath: string, lastSha: string, importedAtEpoch: number): void {
    this.db
      .prepare(
        `INSERT INTO import_state (file_path, last_sha, imported_at_epoch)
         VALUES (?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           last_sha          = excluded.last_sha,
           imported_at_epoch = excluded.imported_at_epoch`,
      )
      .run(filePath, lastSha, importedAtEpoch);
  }

  /**
   * Upsert a pin received from a teammate's export, keyed by content_hash so
   * re-importing the same row is a no-op. Returns true if a new row was inserted.
   */
  importPin(
    pin: BranchPinInsert & {
      content_hash: string;
      shared_at_epoch: number;
      title?: string | null;
      body?: string | null;
    },
  ): boolean {
    const existing = this.db
      .prepare(`SELECT id FROM branch_pin WHERE content_hash = ?`)
      .get(pin.content_hash) as { id: number } | undefined;
    if (existing !== undefined) return false;
    this.db
      .prepare(
        `INSERT INTO branch_pin (project, branch, observation_id, note, created_at_epoch, content_hash, shared_at_epoch, title, body)
         VALUES (@project, @branch, @observation_id, @note, @created_at_epoch, @content_hash, @shared_at_epoch, @title, @body)`,
      )
      .run({
        project: pin.project,
        branch: pin.branch,
        observation_id: pin.observation_id ?? null,
        note: pin.note ?? null,
        created_at_epoch: pin.created_at_epoch,
        content_hash: pin.content_hash,
        shared_at_epoch: pin.shared_at_epoch,
        title: pin.title ?? null,
        body: pin.body ?? null,
      });
    return true;
  }

  /**
   * Upsert a graduated fact received from a teammate, keyed by content_hash.
   * Returns true if a new row was inserted.
   */
  importGraduated(
    grad: GraduatedInsert & {
      content_hash: string;
      shared_at_epoch: number;
      title?: string | null;
      body?: string | null;
    },
  ): boolean {
    const existing = this.db
      .prepare(`SELECT id FROM graduated WHERE content_hash = ?`)
      .get(grad.content_hash) as { id: number } | undefined;
    if (existing !== undefined) return false;
    this.db
      .prepare(
        `INSERT INTO graduated (project, observation_id, graduated_from_branch, graduated_at_epoch, content_hash, shared_at_epoch, title, body)
         VALUES (@project, @observation_id, @graduated_from_branch, @graduated_at_epoch, @content_hash, @shared_at_epoch, @title, @body)
         ON CONFLICT(project, observation_id) DO UPDATE SET
           content_hash    = excluded.content_hash,
           shared_at_epoch = excluded.shared_at_epoch,
           title           = excluded.title,
           body            = excluded.body`,
      )
      .run({
        project: grad.project,
        observation_id: grad.observation_id,
        graduated_from_branch: grad.graduated_from_branch,
        graduated_at_epoch: grad.graduated_at_epoch,
        content_hash: grad.content_hash,
        shared_at_epoch: grad.shared_at_epoch,
        title: grad.title ?? null,
        body: grad.body ?? null,
      });
    return true;
  }
}

/** Comma-separated `?` placeholders for an `IN (...)` clause of length `n`. */
function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

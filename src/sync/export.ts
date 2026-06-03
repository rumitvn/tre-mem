import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { TreMemRepo } from '../store/repo.js';

import {
  SYNC_SCHEMA_VERSION,
  graduatedContentHash,
  parseSyncLine,
  pinContentHash,
  serializeSyncRecord,
  type GraduatedRecord,
  type PinRecord,
} from './format.js';
import { branchFilePath, graduatedFilePath } from './layout.js';

export interface ObservationSnapshot {
  title: string | null;
  body: string | null;
}

/** Supplies title/body snapshots for observation ids (injected for testability). */
export interface SnapshotProvider {
  getSnapshots(ids: ReadonlyArray<number>): Map<number, ObservationSnapshot>;
}

export interface ExportOptions {
  repo: TreMemRepo;
  snapshots: SnapshotProvider;
  project: string;
  dir: string;
  /** Branches whose pins to export. The caller resolves --all / --branch / current. */
  branches: ReadonlyArray<string>;
  now: number;
  author?: string | null;
  dryRun?: boolean;
}

export interface ExportFileResult {
  file: string;
  total: number;
  added: number;
}

export interface ExportResult {
  dir: string;
  branches: Array<ExportFileResult & { branch: string }>;
  graduated: ExportFileResult;
  dryRun: boolean;
}

interface ExistingFile {
  lines: string[];
  hashes: Set<string>;
}

function readExisting(filePath: string): ExistingFile {
  if (!existsSync(filePath)) return { lines: [], hashes: new Set() };
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  const hashes = new Set<string>();
  for (const line of lines) {
    // Unparseable lines (e.g. a newer schema from a teammate) are preserved
    // verbatim and simply cannot be deduped against — append-only stays safe.
    try {
      hashes.add(parseSyncLine(line).content_hash);
    } catch {
      /* passthrough */
    }
  }
  return { lines, hashes };
}

function appendNew(
  filePath: string,
  existing: ExistingFile,
  incoming: ReadonlyArray<{ line: string; hash: string }>,
  dryRun: boolean,
): ExportFileResult {
  const newLines: string[] = [];
  for (const { line, hash } of incoming) {
    if (!existing.hashes.has(hash)) newLines.push(line);
  }
  if (!dryRun && newLines.length > 0) {
    mkdirSync(dirname(filePath), { recursive: true });
    const merged = [...existing.lines, ...newLines];
    writeFileSync(filePath, merged.join('\n') + '\n', 'utf8');
  }
  return { file: filePath, total: existing.lines.length + newLines.length, added: newLines.length };
}

export function exportSync(opts: ExportOptions): ExportResult {
  const { repo, snapshots, project, dir, now, dryRun = false } = opts;
  const author = opts.author ?? null;

  const branchResults: Array<ExportFileResult & { branch: string }> = [];

  for (const branch of opts.branches) {
    const pins = repo.listPinsForBranch(project, branch);
    const ids = pins.map((p) => p.observation_id).filter((id): id is number => id !== null);
    const snap = snapshots.getSnapshots(ids);

    const records: PinRecord[] = [];
    const marks: Array<{ id: number; hash: string }> = [];
    for (const pin of pins) {
      const s = pin.observation_id !== null ? snap.get(pin.observation_id) : undefined;
      const title = s?.title ?? null;
      const body = s?.body ?? null;
      const content_hash = pinContentHash({
        project,
        branch,
        observation_id: pin.observation_id,
        note: pin.note,
        title,
        body,
      });
      records.push({
        schema: SYNC_SCHEMA_VERSION,
        kind: 'pin',
        content_hash,
        project,
        branch,
        observation_id: pin.observation_id,
        note: pin.note,
        title,
        body,
        author,
        tagged_at_epoch: pin.created_at_epoch,
      });
      marks.push({ id: pin.id, hash: content_hash });
    }

    const filePath = branchFilePath(dir, branch);
    const existing = readExisting(filePath);
    const result = appendNew(
      filePath,
      existing,
      records.map((r) => ({ line: serializeSyncRecord(r), hash: r.content_hash })),
      dryRun,
    );

    if (!dryRun) {
      for (const m of marks) repo.markPinShared(m.id, m.hash, now);
    }
    branchResults.push({ branch, ...result });
  }

  // Graduated facts are repo-wide, not branch-scoped.
  const grads = repo.listGraduated(project);
  const gradIds = grads.map((g) => g.observation_id);
  const gradSnap = snapshots.getSnapshots(gradIds);
  const gradRecords: GraduatedRecord[] = [];
  const gradMarks: Array<{ id: number; hash: string }> = [];
  for (const g of grads) {
    const s = gradSnap.get(g.observation_id);
    const title = s?.title ?? null;
    const body = s?.body ?? null;
    const content_hash = graduatedContentHash({
      project,
      observation_id: g.observation_id,
      graduated_from_branch: g.graduated_from_branch,
      title,
      body,
    });
    gradRecords.push({
      schema: SYNC_SCHEMA_VERSION,
      kind: 'graduated',
      content_hash,
      project,
      observation_id: g.observation_id,
      graduated_from_branch: g.graduated_from_branch,
      title,
      body,
      author,
      graduated_at_epoch: g.graduated_at_epoch,
    });
    gradMarks.push({ id: g.id, hash: content_hash });
  }

  const gradFile = graduatedFilePath(dir);
  const gradExisting = readExisting(gradFile);
  const gradResult = appendNew(
    gradFile,
    gradExisting,
    gradRecords.map((r) => ({ line: serializeSyncRecord(r), hash: r.content_hash })),
    dryRun,
  );
  if (!dryRun) {
    for (const m of gradMarks) repo.markGraduatedShared(m.id, m.hash, now);
  }

  return { dir, branches: branchResults, graduated: gradResult, dryRun };
}

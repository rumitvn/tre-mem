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
import { RedactionError, redactText, scanForSecrets, type SecretMatch } from './redact.js';
import { type ShareignoreMatcher } from './shareignore.js';

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
  /** Records whose text matches are excluded from export. */
  shareignore?: ShareignoreMatcher;
  /** When true, replace detected secrets with placeholders instead of aborting. */
  redact?: boolean;
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
  ignored: number;
  redacted: number;
  dryRun: boolean;
}

interface PinItem {
  record: PinRecord;
  pinId: number;
}
interface GradItem {
  record: GraduatedRecord;
  gradId: number;
}

function combinedText(note: string | null, title: string | null, body: string | null): string {
  return [note, title, body].filter((v): v is string => v !== null && v !== '').join(' ');
}

function buildPinItems(
  pins: ReturnType<TreMemRepo['listPinsForBranch']>,
  snapshots: SnapshotProvider,
  project: string,
  branch: string,
  author: string | null,
): PinItem[] {
  const ids = pins.map((p) => p.observation_id).filter((id): id is number => id !== null);
  const snap = snapshots.getSnapshots(ids);
  return pins.map((pin) => {
    const s = pin.observation_id !== null ? snap.get(pin.observation_id) : undefined;
    const title = s?.title ?? null;
    const body = s?.body ?? null;
    return {
      pinId: pin.id,
      record: {
        schema: SYNC_SCHEMA_VERSION,
        kind: 'pin',
        content_hash: pinContentHash({
          project,
          branch,
          observation_id: pin.observation_id,
          note: pin.note,
          title,
          body,
        }),
        project,
        branch,
        observation_id: pin.observation_id,
        note: pin.note,
        title,
        body,
        author,
        tagged_at_epoch: pin.created_at_epoch,
      },
    };
  });
}

function buildGradItems(
  grads: ReturnType<TreMemRepo['listGraduated']>,
  snapshots: SnapshotProvider,
  project: string,
  author: string | null,
): GradItem[] {
  const snap = snapshots.getSnapshots(grads.map((g) => g.observation_id));
  return grads.map((g) => {
    const s = snap.get(g.observation_id);
    const title = s?.title ?? null;
    const body = s?.body ?? null;
    return {
      gradId: g.id,
      record: {
        schema: SYNC_SCHEMA_VERSION,
        kind: 'graduated',
        content_hash: graduatedContentHash({
          project,
          observation_id: g.observation_id,
          graduated_from_branch: g.graduated_from_branch,
          title,
          body,
        }),
        project,
        observation_id: g.observation_id,
        graduated_from_branch: g.graduated_from_branch,
        title,
        body,
        author,
        graduated_at_epoch: g.graduated_at_epoch,
      },
    };
  });
}

function redactPin(record: PinRecord): { record: PinRecord; count: number } {
  const note = record.note !== null ? redactText(record.note) : { redacted: null, count: 0 };
  const title = record.title !== null ? redactText(record.title) : { redacted: null, count: 0 };
  const body = record.body !== null ? redactText(record.body) : { redacted: null, count: 0 };
  const count = note.count + title.count + body.count;
  if (count === 0) return { record, count };
  const next: PinRecord = {
    ...record,
    note: note.redacted,
    title: title.redacted,
    body: body.redacted,
  };
  next.content_hash = pinContentHash({
    project: next.project,
    branch: next.branch,
    observation_id: next.observation_id,
    note: next.note,
    title: next.title,
    body: next.body,
  });
  return { record: next, count };
}

function redactGrad(record: GraduatedRecord): { record: GraduatedRecord; count: number } {
  const title = record.title !== null ? redactText(record.title) : { redacted: null, count: 0 };
  const body = record.body !== null ? redactText(record.body) : { redacted: null, count: 0 };
  const count = title.count + body.count;
  if (count === 0) return { record, count };
  const next: GraduatedRecord = { ...record, title: title.redacted, body: body.redacted };
  next.content_hash = graduatedContentHash({
    project: next.project,
    observation_id: next.observation_id,
    graduated_from_branch: next.graduated_from_branch,
    title: next.title,
    body: next.body,
  });
  return { record: next, count };
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
  incoming: ReadonlyArray<{ line: string; hash: string }>,
  dryRun: boolean,
): ExportFileResult {
  const existing = readExisting(filePath);
  const newLines: string[] = [];
  for (const { line, hash } of incoming) {
    if (!existing.hashes.has(hash)) newLines.push(line);
  }
  if (!dryRun && newLines.length > 0) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, [...existing.lines, ...newLines].join('\n') + '\n', 'utf8');
  }
  return { file: filePath, total: existing.lines.length + newLines.length, added: newLines.length };
}

export function exportSync(opts: ExportOptions): ExportResult {
  const { repo, snapshots, project, dir, now, dryRun = false } = opts;
  const author = opts.author ?? null;
  const shareignore = opts.shareignore;
  const redact = opts.redact ?? false;

  // 1. Build all records up front (no writes) so the safety pass is fail-closed.
  const branchBundles = opts.branches.map((branch) => ({
    branch,
    file: branchFilePath(dir, branch),
    items: buildPinItems(repo.listPinsForBranch(project, branch), snapshots, project, branch, author),
  }));
  const gradItems = buildGradItems(repo.listGraduated(project), snapshots, project, author);

  // 2. .shareignore — drop records whose text matches a blocklist pattern.
  let ignored = 0;
  if (shareignore && shareignore.patterns.length > 0) {
    for (const bundle of branchBundles) {
      const kept = bundle.items.filter(
        (it) => !shareignore.ignores(combinedText(it.record.note, it.record.title, it.record.body)),
      );
      ignored += bundle.items.length - kept.length;
      bundle.items = kept;
    }
    const keptGrad = gradItems.filter(
      (it) => !shareignore.ignores(combinedText(null, it.record.title, it.record.body)),
    );
    ignored += gradItems.length - keptGrad.length;
    gradItems.length = 0;
    gradItems.push(...keptGrad);
  }

  // 3. Secret scan — fail-closed unless redact mode is on.
  let redacted = 0;
  const matches: SecretMatch[] = [];
  const scanPin = (r: PinRecord): SecretMatch[] =>
    scanForSecrets([
      { field: `pin#${r.observation_id ?? 'free'}.note`, value: r.note },
      { field: `pin#${r.observation_id ?? 'free'}.title`, value: r.title },
      { field: `pin#${r.observation_id ?? 'free'}.body`, value: r.body },
    ]);
  const scanGrad = (r: GraduatedRecord): SecretMatch[] =>
    scanForSecrets([
      { field: `graduated#${r.observation_id}.title`, value: r.title },
      { field: `graduated#${r.observation_id}.body`, value: r.body },
    ]);

  for (const bundle of branchBundles) {
    for (const it of bundle.items) matches.push(...scanPin(it.record));
  }
  for (const it of gradItems) matches.push(...scanGrad(it.record));

  if (matches.length > 0) {
    if (!redact) throw new RedactionError(matches);
    for (const bundle of branchBundles) {
      bundle.items = bundle.items.map((it) => {
        const r = redactPin(it.record);
        redacted += r.count;
        return { ...it, record: r.record };
      });
    }
    for (let i = 0; i < gradItems.length; i++) {
      const it = gradItems[i];
      if (it === undefined) continue;
      const r = redactGrad(it.record);
      redacted += r.count;
      gradItems[i] = { ...it, record: r.record };
    }
  }

  // 4. Write + mark shared.
  const branchResults: Array<ExportFileResult & { branch: string }> = [];
  for (const bundle of branchBundles) {
    const result = appendNew(
      bundle.file,
      bundle.items.map((it) => ({ line: serializeSyncRecord(it.record), hash: it.record.content_hash })),
      dryRun,
    );
    if (!dryRun) {
      for (const it of bundle.items) repo.markPinShared(it.pinId, it.record.content_hash, now);
    }
    branchResults.push({ branch: bundle.branch, ...result });
  }

  const gradResult = appendNew(
    graduatedFilePath(dir),
    gradItems.map((it) => ({ line: serializeSyncRecord(it.record), hash: it.record.content_hash })),
    dryRun,
  );
  if (!dryRun) {
    for (const it of gradItems) repo.markGraduatedShared(it.gradId, it.record.content_hash, now);
  }

  return { dir, branches: branchResults, graduated: gradResult, ignored, redacted, dryRun };
}

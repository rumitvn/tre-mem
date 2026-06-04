import { existsSync, readFileSync } from 'node:fs';

const LOG_LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface ReadLogOptions {
  /** Last N lines; `0`/negative or `all` returns everything. */
  tail?: number;
  all?: boolean;
  /** Minimum level (debug|info|warn|error). */
  level?: string;
  /** Exact component match (hook|mcp|backfill|sync|git|store|cli). */
  component?: string;
}

/** Filter raw JSONL log lines by minimum level and/or component (malformed lines pass through). */
export function filterLogLines(lines: string[], opts: ReadLogOptions): string[] {
  const minRank = opts.level ? LOG_LEVEL_RANK[opts.level.toLowerCase()] : undefined;
  if (minRank === undefined && !opts.component) return lines;
  return lines.filter((line) => {
    let rec: { level?: string; component?: string };
    try {
      rec = JSON.parse(line) as { level?: string; component?: string };
    } catch {
      return true; // keep unparseable lines rather than hide them
    }
    if (minRank !== undefined && (LOG_LEVEL_RANK[rec.level ?? ''] ?? 0) < minRank) return false;
    if (opts.component && rec.component !== opts.component) return false;
    return true;
  });
}

export interface ReadLogResult {
  exists: boolean;
  lines: string[];
}

/** Read, filter, and tail the diagnostics log file. Returns `exists:false` when absent. */
export function readLogTail(file: string, opts: ReadLogOptions = {}): ReadLogResult {
  if (!existsSync(file)) return { exists: false, lines: [] };
  const all = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const filtered = filterLogLines(all, opts);
  const n = opts.tail;
  const lines =
    opts.all || n === undefined || !Number.isInteger(n) || n <= 0 ? filtered : filtered.slice(-n);
  return { exists: true, lines };
}

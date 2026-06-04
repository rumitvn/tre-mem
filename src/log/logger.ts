import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Tiny append-only diagnostics logger. Writes one JSON object per line to a
 * file under ~/.tre-mem so the maintainer can collect it from a device and
 * paste it to an AI for product insight (no UI this phase).
 *
 * Invariants:
 * - Writes ONLY to a file — never stdout/stderr (hooks speak JSON over stdout).
 * - Never throws — a logging failure must not break a hook, the MCP server,
 *   or any CLI command. All IO is wrapped in a swallow-all try/catch.
 * - Logs counts + metadata only (branch/project names, ids, durations, error
 *   class+message) — never raw query text, prompt text, or pin/note bodies.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogComponent = 'hook' | 'mcp' | 'backfill' | 'sync' | 'git' | 'store' | 'cli';

export interface LogRecord {
  level: LogLevel;
  component: LogComponent;
  event: string;
  fields?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const DEFAULT_LEVEL: LogLevel = 'info';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  filePath: string;
  maxBytes: number;
}

let cachedConfig: LoggerConfig | null = null;
let dirEnsured = false;
/** Process-local running size of the live log file; -1 means "unknown, stat it". */
let knownSize = -1;

function homeDir(): string {
  const env = process.env.TRE_MEM_HOME;
  return env && env.trim() !== '' ? env : join(homedir(), '.tre-mem');
}

function parseLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return DEFAULT_LEVEL;
  const v = raw.trim().toLowerCase();
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : DEFAULT_LEVEL;
}

function parseEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function parseMaxBytes(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_BYTES;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function resolveConfig(): LoggerConfig {
  if (cachedConfig) return cachedConfig;
  const override = process.env.TRE_MEM_LOG_FILE;
  const filePath = override && override.trim() !== '' ? override : join(homeDir(), 'tre-mem.log');
  cachedConfig = {
    enabled: parseEnabled(process.env.TRE_MEM_LOG),
    minLevel: parseLevel(process.env.TRE_MEM_LOG_LEVEL),
    filePath,
    maxBytes: parseMaxBytes(process.env.TRE_MEM_LOG_MAX_BYTES),
  };
  return cachedConfig;
}

/** Resolved log file path (honors TRE_MEM_LOG_FILE, else <TRE_MEM_HOME>/tre-mem.log). */
export function logFilePath(): string {
  return resolveConfig().filePath;
}

/** Clear memoized config + state so tests can swap env vars between cases. */
export function resetLoggerForTests(): void {
  cachedConfig = null;
  dirEnsured = false;
  knownSize = -1;
}

/**
 * Rotate the live file to `<path>.1` (clobbering any prior backup) when it
 * crosses the size cap, so the log can never grow unbounded between collections.
 */
function rotateIfNeeded(cfg: LoggerConfig, incomingBytes: number): void {
  if (knownSize < 0) {
    try {
      knownSize = statSync(cfg.filePath).size;
    } catch {
      knownSize = 0; // file does not exist yet
    }
  }
  if (knownSize + incomingBytes <= cfg.maxBytes) return;
  try {
    renameSync(cfg.filePath, `${cfg.filePath}.1`);
  } catch {
    /* nothing to rotate, or rename raced another process — ignore */
  }
  knownSize = 0;
}

export function log(record: LogRecord): void {
  try {
    const cfg = resolveConfig();
    if (!cfg.enabled) return;
    if (LEVEL_ORDER[record.level] < LEVEL_ORDER[cfg.minLevel]) return;

    const now = new Date();
    const line = `${JSON.stringify({
      ts: now.toISOString(),
      t: now.getTime(),
      level: record.level,
      component: record.component,
      event: record.event,
      fields: record.fields ?? {},
    })}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');

    if (!dirEnsured) {
      mkdirSync(dirname(cfg.filePath), { recursive: true });
      dirEnsured = true;
    }
    rotateIfNeeded(cfg, bytes);
    appendFileSync(cfg.filePath, line, { encoding: 'utf8' });
    knownSize += bytes;
  } catch {
    /* logging must never break a hook, the MCP server, or a CLI command */
  }
}

/** Normalize any thrown value into an `error`-level record with err class + message. */
export function logError(
  component: LogComponent,
  event: string,
  err: unknown,
  fields?: Record<string, unknown>,
): void {
  const errClass = err instanceof Error ? err.constructor.name : typeof err;
  const msg = err instanceof Error ? err.message : String(err);
  log({ level: 'error', component, event, fields: { ...fields, err: errClass, msg } });
}

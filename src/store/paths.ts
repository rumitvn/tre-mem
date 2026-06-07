import { homedir } from 'node:os';
import { join } from 'node:path';

export const TRE_MEM_HOME =
  process.env.TRE_MEM_HOME && process.env.TRE_MEM_HOME.trim() !== ''
    ? process.env.TRE_MEM_HOME
    : join(homedir(), '.tre-mem');

export const TRE_MEM_DB_PATH = join(TRE_MEM_HOME, 'tre-mem.db');

export const CLAUDE_MEM_HOME =
  process.env.CLAUDE_MEM_HOME && process.env.CLAUDE_MEM_HOME.trim() !== ''
    ? process.env.CLAUDE_MEM_HOME
    : join(homedir(), '.claude-mem');

export const CLAUDE_MEM_DB_PATH = join(CLAUDE_MEM_HOME, 'claude-mem.db');
export const CLAUDE_MEM_CHROMA_DIR = join(CLAUDE_MEM_HOME, 'chroma');

/**
 * How long a SQLite connection waits for a lock before giving up with
 * `SQLITE_BUSY`. At session start several short-lived `tre` processes touch the
 * sidecar DB at once — the SessionStart hook (migrate + branch_state write), the
 * MCP server, and the background web daemon (WAL checkpoint). Without a busy
 * timeout SQLite fails instantly, which silently drops the banner and trips the
 * MCP "setup issue". A few seconds of patient waiting absorbs that contention.
 */
export const DB_BUSY_TIMEOUT_MS = 5000;

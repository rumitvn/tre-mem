import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

import { colors } from '../format/colors.js';
import { CLAUDE_MEM_DB_PATH } from '../store/paths.js';
import { VERSION } from '../version.js';

import {
  CLAUDE_MEM_TESTED_SCHEMA,
  missingObservationColumns,
  readSchemaVersion,
} from './version.js';

export interface ClaudeMemStatus {
  /** The claude-mem DB file exists on disk. */
  installed: boolean;
  /** Required tables + columns present (tre-mem can read it). */
  compatible: boolean;
  dbPath: string;
  /** claude-mem's effective schema version, or null if unknown. */
  schemaVersion: number | null;
  /** Highest schema version this tre-mem release was tested against. */
  testedSchema: number;
  /** Installed schema is ahead of what we tested (still works, just a heads-up). */
  newerThanTested: boolean;
  /** Required `observations` columns that are missing (empty when compatible). */
  missingColumns: string[];
  /** One-line, machine-ish reason for the current state. */
  reason: string;
}

/**
 * Inspect the claude-mem install without holding a connection open. Opens a
 * short-lived read-only handle, reads what it needs, and closes it. Never
 * throws — every failure maps to a structured status so callers can render
 * friendly guidance instead of a stack trace.
 */
export function diagnoseClaudeMem(dbPath: string = CLAUDE_MEM_DB_PATH): ClaudeMemStatus {
  const base: ClaudeMemStatus = {
    installed: false,
    compatible: false,
    dbPath,
    schemaVersion: null,
    testedSchema: CLAUDE_MEM_TESTED_SCHEMA,
    newerThanTested: false,
    missingColumns: [],
    reason: 'not installed',
  };

  if (!existsSync(dbPath)) return base;

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    const schemaVersion = readSchemaVersion(db);
    const missing = missingObservationColumns(db);
    const compatible = missing.length === 0;
    const newerThanTested = schemaVersion !== null && schemaVersion > CLAUDE_MEM_TESTED_SCHEMA;
    return {
      ...base,
      installed: true,
      compatible,
      schemaVersion,
      newerThanTested,
      missingColumns: missing,
      reason: compatible
        ? newerThanTested
          ? 'newer than tested'
          : 'ok'
        : `missing columns: ${missing.join(', ')}`,
    };
  } catch (err) {
    return {
      ...base,
      installed: true,
      reason: `unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    db?.close();
  }
}

/**
 * Human-facing, multi-line guidance for a given status. Colored by default;
 * pass `color: false` for plain output (logs, non-TTY captures).
 */
export function claudeMemGuidance(status: ClaudeMemStatus, color = true): string {
  const c = colors(color);
  const lines: string[] = [];

  if (!status.installed) {
    lines.push(c.bold(c.yellow('claude-mem is not installed — tre-mem builds on top of it.')));
    lines.push('  tre-mem reads claude-mem’s memory and adds the branch dimension.');
    lines.push(`  Looked for: ${c.dim(status.dbPath)}`);
    lines.push('');
    lines.push(c.bold('  Get started:'));
    lines.push(
      `    1. Install claude-mem  ${c.dim('(see https://github.com/thedotmack/claude-mem)')}`,
    );
    lines.push('    2. Run a Claude Code session so it records some memory');
    lines.push(`    3. ${c.cyan('tre init')}      ${c.dim('# set up ~/.tre-mem')}`);
    lines.push(`    4. ${c.cyan('tre backfill')}  ${c.dim('# branch-tag past observations')}`);
    return lines.join('\n');
  }

  if (!status.compatible) {
    lines.push(c.bold(c.red('claude-mem schema is incompatible with this tre-mem release.')));
    lines.push(`  Missing observations column(s): ${c.yellow(status.missingColumns.join(', '))}`);
    if (status.schemaVersion !== null) {
      lines.push(
        `  claude-mem schema v${status.schemaVersion}; tre-mem ${VERSION} tested up to v${status.testedSchema}.`,
      );
    }
    lines.push(`  Upgrade tre-mem:  ${c.cyan('npm i -g tre-mem@latest')}`);
    return lines.join('\n');
  }

  if (status.newerThanTested) {
    lines.push(
      c.yellow(
        `⚠ claude-mem schema v${status.schemaVersion} is newer than tre-mem ${VERSION} was tested against (v${status.testedSchema}).`,
      ),
    );
    lines.push('  Things should still work; some features may not. If you hit issues:');
    lines.push(`  Upgrade tre-mem:  ${c.cyan('npm i -g tre-mem@latest')}`);
    return lines.join('\n');
  }

  const v = status.schemaVersion !== null ? `v${status.schemaVersion}` : 'unknown';
  return c.green(`claude-mem OK (schema ${v}, tested up to v${status.testedSchema}).`);
}

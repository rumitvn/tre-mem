import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { log, logError, logFilePath, resetLoggerForTests } from '../src/log/logger.js';

const LOG_ENV = [
  'TRE_MEM_LOG',
  'TRE_MEM_LOG_LEVEL',
  'TRE_MEM_LOG_FILE',
  'TRE_MEM_LOG_MAX_BYTES',
  'TRE_MEM_HOME',
] as const;

function clearEnv(): void {
  for (const k of LOG_ENV) delete process.env[k];
}

function readLines(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('logger', () => {
  let tmp: string;
  let file: string;

  beforeEach(() => {
    clearEnv();
    tmp = mkdtempSync(join(tmpdir(), 'tre-log-'));
    file = join(tmp, 'nested', 'tre-mem.log');
    process.env.TRE_MEM_LOG_FILE = file;
    resetLoggerForTests();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    clearEnv();
    resetLoggerForTests();
  });

  test('writes a valid JSONL line with the full record shape', () => {
    log({ level: 'info', component: 'hook', event: 'session_start', fields: { branch: 'main' } });

    const lines = readLines(file);
    expect(lines).toHaveLength(1);
    const rec = lines[0]!;
    expect(rec).toMatchObject({
      level: 'info',
      component: 'hook',
      event: 'session_start',
      fields: { branch: 'main' },
    });
    expect(typeof rec.ts).toBe('string');
    expect(typeof rec.t).toBe('number');
  });

  test('defaults fields to an empty object when omitted', () => {
    log({ level: 'info', component: 'cli', event: 'noop' });
    expect(readLines(file)[0]!.fields).toEqual({});
  });

  test('appends successive lines in order', () => {
    log({ level: 'info', component: 'backfill', event: 'a' });
    log({ level: 'info', component: 'backfill', event: 'b' });
    expect(readLines(file).map((r) => r.event)).toEqual(['a', 'b']);
  });

  test('creates the parent directory when missing', () => {
    log({ level: 'info', component: 'store', event: 'x' });
    expect(existsSync(file)).toBe(true);
  });

  test('drops records below the configured min level', () => {
    process.env.TRE_MEM_LOG_LEVEL = 'warn';
    resetLoggerForTests();

    log({ level: 'info', component: 'hook', event: 'dropped' });
    log({ level: 'warn', component: 'hook', event: 'kept' });
    log({ level: 'error', component: 'hook', event: 'kept2' });

    expect(readLines(file).map((r) => r.event)).toEqual(['kept', 'kept2']);
  });

  test('writes nothing when disabled via TRE_MEM_LOG=0', () => {
    process.env.TRE_MEM_LOG = '0';
    resetLoggerForTests();

    log({ level: 'error', component: 'cli', event: 'should_not_appear' });
    expect(existsSync(file)).toBe(false);
  });

  test('logError normalizes a thrown Error to err + msg', () => {
    logError('mcp', 'tool_error', new TypeError('bad id'), { tool: 'pin_fact' });

    const rec = readLines(file)[0]!;
    expect(rec.level).toBe('error');
    expect(rec.fields).toMatchObject({ tool: 'pin_fact', err: 'TypeError', msg: 'bad id' });
  });

  test('logError normalizes a thrown non-Error value', () => {
    logError('cli', 'cli_error', 'plain string boom');

    const rec = readLines(file)[0]!;
    expect(rec.fields).toMatchObject({ err: 'string', msg: 'plain string boom' });
  });

  test('rotates to <path>.1 when the size cap is crossed', () => {
    process.env.TRE_MEM_LOG_MAX_BYTES = '200';
    resetLoggerForTests();

    for (let i = 0; i < 20; i += 1) {
      log({ level: 'info', component: 'sync', event: 'fill', fields: { i } });
    }

    expect(existsSync(`${file}.1`)).toBe(true);
    // Live file restarted, so it holds fewer than the total written lines.
    expect(statSync(file).size).toBeLessThan(statSync(`${file}.1`).size + 200);
    expect(readLines(file).length).toBeGreaterThan(0);
  });

  test('never throws when the target path is unwritable', () => {
    // Point the log "file" at a path whose parent is itself a file → mkdir fails.
    const blocker = join(tmp, 'blocker');
    writeFileSync(blocker, 'x');
    process.env.TRE_MEM_LOG_FILE = join(blocker, 'tre-mem.log');
    resetLoggerForTests();

    expect(() => log({ level: 'error', component: 'cli', event: 'boom' })).not.toThrow();
  });

  test('logFilePath honors the override and falls back to TRE_MEM_HOME', () => {
    expect(logFilePath()).toBe(file);

    delete process.env.TRE_MEM_LOG_FILE;
    process.env.TRE_MEM_HOME = tmp;
    resetLoggerForTests();
    expect(logFilePath()).toBe(join(tmp, 'tre-mem.log'));
  });
});

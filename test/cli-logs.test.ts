import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { filterLogLines, readLogTail } from '../src/log/read.js';

function line(level: string, component: string, event: string): string {
  return JSON.stringify({ ts: 'x', t: 1, level, component, event, fields: {} });
}

describe('readLogTail', () => {
  let tmp: string;
  let file: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-logs-'));
    file = join(tmp, 'tre-mem.log');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('reports exists:false when the file is missing', () => {
    const result = readLogTail(file, { tail: 50 });
    expect(result.exists).toBe(false);
    expect(result.lines).toEqual([]);
  });

  test('--tail returns the last N lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => line('info', 'hook', `e${i}`));
    writeFileSync(file, lines.join('\n') + '\n');

    const result = readLogTail(file, { tail: 3 });
    expect(result.exists).toBe(true);
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map((l) => JSON.parse(l).event)).toEqual(['e7', 'e8', 'e9']);
  });

  test('--all returns the whole file', () => {
    const lines = Array.from({ length: 5 }, (_, i) => line('info', 'hook', `e${i}`));
    writeFileSync(file, lines.join('\n') + '\n');

    expect(readLogTail(file, { tail: 2, all: true }).lines).toHaveLength(5);
    expect(readLogTail(file, { tail: 0 }).lines).toHaveLength(5);
  });

  test('--level keeps only lines at or above the threshold', () => {
    writeFileSync(
      file,
      [line('info', 'hook', 'a'), line('warn', 'sync', 'b'), line('error', 'mcp', 'c')].join('\n'),
    );

    const result = readLogTail(file, { level: 'warn' });
    expect(result.lines.map((l) => JSON.parse(l).event)).toEqual(['b', 'c']);
  });

  test('--component filters by component', () => {
    writeFileSync(file, [line('info', 'hook', 'a'), line('info', 'sync', 'b')].join('\n'));

    const result = readLogTail(file, { component: 'sync' });
    expect(result.lines.map((l) => JSON.parse(l).event)).toEqual(['b']);
  });

  test('filterLogLines keeps malformed lines rather than hiding them', () => {
    const kept = filterLogLines(['not json', line('error', 'cli', 'x')], { level: 'error' });
    expect(kept).toEqual(['not json', line('error', 'cli', 'x')]);
  });
});

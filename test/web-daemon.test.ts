import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDaemon,
  daemonFilePath,
  isAlive,
  readDaemon,
  reconcileDaemon,
  stopDaemon,
  writeDaemon,
} from '../src/web/daemon.js';

const DEAD_PID = 2147483646; // astronomically unlikely to be a live process

describe('web daemon pidfile', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tre-web-daemon-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('round-trips pid + port through the pidfile', () => {
    expect(readDaemon(home)).toBeNull();
    writeDaemon({ pid: process.pid, port: 38712, startedAtEpoch: 100 }, home);
    expect(existsSync(daemonFilePath(home))).toBe(true);
    expect(readDaemon(home)).toEqual({ pid: process.pid, port: 38712, startedAtEpoch: 100 });
  });

  it('isAlive is true for this process, false for a dead/invalid pid', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(DEAD_PID)).toBe(false);
    expect(isAlive(0)).toBe(false);
    expect(isAlive(-1)).toBe(false);
  });

  it('reconcile keeps a live daemon', () => {
    writeDaemon({ pid: process.pid, port: 38713 }, home);
    expect(reconcileDaemon(home)).toMatchObject({ pid: process.pid, port: 38713 });
    expect(existsSync(daemonFilePath(home))).toBe(true);
  });

  it('reconcile clears a stale pidfile', () => {
    writeDaemon({ pid: DEAD_PID, port: 38714 }, home);
    expect(reconcileDaemon(home)).toBeNull();
    expect(existsSync(daemonFilePath(home))).toBe(false);
  });

  it('treats a malformed pidfile as absent', () => {
    writeFileSync(daemonFilePath(home), 'not json', 'utf8');
    expect(readDaemon(home)).toBeNull();
  });

  it('stopDaemon reports nothing to stop when no daemon', () => {
    expect(stopDaemon(home)).toEqual({ stopped: false });
  });

  it('stopDaemon clears a stale pidfile and reports not stopped', () => {
    writeDaemon({ pid: DEAD_PID, port: 38715 }, home);
    expect(stopDaemon(home)).toEqual({ stopped: false });
    expect(existsSync(daemonFilePath(home))).toBe(false);
  });

  it('clearDaemon is a no-op when absent', () => {
    expect(() => clearDaemon(home)).not.toThrow();
  });
});

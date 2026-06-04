import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { TRE_MEM_HOME } from '../store/paths.js';

/**
 * Background `tre web` daemon bookkeeping.
 *
 * A single JSON pidfile under `~/.tre-mem/` records the running dashboard's
 * pid + port. `reconcileDaemon` self-heals a stale pidfile (process gone but
 * file left behind) so `tre web status`/`stop` never act on a dead pid.
 */
export interface DaemonInfo {
  pid: number;
  port: number;
  startedAtEpoch?: number;
}

const PID_FILE = 'web.pid';

export function daemonFilePath(home: string = TRE_MEM_HOME): string {
  return join(home, PID_FILE);
}

/** True when a process with `pid` exists (EPERM still means alive). */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readDaemon(home: string = TRE_MEM_HOME): DaemonInfo | null {
  const path = daemonFilePath(home);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DaemonInfo>;
    if (typeof parsed.pid === 'number' && typeof parsed.port === 'number') {
      const info: DaemonInfo = { pid: parsed.pid, port: parsed.port };
      if (typeof parsed.startedAtEpoch === 'number') info.startedAtEpoch = parsed.startedAtEpoch;
      return info;
    }
  } catch {
    /* malformed pidfile → treat as absent */
  }
  return null;
}

export function writeDaemon(info: DaemonInfo, home: string = TRE_MEM_HOME): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(daemonFilePath(home), `${JSON.stringify(info)}\n`, 'utf8');
}

export function clearDaemon(home: string = TRE_MEM_HOME): void {
  const path = daemonFilePath(home);
  if (existsSync(path)) rmSync(path);
}

/** Return the live daemon, clearing the pidfile if its process is gone. */
export function reconcileDaemon(home: string = TRE_MEM_HOME): DaemonInfo | null {
  const info = readDaemon(home);
  if (!info) return null;
  if (isAlive(info.pid)) return info;
  clearDaemon(home);
  return null;
}

export interface StopResult {
  stopped: boolean;
  pid?: number;
}

/** SIGTERM the running daemon (if any) and clear its pidfile. */
export function stopDaemon(home: string = TRE_MEM_HOME): StopResult {
  const info = reconcileDaemon(home);
  if (!info) return { stopped: false };
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    /* race: process exited between reconcile and kill */
  }
  clearDaemon(home);
  return { stopped: true, pid: info.pid };
}

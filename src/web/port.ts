import { createServer } from 'node:net';

/**
 * Port selection for the `tre web` dashboard.
 *
 * Default is `38700 + (uid % 100)` — a per-user port in a band that avoids
 * claude-mem's worker range (37700 + uid%100). Override with `TRE_MEM_WEB_PORT`.
 * If the preferred port is busy we walk forward to the next free one so two
 * repos can run dashboards side by side without colliding.
 */
export const WEB_PORT_BASE = 38700;
export const WEB_PORT_SPAN = 100;
export const WEB_PORT_ENV = 'TRE_MEM_WEB_PORT';
export const WEB_HOST = '127.0.0.1';

/** Parse a port override; returns null when unset, empty, or out of range. */
export function parsePortEnv(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/** Pure port derivation — env override wins, else `BASE + (uid % SPAN)`. */
export function derivePort(env: NodeJS.ProcessEnv = process.env, uid?: number): number {
  const override = parsePortEnv(env[WEB_PORT_ENV]);
  if (override !== null) return override;
  const id = typeof uid === 'number' && Number.isFinite(uid) ? Math.trunc(uid) : 0;
  return WEB_PORT_BASE + (((id % WEB_PORT_SPAN) + WEB_PORT_SPAN) % WEB_PORT_SPAN);
}

/** Resolve the preferred port for this process (uses real env + uid). */
export function defaultPort(): number {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return derivePort(process.env, uid);
}

/** Resolve true if nothing else is listening on `port` for `host`. */
export function isPortFree(port: number, host: string = WEB_HOST): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probe = createServer();
    probe.once('error', () => resolvePromise(false));
    probe.once('listening', () => {
      probe.close(() => resolvePromise(true));
    });
    probe.listen(port, host);
  });
}

/** Walk forward from `preferred` to the first free port, up to `maxTries`. */
export async function findAvailablePort(
  preferred: number,
  host: string = WEB_HOST,
  maxTries = 20,
): Promise<number> {
  for (let i = 0; i < maxTries; i += 1) {
    const candidate = preferred + i;
    if (candidate > 65535) break;
    if (await isPortFree(candidate, host)) return candidate;
  }
  throw new Error(`tre web: no free port found near ${preferred} (tried ${maxTries})`);
}

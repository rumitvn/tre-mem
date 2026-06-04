import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WEB_PORT_BASE,
  derivePort,
  findAvailablePort,
  isPortFree,
  parsePortEnv,
} from '../src/web/port.js';

describe('parsePortEnv', () => {
  it('returns null for unset / empty / invalid', () => {
    expect(parsePortEnv(undefined)).toBeNull();
    expect(parsePortEnv('')).toBeNull();
    expect(parsePortEnv('   ')).toBeNull();
    expect(parsePortEnv('abc')).toBeNull();
    expect(parsePortEnv('0')).toBeNull();
    expect(parsePortEnv('70000')).toBeNull();
    expect(parsePortEnv('80.5')).toBeNull();
  });

  it('parses a valid port', () => {
    expect(parsePortEnv('3000')).toBe(3000);
    expect(parsePortEnv(' 8080 ')).toBe(8080);
  });
});

describe('derivePort', () => {
  it('prefers the TRE_MEM_WEB_PORT override', () => {
    expect(derivePort({ TRE_MEM_WEB_PORT: '4321' }, 7)).toBe(4321);
  });

  it('derives BASE + (uid % 100) when no override', () => {
    expect(derivePort({}, 3)).toBe(WEB_PORT_BASE + 3);
    expect(derivePort({}, 103)).toBe(WEB_PORT_BASE + 3);
    expect(derivePort({}, 0)).toBe(WEB_PORT_BASE);
  });

  it('falls back to BASE when uid is unavailable', () => {
    expect(derivePort({}, undefined)).toBe(WEB_PORT_BASE);
  });

  it('ignores an out-of-range override and derives from uid', () => {
    expect(derivePort({ TRE_MEM_WEB_PORT: '999999' }, 5)).toBe(WEB_PORT_BASE + 5);
  });
});

describe('isPortFree / findAvailablePort', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((res) => {
            s.close(() => res());
          }),
      ),
    );
  });

  function occupy(port: number): Promise<void> {
    return new Promise((res, rej) => {
      const s = createServer();
      servers.push(s);
      s.once('error', rej);
      s.listen(port, '127.0.0.1', () => res());
    });
  }

  it('reports a free port as free', async () => {
    const free = await findAvailablePort(41000);
    expect(await isPortFree(free)).toBe(true);
  });

  it('reports an occupied port as not free', async () => {
    const free = await findAvailablePort(41100);
    await occupy(free);
    expect(await isPortFree(free)).toBe(false);
  });

  it('walks forward past an occupied preferred port', async () => {
    const start = await findAvailablePort(41200);
    await occupy(start);
    const next = await findAvailablePort(start);
    expect(next).toBeGreaterThan(start);
    expect(await isPortFree(next)).toBe(true);
  });
});

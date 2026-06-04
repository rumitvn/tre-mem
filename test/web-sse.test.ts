import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import { createWebServer } from '../src/web/server.js';
import { SseHub } from '../src/web/sse.js';
import { type WebDeps } from '../src/web/types.js';

interface FakeRes {
  writeHead: (status: number, headers: Record<string, string>) => void;
  write: (chunk: string) => boolean;
  end: () => void;
  on: (event: string, cb: () => void) => void;
  frames: string[];
  status?: number;
  closeHandler?: () => void;
}

function fakeRes(): FakeRes {
  const r: FakeRes = {
    frames: [],
    writeHead(status) {
      r.status = status;
    },
    write(chunk) {
      r.frames.push(chunk);
      return true;
    },
    end() {},
    on(event, cb) {
      if (event === 'close') r.closeHandler = cb;
    },
  };
  return r;
}

describe('SseHub', () => {
  it('sends hello on connect and broadcasts to all clients', () => {
    const hub = new SseHub();
    const a = fakeRes();
    const b = fakeRes();
    hub.add(a as never);
    hub.add(b as never);
    expect(hub.size).toBe(2);
    expect(a.status).toBe(200);
    expect(a.frames.join('')).toContain('event: hello');

    hub.broadcast({ event: 'branch-changed', data: { branch: 'feature/x' } });
    expect(a.frames.join('')).toContain('event: branch-changed');
    expect(b.frames.join('')).toContain('feature/x');
  });

  it('prunes a client on close', () => {
    const hub = new SseHub();
    const a = fakeRes();
    hub.add(a as never);
    expect(hub.size).toBe(1);
    a.closeHandler?.();
    expect(hub.size).toBe(0);
  });

  it('closeAll empties the hub', () => {
    const hub = new SseHub();
    hub.add(fakeRes() as never);
    hub.closeAll();
    expect(hub.size).toBe(0);
  });
});

describe('GET /api/events live stream', () => {
  let tmp: string;
  let repo: TreMemRepo;
  let server: Server;
  let base: string;
  let sse: SseHub;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-web-sse-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
    sse = new SseHub();
    const deps: WebDeps = {
      repo,
      adapter: null,
      cwd: tmp,
      project: 'demo',
      staticDir: join(tmp, 'no-static'),
      version: '0.0.0',
      now: () => 1,
      sse,
    };
    server = createWebServer(deps);
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    sse.closeAll();
    await new Promise<void>((res) => server.close(() => res()));
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('streams hello then a broadcast event', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const readUntil = async (needle: string): Promise<void> => {
      while (!buf.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
      }
    };

    await readUntil('event: hello');
    expect(buf).toContain('event: hello');

    sse.broadcast({ event: 'team-memory-changed', data: { n: 3 } });
    await readUntil('team-memory-changed');
    expect(buf).toContain('team-memory-changed');
    ctrl.abort();
  });
});

import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import { sendStatic } from '../src/web/respond.js';
import { createWebServer } from '../src/web/server.js';
import { SseHub } from '../src/web/sse.js';
import { type WebDeps } from '../src/web/types.js';

describe('static serving + SPA fallback', () => {
  let tmp: string;
  let staticDir: string;
  let repo: TreMemRepo;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-web-static-'));
    staticDir = join(tmp, 'public');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>tre</title>', 'utf8');
    writeFileSync(join(staticDir, 'app.js'), 'console.log(1)', 'utf8');

    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
    const deps: WebDeps = {
      repo,
      adapter: null,
      cwd: tmp,
      project: 'demo',
      remote: null,
      aliases: ['demo'],
      staticDir,
      version: '0.0.0',
      now: () => 1,
      sse: new SseHub(),
    };
    server = createWebServer(deps);
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('serves index.html at /', async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).toContain('<title>tre</title>');
  });

  it('serves app.js with a js content-type', async () => {
    const r = await fetch(`${base}/app.js`);
    expect(r.headers.get('content-type')).toContain('javascript');
    expect(await r.text()).toContain('console.log');
  });

  it('falls back to index.html for client routes', async () => {
    const r = await fetch(`${base}/team`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('tre');
  });

  it('never leaks a file outside the root (traversal → in-root fallback)', async () => {
    // curl-style normalization is bypassed with an encoded traversal; the
    // server must still answer with index.html, never /etc/passwd contents.
    const r = await fetch(`${base}/%2e%2e/%2e%2e/%2e%2e/etc/passwd`);
    const body = await r.text();
    expect(body).not.toContain('root:');
    expect(body).toContain('tre');
  });

  it('sendStatic returns false when the root does not exist', () => {
    let touched = false;
    const res = {
      writeHead: () => {
        touched = true;
      },
      end: () => {
        touched = true;
      },
    };
    expect(sendStatic(res as never, join(tmp, 'does-not-exist'), '/index.html')).toBe(false);
    expect(touched).toBe(false);
  });
});

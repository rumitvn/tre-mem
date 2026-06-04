import { spawn } from 'node:child_process';
import { type Server, createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import { diagnoseClaudeMem } from '../adapter/preflight.js';
import { log, logError } from '../log/logger.js';
import { migrate } from '../store/migrate.js';
import { TreMemRepo } from '../store/repo.js';
import { VERSION } from '../version.js';

import { apiRoutes } from './api.js';
import { sendError, sendStatic } from './respond.js';
import { SseHub } from './sse.js';
import { type Route, type RouteHandler, type WebDeps } from './types.js';
import { defaultPort, findAvailablePort, WEB_HOST } from './port.js';
import { startWatchers, type WebWatchers } from './watch.js';

interface CompiledRoute {
  method: string;
  segments: Array<{ literal: string } | { param: string }>;
  handler: RouteHandler;
}

function compile(route: Route): CompiledRoute {
  const segments = route.pattern
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith(':') ? { param: s.slice(1) } : { literal: s }));
  return { method: route.method, segments, handler: route.handler };
}

function match(
  routes: CompiledRoute[],
  method: string,
  pathname: string,
): { handler: RouteHandler; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((s) => s.length > 0);
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < route.segments.length; i += 1) {
      const seg = route.segments[i];
      const part = parts[i] as string;
      if (!seg) {
        ok = false;
        break;
      }
      if ('literal' in seg) {
        if (seg.literal !== part) {
          ok = false;
          break;
        }
      } else {
        params[seg.param] = part;
      }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}

/** Build the dashboard HTTP server. SSE endpoint is wired here over `deps.sse`. */
export function createWebServer(deps: WebDeps): Server {
  const routes = apiRoutes().map(compile);
  return createServer((req, res) => {
    void handle().catch((err) => {
      logError('web', 'request_error', err, { url: req.url });
      if (!res.headersSent) sendError(res, 500, 'internal error');
    });

    async function handle(): Promise<void> {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${WEB_HOST}`);
      const pathname = url.pathname;

      if (method === 'GET' && pathname === '/api/events') {
        if (deps.sse) deps.sse.add(res);
        else sendError(res, 503, 'sse unavailable');
        return;
      }

      const found = match(routes, method, pathname);
      if (found) {
        await found.handler(req, res, { params: found.params, query: url.searchParams, deps });
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendError(res, 404, `no route: ${method} ${pathname}`);
        return;
      }

      if (sendStatic(res, deps.staticDir, pathname)) return;
      sendError(res, 404, 'not found');
    }
  });
}

function defaultStaticDir(): string {
  // dist/web/server.js → dist/web (bundled SPA lives in dist/web/public)
  return join(dirname(fileURLToPath(import.meta.url)), 'public');
}

/** Best-effort open of the default browser; never throws. */
export function openBrowser(targetUrl: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [targetUrl], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* headless / no browser — ignore */
  }
}

export interface RunWebOptions {
  cwd?: string;
  port?: number;
  open?: boolean;
  staticDir?: string;
}

export interface RunningWeb {
  server: Server;
  port: number;
  url: string;
  mode: 'full' | 'shared-only';
  close: () => Promise<void>;
}

/**
 * Start the dashboard in the current process. claude-mem is OPTIONAL: when it's
 * absent or incompatible we run in shared-memory-only mode (pins + graduated
 * from the sidecar + .tre-mem/) rather than refusing to start.
 */
export async function runWebServer(opts: RunWebOptions = {}): Promise<RunningWeb> {
  migrate();
  const cwd = opts.cwd ?? process.cwd();
  const project = basename(cwd);

  const cm = diagnoseClaudeMem();
  let adapter: ClaudeMemAdapter | null = null;
  if (cm.installed && cm.compatible) {
    try {
      adapter = new ClaudeMemAdapter();
    } catch (err) {
      logError('web', 'adapter_open_failed', err, {});
      adapter = null;
    }
  }

  const repo = new TreMemRepo();
  const sse = new SseHub();
  const deps: WebDeps = {
    repo,
    adapter,
    cwd,
    project,
    staticDir: opts.staticDir ?? defaultStaticDir(),
    version: VERSION,
    now: () => Math.floor(Date.now() / 1000),
    sse,
  };

  const preferred = opts.port ?? defaultPort();
  const port = await findAvailablePort(preferred, WEB_HOST);
  const server = createWebServer(deps);

  let watchers: WebWatchers | null = null;
  await new Promise<void>((resolvePromise) => {
    server.listen(port, WEB_HOST, () => resolvePromise());
  });

  try {
    watchers = await startWatchers({ cwd, project, repo, sse, now: deps.now });
  } catch (err) {
    logError('web', 'watch_start_failed', err, {});
  }

  const mode = adapter ? 'full' : 'shared-only';
  const url = `http://${WEB_HOST}:${port}/`;
  log({ level: 'info', component: 'web', event: 'server_start', fields: { port, mode } });
  if (opts.open) openBrowser(url);

  const close = async (): Promise<void> => {
    sse.closeAll();
    if (watchers) await watchers.stop();
    await new Promise<void>((res) => server.close(() => res()));
    try {
      adapter?.close();
    } catch {
      /* noop */
    }
    try {
      repo.close();
    } catch {
      /* noop */
    }
  };

  return { server, port, url, mode, close };
}

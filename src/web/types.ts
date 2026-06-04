import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import type { TreMemRepo } from '../store/repo.js';

import type { SseHub } from './sse.js';

/** Everything an API handler needs. `adapter` is null in shared-memory-only mode. */
export interface WebDeps {
  repo: TreMemRepo;
  adapter: ClaudeMemAdapter | null;
  cwd: string;
  project: string;
  staticDir: string;
  version: string;
  now: () => number;
  sse: SseHub | null;
}

export interface RouteCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  deps: WebDeps;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteCtx,
) => void | Promise<void>;

export interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

export type WebMode = 'full' | 'shared-only';

export function webMode(deps: Pick<WebDeps, 'adapter'>): WebMode {
  return deps.adapter ? 'full' : 'shared-only';
}

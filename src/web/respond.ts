import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/**
 * Serve a static file from `root`, defending against path traversal: the
 * resolved target must stay inside `root`. Falls back to `index.html` (SPA
 * client routing) for non-asset paths. Returns false when nothing was served.
 */
export function sendStatic(res: ServerResponse, root: string, urlPath: string): boolean {
  if (!existsSync(root)) return false;
  const rootResolved = resolve(root);
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let target = resolve(join(rootResolved, rel));
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) return false;

  if (!existsSync(target) || statSync(target).isDirectory()) {
    const index = join(rootResolved, 'index.html');
    if (!existsSync(index)) return false;
    target = index;
  }

  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  createReadStream(target).pipe(res);
  return true;
}

import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';

/**
 * Normalize a git remote URL to a stable, scheme-less canonical slug of the form
 * `host/org/repo` (e.g. `github.com/rumitvn/tre-mem`). This is the identity used to
 * union memory across multiple local clones of the same repository.
 *
 * Pure function (no I/O) so it can be unit-tested exhaustively. Handles ssh scp
 * short form, ssh/git/https/http URLs, embedded credentials, a trailing `.git`,
 * and a trailing slash. Lowercases the whole slug (host is case-insensitive; path
 * case collisions across orgs are negligible and maximizing the union is the point).
 * Returns `null` for empty or unparseable input.
 */
export function canonicalizeRemoteUrl(url: string): string | null {
  const raw = url.trim();
  if (raw === '') return null;

  let rest: string;

  // ssh scp short form: git@host:org/repo(.git) — note the colon, no `//`.
  const scp = /^[^/@]+@([^:/]+):(.+)$/.exec(raw);
  if (scp && !raw.includes('://')) {
    rest = `${scp[1]}/${scp[2]}`;
  } else {
    // Strip a leading scheme (https://, http://, ssh://, git://, git+ssh://).
    const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    // Drop embedded credentials: everything up to and including the last `@`
    // in the authority portion (before the first `/`).
    const slashIdx = withoutScheme.indexOf('/');
    const authority = slashIdx === -1 ? withoutScheme : withoutScheme.slice(0, slashIdx);
    const path = slashIdx === -1 ? '' : withoutScheme.slice(slashIdx);
    const at = authority.lastIndexOf('@');
    const hostPort = at === -1 ? authority : authority.slice(at + 1);
    // Drop a port suffix on the host (host:22/...).
    const host = hostPort.replace(/:\d+$/, '');
    rest = `${host}${path}`;
  }

  // Normalize: collapse, strip trailing `.git`, strip surrounding slashes, lowercase.
  let slug = rest.replace(/\/{2,}/g, '/');
  slug = slug.replace(/\.git$/i, '');
  slug = slug.replace(/^\/+|\/+$/g, '');
  slug = slug.toLowerCase();

  // A valid slug needs at least host + one path segment.
  if (slug === '' || !slug.includes('/')) return null;
  return slug;
}

/**
 * Best-effort canonical slug for the `origin` remote of the repo at `cwd`.
 * Reads `git config --get remote.origin.url` (origin only — reading every remote
 * would over-union). Returns `null` when there's no repo, no origin, or any error.
 * Never throws (mirrors the other git helpers).
 */
export async function remoteSlug(cwd: string): Promise<string | null> {
  if (!existsSync(cwd)) return null;
  try {
    const url = (await simpleGit(cwd).raw(['config', '--get', 'remote.origin.url'])).trim();
    if (url === '') return null;
    return canonicalizeRemoteUrl(url);
  } catch {
    return null;
  }
}

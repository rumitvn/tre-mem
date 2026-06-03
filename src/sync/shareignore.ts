import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `.tre-mem/.shareignore` — per-repo blocklist. Unlike gitignore (which matches
 * file paths), these patterns match against a pin/graduated record's *text*
 * (note + title + body). A record that matches any pattern is excluded from
 * export. Supports `#` comments, blank lines, and `*` glob wildcards.
 */
export interface ShareignoreMatcher {
  readonly patterns: ReadonlyArray<string>;
  ignores(text: string): boolean;
}

const EMPTY: ShareignoreMatcher = { patterns: [], ignores: () => false };

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  return new RegExp(escaped, 'i');
}

export function parseShareignore(content: string): ShareignoreMatcher {
  const patterns: string[] = [];
  const regexes: RegExp[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    patterns.push(line);
    regexes.push(globToRegExp(line));
  }
  if (patterns.length === 0) return EMPTY;
  return {
    patterns,
    ignores(text: string): boolean {
      return regexes.some((re) => re.test(text));
    },
  };
}

/** Load `<dir>/.shareignore` if present; otherwise a no-op matcher. */
export function loadShareignore(dir: string): ShareignoreMatcher {
  const file = join(dir, '.shareignore');
  if (!existsSync(file)) return EMPTY;
  return parseShareignore(readFileSync(file, 'utf8'));
}

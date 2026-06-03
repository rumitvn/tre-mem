import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';

/**
 * Best-effort author name for export attribution: `git config user.name`,
 * falling back to null when unavailable. Never throws.
 */
export async function gitAuthor(cwd: string): Promise<string | null> {
  if (!existsSync(cwd)) return null;
  try {
    const name = (await simpleGit(cwd).raw(['config', 'user.name'])).trim();
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

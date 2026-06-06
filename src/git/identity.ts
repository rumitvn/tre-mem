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

/**
 * Commit authors on a branch, most-frequent first, with their commit counts.
 * Used as the solo/unshared fallback for the Grove view: when nothing has been
 * shared yet, contributors are inferred from `git log --format=%an`. Best-effort
 * — returns `[]` on any failure (no repo, unknown branch). Never throws.
 */
export async function branchAuthors(
  cwd: string,
  branch: string,
): Promise<Array<{ name: string; commits: number }>> {
  if (!existsSync(cwd)) return [];
  try {
    const raw = await simpleGit(cwd).raw(['log', '--format=%an', branch]);
    const counts = new Map<string, number>();
    for (const line of raw.split('\n')) {
      const name = line.trim();
      if (name === '') continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, commits]) => ({ name, commits }))
      .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

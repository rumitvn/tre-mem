/**
 * Best-effort: recover the branch that was just merged from a merge commit's
 * subject line. Git does not pass the merged branch name to a `post-merge` hook,
 * so this parses the conventional merge-commit subjects produced by `git merge`,
 * `git pull`, and GitHub's "Merge pull request" — covering every provider without
 * any API. Returns null when the subject is not a recognizable merge.
 */
export function mergedBranchFromSubject(subject: string): string | null {
  const s = subject.trim();

  // GitHub merge-commit strategy: "Merge pull request #42 from owner/feature/x"
  const pr = s.match(/^Merge pull request #\d+ from (.+)$/);
  if (pr?.[1]) return afterFirstSlash(pr[1].trim());

  // "Merge remote-tracking branch 'origin/feature/x'[ into main]"
  const rt = s.match(/^Merge remote-tracking branch '([^']+)'/);
  if (rt?.[1]) return afterFirstSlash(rt[1].trim());

  // Plain "Merge branch 'feature/x'[ of … ][ into main]" — local merge / pull
  const br = s.match(/^Merge branch '([^']+)'/);
  if (br?.[1]) return br[1].trim();

  return null;
}

/** `owner/feature/x` → `feature/x`; `main` → `main`. Strips one leading segment. */
function afterFirstSlash(ref: string): string {
  const i = ref.indexOf('/');
  return i === -1 ? ref : ref.slice(i + 1);
}

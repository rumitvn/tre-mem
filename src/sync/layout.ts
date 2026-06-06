import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Directory committed to the repo that carries shared pins + graduated facts. */
export const SYNC_DIR_NAME = '.tre-mem';

/**
 * Write a file atomically (temp file + rename) so a crash mid-write can never
 * leave a truncated JSONL file in the git working tree.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}

const README = `# .tre-mem/ — shared AI memory (tre-mem)

This directory is **committed to the repo** and travels through git. It carries the
team's pinned decisions and graduated facts so every teammate's AI assistant inherits
them on \`git clone\`.

- \`branches/<branch>.jsonl\` — pins scoped to a branch (append-only, one JSON per line)
- \`graduated.jsonl\` — facts promoted to repo-wide knowledge
- \`.shareignore\` — text patterns that block matching pins from being exported

## Workflow

\`\`\`bash
tre share           # one command: write your pins here + git add/commit/push to your team
# teammates: git pull — the SessionStart hook auto-imports; or run \`tre import\`
\`\`\`

\`tre share\` works with any git remote (GitHub, GitLab, Bitbucket, a plain bare repo).
Raw observations stay private on each machine — only pins + graduated facts are shared.
Sharing is fail-closed: it refuses to write detected secrets unless you pass \`--force\`.

\`.gitattributes\` sets \`*.jsonl merge=union\` so two teammates sharing at once never
hit a real merge conflict — git keeps both sides and \`tre import\` de-dupes on read.

See the format spec: https://github.com/rumitvn/tre-mem/blob/main/docs/SYNC-FORMAT.md
`;

/**
 * `merge=union` makes git auto-resolve concurrent appends to the append-only JSONL
 * files by keeping both sides. Lines are independent JSON records and `tre import`
 * de-dupes on content_hash, so "keep both" can never corrupt the shared memory.
 */
const GITATTRIBUTES = `# tre-mem shared memory — keep both sides on concurrent edits.
# Records are append-only, independent JSON lines; tre import de-dupes on content_hash.
*.jsonl merge=union
`;

const SHAREIGNORE = `# .shareignore — block pins from being exported to this shared directory.
# One glob per line; matched against a pin's note + title + body (case-insensitive).
# Examples:
# *password*
# *internal-only*
# *do-not-share*
`;

/** Create README.md + a starter .shareignore + .gitattributes in the sync dir if missing. */
export function ensureSyncScaffold(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const readme = join(dir, 'README.md');
  if (!existsSync(readme)) writeFileSync(readme, README, 'utf8');
  const shareignore = join(dir, '.shareignore');
  if (!existsSync(shareignore)) writeFileSync(shareignore, SHAREIGNORE, 'utf8');
  ensureGitattributes(dir);
}

/**
 * Write `.tre-mem/.gitattributes` (`*.jsonl merge=union`) if missing. Split out so
 * `tre share` can backfill it for repos initialized before this existed. Returns
 * true when the file was created.
 */
export function ensureGitattributes(dir: string): boolean {
  const path = join(dir, '.gitattributes');
  if (existsSync(path)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, GITATTRIBUTES, 'utf8');
  return true;
}

/**
 * Filesystem-safe slug for a branch name. The original branch name is preserved
 * verbatim inside each JSONL row's `branch` field — this is only for filenames.
 * `feature/payment` → `feature-payment`.
 */
export function branchSlug(branch: string): string {
  const slug = branch.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'branch' : slug;
}

export function branchFilePath(dir: string, branch: string): string {
  return join(dir, 'branches', `${branchSlug(branch)}.jsonl`);
}

export function graduatedFilePath(dir: string): string {
  return join(dir, 'graduated.jsonl');
}

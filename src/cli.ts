#!/usr/bin/env node
import { cac } from 'cac';
import { basename, resolve } from 'node:path';

import { ClaudeMemAdapter } from './adapter/claude-mem.js';
import { backfill } from './git/backfill.js';
import { NO_GIT, currentBranch, isDetached } from './git/resolver.js';
import { migrate } from './store/migrate.js';
import { TRE_MEM_DB_PATH, TRE_MEM_HOME } from './store/paths.js';
import { TreMemRepo } from './store/repo.js';

interface BackfillFlags {
  project?: string;
  since?: string;
  limit?: string;
}

const cli = cac('tre');

cli
  .command('init', 'Initialize ~/.tre-mem/ and run schema migrations')
  .action(() => {
    const result = migrate();
    if (result.applied.length === 0) {
      console.log(`tre-mem: already at schema v${result.toVersion} (${result.dbPath})`);
    } else {
      console.log(
        `tre-mem: migrated ${result.dbPath} from v${result.fromVersion} -> v${result.toVersion}`,
      );
      console.log(`  applied: ${result.applied.join(', ')}`);
    }
    console.log(`  home: ${TRE_MEM_HOME}`);
    console.log(`  db:   ${TRE_MEM_DB_PATH}`);
  });

cli
  .command(
    'status [path]',
    'Show project / branch / tag counts for a working directory (defaults to cwd)',
  )
  .action(async (path?: string) => {
    const cwd = path ? resolve(path) : process.cwd();
    const project = basename(cwd);
    const branch = await currentBranch(cwd);

    console.log('tre-mem status:');
    console.log(`  cwd:     ${cwd}`);
    console.log(`  project: ${project}`);
    console.log(`  branch:  ${branch}`);

    migrate();
    const repo = new TreMemRepo();
    try {
      console.log(`  branch_tag rows (project): ${repo.countBranchTags(project)}`);
      const branches = repo.listBranchesForProject(project);
      if (branches.length > 0) {
        console.log('  branches with tags:');
        for (const b of branches) {
          console.log(`    - ${b.branch} (${b.count})`);
        }
      }
    } finally {
      repo.close();
    }

    try {
      const adapter = new ClaudeMemAdapter();
      try {
        const obs = adapter.getObservations({ project, limit: 1 });
        if (obs.length === 0) {
          console.log('  claude-mem observations: 0');
        } else {
          const head = obs[0];
          if (head) {
            console.log(`  claude-mem observations: >=1 (newest at ${head.created_at})`);
          }
        }
      } finally {
        adapter.close();
      }
    } catch (err) {
      console.log(`  claude-mem: ${(err as Error).message}`);
    }
  });

cli
  .command(
    'backfill [path]',
    'Backfill branch_tag for past observations via git reflog (defaults to cwd)',
  )
  .option('--project <slug>', 'Override project slug (defaults to basename of path)')
  .option('--since <epoch>', 'Only consider observations newer than this unix epoch')
  .option('--limit <n>', 'Limit number of observations to scan')
  .action(async (path: string | undefined, flags: BackfillFlags) => {
    const cwd = path ? resolve(path) : process.cwd();
    const project = flags.project ?? basename(cwd);
    const sinceEpoch = flags.since !== undefined ? Number.parseInt(flags.since, 10) : undefined;
    const limit = flags.limit !== undefined ? Number.parseInt(flags.limit, 10) : undefined;

    migrate();
    const cur = await currentBranch(cwd);
    const fallbackBranch =
      cur === NO_GIT || isDetached(cur) ? undefined : cur;
    const adapter = new ClaudeMemAdapter();
    const repo = new TreMemRepo();
    try {
      const result = await backfill({
        project,
        cwd,
        adapter,
        repo,
        sinceEpoch,
        limit,
        fallbackBranch,
      });
      console.log(`tre-mem backfill (${result.project}, ${result.cwd}):`);
      console.log(`  reflog transitions:    ${result.transitions}`);
      console.log(`  observations scanned:  ${result.scanned}`);
      console.log(`  tagged:                ${result.tagged}`);
      console.log(`  skipped (already):     ${result.skippedAlreadyTagged}`);
      console.log(`  skipped (no branch):   ${result.skippedNoBranch}`);
    } finally {
      adapter.close();
      repo.close();
    }
  });

cli.help();
cli.version(getPackageVersion());

try {
  cli.parse();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`tre: ${msg}`);
  process.exit(1);
}

function getPackageVersion(): string {
  return '0.0.0';
}

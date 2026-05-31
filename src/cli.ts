#!/usr/bin/env node
import { cac } from 'cac';
import { basename, resolve } from 'node:path';

import { ClaudeMemAdapter } from './adapter/claude-mem.js';
import { backfill } from './git/backfill.js';
import { NO_GIT, currentBranch, isDetached } from './git/resolver.js';
import { type SessionStartInput, runSessionStartHook } from './hooks/session-start.js';
import { runMcpServer } from './mcp/server.js';
import { searchBranchContext, type SearchHit } from './retrieval/search.js';
import { migrate } from './store/migrate.js';
import { TRE_MEM_DB_PATH, TRE_MEM_HOME } from './store/paths.js';
import { TreMemRepo } from './store/repo.js';

interface BackfillFlags {
  project?: string;
  since?: string;
  limit?: string;
}

const cli = cac('tre');

cli.command('init', 'Initialize ~/.tre-mem/ and run schema migrations').action(() => {
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
    const fallbackBranch = cur === NO_GIT || isDetached(cur) ? undefined : cur;
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

cli
  .command('hook <event>', 'Run a Claude Code hook (event=session-start). Reads JSON from stdin.')
  .action(async (event: string) => {
    if (event !== 'session-start') {
      process.stderr.write(`tre hook: unknown event "${event}" (supported: session-start)\n`);
      process.exit(2);
    }
    try {
      const input = await readSessionStartInput();
      migrate();
      const repo = new TreMemRepo();
      try {
        const result = await runSessionStartHook(input, { repo });
        const payload = {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: result.message,
          },
          systemMessage: result.message,
        };
        process.stdout.write(`${JSON.stringify(payload)}\n`);
      } finally {
        repo.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`tre hook session-start: ${msg}\n`);
      process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    }
  });

cli
  .command('search <query>', 'Run a 3-signal branch-aware search (top-K with score breakdown)')
  .option('--cwd <path>', 'Repo root to derive project + branch from (defaults to current dir)')
  .option('--project <slug>', 'Override project slug')
  .option('--branch <name>', 'Override branch (defaults to current branch in cwd)')
  .option('--k <n>', 'Number of results to return', { default: '10' })
  .action(
    async (
      query: string,
      flags: { cwd?: string; project?: string; branch?: string; k?: string | number },
    ) => {
      const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
      const project = flags.project ?? basename(cwd);
      const branch = flags.branch ?? (await currentBranch(cwd));
      const k = Number.parseInt(String(flags.k ?? 10), 10);

      migrate();
      const adapter = new ClaudeMemAdapter();
      const repo = new TreMemRepo();
      try {
        const hits = searchBranchContext({ adapter, repo }, { query, project, branch, k });
        printSearchHeader({ project, branch, query, k, hitCount: hits.length });
        if (hits.length === 0) {
          console.log('  (no matches)');
          return;
        }
        for (const hit of hits) {
          printSearchHit(hit);
        }
      } finally {
        adapter.close();
        repo.close();
      }
    },
  );

cli
  .command('pin <observationId>', 'Pin an observation to a branch (boosted to top of search)')
  .option('--cwd <path>', 'Repo root to derive project + branch from')
  .option('--project <slug>', 'Override project slug')
  .option('--branch <name>', 'Override branch')
  .option('--note <text>', 'Free-form note attached to the pin')
  .action(
    async (
      observationIdRaw: string,
      flags: { cwd?: string; project?: string; branch?: string; note?: string },
    ) => {
      const observationId = Number.parseInt(observationIdRaw, 10);
      if (!Number.isInteger(observationId) || observationId <= 0) {
        process.stderr.write(`tre pin: invalid observation id "${observationIdRaw}"\n`);
        process.exit(2);
      }
      const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
      const project = flags.project ?? basename(cwd);
      const branch = flags.branch ?? (await currentBranch(cwd));

      migrate();
      const repo = new TreMemRepo();
      try {
        const pin = repo.addPin({
          project,
          branch,
          observation_id: observationId,
          note: flags.note ?? null,
          created_at_epoch: Math.floor(Date.now() / 1000),
        });
        console.log(
          `tre-mem: pinned observation ${observationId} on ${project}/${branch} (pin id=${pin.id})`,
        );
        if (pin.note) console.log(`  note: ${pin.note}`);
      } finally {
        repo.close();
      }
    },
  );

cli
  .command('graduate <observationId>', 'Promote a branch fact to a project-wide graduated fact')
  .option('--cwd <path>', 'Repo root to derive project + branch from')
  .option('--project <slug>', 'Override project slug')
  .option('--branch <name>', 'Source branch the fact graduated from (defaults to current branch)')
  .action(
    async (
      observationIdRaw: string,
      flags: { cwd?: string; project?: string; branch?: string },
    ) => {
      const observationId = Number.parseInt(observationIdRaw, 10);
      if (!Number.isInteger(observationId) || observationId <= 0) {
        process.stderr.write(`tre graduate: invalid observation id "${observationIdRaw}"\n`);
        process.exit(2);
      }
      const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
      const project = flags.project ?? basename(cwd);
      const branch = flags.branch ?? (await currentBranch(cwd));

      migrate();
      const repo = new TreMemRepo();
      try {
        const g = repo.graduateFact({
          project,
          observation_id: observationId,
          graduated_from_branch: branch,
          graduated_at_epoch: Math.floor(Date.now() / 1000),
        });
        console.log(
          `tre-mem: graduated observation ${observationId} from ${project}/${branch} (graduated id=${g.id})`,
        );
      } finally {
        repo.close();
      }
    },
  );

cli
  .command('list-branches', 'List branches with tag counts for a project')
  .option('--cwd <path>', 'Repo root to derive project from')
  .option('--project <slug>', 'Override project slug')
  .action(async (flags: { cwd?: string; project?: string }) => {
    const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
    const project = flags.project ?? basename(cwd);

    migrate();
    const repo = new TreMemRepo();
    try {
      const branches = repo.listBranchesForProject(project);
      console.log(`tre-mem branches for ${project}:`);
      if (branches.length === 0) {
        console.log('  (none)');
        return;
      }
      const widest = branches.reduce((m, b) => Math.max(m, b.branch.length), 0);
      for (const b of branches) {
        console.log(`  ${b.branch.padEnd(widest)}  ${b.count}`);
      }
    } finally {
      repo.close();
    }
  });

cli.command('mcp', 'Start the tre-mem MCP server on stdio').action(async () => {
  await runMcpServer();
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

function printSearchHeader(info: {
  project: string;
  branch: string;
  query: string;
  k: number;
  hitCount: number;
}): void {
  console.log(`tre-mem search "${info.query}"`);
  console.log(`  project: ${info.project}`);
  console.log(`  branch:  ${info.branch}`);
  console.log(`  k:       ${info.k} (returned ${info.hitCount})`);
  console.log('');
}

function printSearchHit(hit: SearchHit): void {
  const obs = hit.observation;
  const title = obs.title ?? obs.subtitle ?? (obs.text ?? '').slice(0, 80) ?? '(untitled)';
  const total = hit.total.toFixed(3);
  const b = hit.breakdown;
  const breakdown = `sem ${b.semantic.toFixed(2)}  branch ${b.branch.toFixed(2)}  rec ${b.recency.toFixed(2)}  pin ${b.pin.toFixed(2)}`;
  console.log(`  [${total}] #${obs.id}  ${title}`);
  console.log(`         ${breakdown}`);
}

async function readSessionStartInput(): Promise<SessionStartInput> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as SessionStartInput;
    }
    return {};
  } catch {
    return {};
  }
}

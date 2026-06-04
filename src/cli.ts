#!/usr/bin/env node
import { cac } from 'cac';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { ClaudeMemAdapter } from './adapter/claude-mem.js';
import { backfill } from './git/backfill.js';
import { prHeadBranch } from './git/github.js';
import { gitAuthor } from './git/identity.js';
import { NO_GIT, currentBranch, isDetached } from './git/resolver.js';
import { type SessionStartInput, runSessionStartHook } from './hooks/session-start.js';
import { type UserPromptSubmitInput, runUserPromptSubmitHook } from './hooks/user-prompt-submit.js';
import { log, logError, logFilePath } from './log/logger.js';
import { readLogTail } from './log/read.js';
import { runMcpServer } from './mcp/server.js';
import { setupTool } from './setup.js';
import { searchBranchContext, type SearchHit } from './retrieval/search.js';
import { migrate } from './store/migrate.js';
import { SYNC_DIR_NAME, ensureSyncScaffold } from './sync/layout.js';
import { exportSync } from './sync/export.js';
import { graduateBranch } from './sync/graduate.js';
import { importDir } from './sync/import.js';
import { RedactionError } from './sync/redact.js';
import { loadShareignore } from './sync/shareignore.js';
import { AdapterSnapshotProvider } from './sync/snapshot.js';
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

      // Sync (Phase 2) status.
      const pins = repo.listPinsForProject(project);
      const sharedPins = pins.filter((p) => p.shared_at_epoch !== null).length;
      const pendingPins = pins.length - sharedPins;
      const graduatedCount = repo.listGraduated(project).length;
      const syncDir = resolve(cwd, SYNC_DIR_NAME);
      const hasSyncDir = existsSync(syncDir);
      console.log(
        `  shared: ${sharedPins} pin(s) exported / ${pendingPins} pending export / ${graduatedCount} graduated`,
      );
      console.log(`  .tre-mem/: ${hasSyncDir ? syncDir : '(not present — run `tre export`)'}`);
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
  .command(
    'hook <event>',
    'Run a Claude Code hook (event=session-start | user-prompt-submit). Reads JSON from stdin.',
  )
  .action(async (event: string) => {
    if (event === 'session-start') {
      await runSessionStartHookCli();
      return;
    }
    if (event === 'user-prompt-submit') {
      await runUserPromptSubmitHookCli();
      return;
    }
    process.stderr.write(
      `tre hook: unknown event "${event}" (supported: session-start, user-prompt-submit)\n`,
    );
    process.exit(2);
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

cli
  .command('export', 'Export pins + graduated facts to the committed .tre-mem/ directory')
  .option('--cwd <path>', 'Repo root to derive project + branch from (defaults to current dir)')
  .option('--project <slug>', 'Override project slug')
  .option('--branch <name>', 'Export a single branch (defaults to current branch)')
  .option('--all', 'Export every branch that has pins')
  .option('--out <dir>', 'Output directory (defaults to <cwd>/.tre-mem)')
  .option('--author <name>', 'Attribution (defaults to git config user.name)')
  .option(
    '--force',
    'Proceed past detected secrets by replacing them with [REDACTED:*] placeholders',
  )
  .option('--dry-run', 'Compute changes without writing files or marking pins shared')
  .action(
    async (flags: {
      cwd?: string;
      project?: string;
      branch?: string;
      all?: boolean;
      out?: string;
      author?: string;
      force?: boolean;
      dryRun?: boolean;
    }) => {
      const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
      const project = flags.project ?? basename(cwd);
      const dir = flags.out ? resolve(flags.out) : resolve(cwd, SYNC_DIR_NAME);
      const author = flags.author ?? (await gitAuthor(cwd));

      migrate();
      const adapter = new ClaudeMemAdapter();
      const repo = new TreMemRepo();
      try {
        let branches: string[];
        if (flags.all) {
          branches = repo.listPinBranches(project);
        } else if (flags.branch) {
          branches = [flags.branch];
        } else {
          const cur = await currentBranch(cwd);
          branches = cur === NO_GIT || isDetached(cur) ? repo.listPinBranches(project) : [cur];
        }

        let result;
        try {
          result = exportSync({
            repo,
            snapshots: new AdapterSnapshotProvider(adapter),
            project,
            dir,
            branches,
            now: Math.floor(Date.now() / 1000),
            author,
            shareignore: loadShareignore(dir),
            redact: flags.force ?? false,
            dryRun: flags.dryRun ?? false,
          });
        } catch (err) {
          if (err instanceof RedactionError) {
            log({
              level: 'warn',
              component: 'sync',
              event: 'export_redaction_blocked',
              fields: {
                project,
                matches: err.matches.length,
                rules: [...new Set(err.matches.map((m) => m.rule))],
              },
            });
            process.stderr.write(
              `tre export blocked: ${err.matches.length} potential secret(s):\n`,
            );
            for (const m of err.matches) {
              process.stderr.write(`  - ${m.rule} in ${m.field}: ${m.preview}\n`);
            }
            process.stderr.write(
              `  Fix the source, add a .tre-mem/.shareignore pattern, or re-run with --force.\n`,
            );
            process.exit(2);
          }
          throw err;
        }

        const tag = result.dryRun ? ' (dry-run)' : '';
        console.log(`tre-mem export${tag}: ${project} -> ${result.dir}`);
        let totalAdded = 0;
        for (const b of result.branches) {
          console.log(`  ${b.branch}: +${b.added} (${b.total} total) ${b.file}`);
          totalAdded += b.added;
        }
        console.log(`  graduated: +${result.graduated.added} (${result.graduated.total} total)`);
        totalAdded += result.graduated.added;
        if (result.ignored > 0) console.log(`  ignored (.shareignore): ${result.ignored}`);
        if (result.redacted > 0) console.log(`  redacted secrets: ${result.redacted}`);
        if (result.dryRun) {
          console.log(`  would add ${totalAdded} row(s); run without --dry-run to write.`);
        } else {
          if (totalAdded > 0) ensureSyncScaffold(result.dir);
          console.log(`  added ${totalAdded} row(s). Commit .tre-mem/ to share with your team.`);
        }
      } finally {
        adapter.close();
        repo.close();
      }
    },
  );

cli
  .command('import', "Import a teammate's committed .tre-mem/ into your local sidecar")
  .option('--cwd <path>', 'Repo root that holds the .tre-mem/ directory (defaults to current dir)')
  .option('--from <dir>', 'Directory to import (defaults to <cwd>/.tre-mem)')
  .option('--force', 'Re-import even if files are unchanged since the last import')
  .action(async (flags: { cwd?: string; from?: string; force?: boolean }) => {
    const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
    const dir = flags.from ? resolve(flags.from) : resolve(cwd, SYNC_DIR_NAME);

    migrate();
    const repo = new TreMemRepo();
    try {
      const result = importDir({
        repo,
        dir,
        now: Math.floor(Date.now() / 1000),
        force: flags.force ?? false,
      });
      console.log(`tre-mem import: ${result.dir}`);
      if (result.files.length === 0) {
        console.log('  (nothing to import — no .tre-mem/ directory found)');
        return;
      }
      for (const f of result.files) {
        if (f.unchanged) {
          console.log(`  ${f.file}: unchanged`);
        } else {
          const errs = f.errors > 0 ? `, ${f.errors} error(s)` : '';
          console.log(`  ${f.file}: +${f.inserted} new, ${f.duplicates} dup${errs}`);
        }
      }
      console.log(`  imported ${result.pins} pin(s), ${result.graduated} graduated fact(s).`);
    } finally {
      repo.close();
    }
  });

cli
  .command(
    'graduate-pr <ref>',
    "Promote a merged branch's pins to graduated.jsonl (ref = PR number or branch name)",
  )
  .option('--repo <owner/name>', 'GitHub repo for PR lookup (defaults to gh detection)')
  .option('--cwd <path>', 'Repo root that holds the .tre-mem/ directory (defaults to current dir)')
  .option('--dir <path>', 'Sync directory (defaults to <cwd>/.tre-mem)')
  .option('--branch <name>', 'Graduate this branch directly (skips PR lookup)')
  .option('--author <name>', 'Attribution (defaults to git config user.name)')
  .option('--dry-run', 'Compute changes without writing graduated.jsonl')
  .action(
    async (
      ref: string,
      flags: {
        repo?: string;
        cwd?: string;
        dir?: string;
        branch?: string;
        author?: string;
        dryRun?: boolean;
      },
    ) => {
      const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
      const dir = flags.dir ? resolve(flags.dir) : resolve(cwd, SYNC_DIR_NAME);

      let branch = flags.branch;
      if (!branch) {
        if (/^\d+$/.test(ref)) {
          branch = (await prHeadBranch(Number.parseInt(ref, 10), flags.repo)) ?? undefined;
          if (!branch) {
            process.stderr.write(
              `tre graduate-pr: could not resolve PR #${ref} to a branch (is gh installed + authed?). ` +
                `Pass --branch <name> to graduate directly.\n`,
            );
            process.exit(2);
          }
        } else {
          branch = ref; // non-numeric ref is treated as a branch name
        }
      }

      const author = flags.author ?? (await gitAuthor(cwd));
      const result = graduateBranch({
        dir,
        branch,
        now: Math.floor(Date.now() / 1000),
        author,
        dryRun: flags.dryRun ?? false,
      });

      const tag = result.dryRun ? ' (dry-run)' : '';
      console.log(`tre-mem graduate-pr${tag}: branch ${result.branch} -> ${result.file}`);
      console.log(`  graduated:        ${result.graduated}`);
      console.log(`  already graduated: ${result.alreadyGraduated}`);
      if (result.skippedFreeText > 0) {
        console.log(`  skipped (free-text pins): ${result.skippedFreeText}`);
      }
      if (!result.dryRun && result.graduated > 0) {
        console.log(`  commit ${SYNC_DIR_NAME}/graduated.jsonl to publish these repo-wide facts.`);
      }
    },
  );

cli
  .command('setup <tool>', 'Wire tre-mem into a tool (tool=claude-code; cursor/codex stubbed)')
  .option('--cwd <path>', 'Repo root to write config into (defaults to current dir)')
  .option('--with-action', 'Also write the .github graduate-on-merge workflow')
  .option(
    '--auto-inject',
    'Also wire the UserPromptSubmit hook (injects branch memory into prompts)',
  )
  .action((tool: string, flags: { cwd?: string; withAction?: boolean; autoInject?: boolean }) => {
    const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
    const result = setupTool(tool, cwd, {
      withAction: flags.withAction ?? false,
      autoInject: flags.autoInject ?? false,
    });
    console.log(result.message);
    if (result.settingsPath) console.log(`  settings: ${result.settingsPath}`);
    if (result.workflowPath && result.workflowAdded)
      console.log(`  workflow: ${result.workflowPath}`);
    if (!result.supported) process.exit(2);
  });

cli.command('mcp', 'Start the tre-mem MCP server on stdio').action(async () => {
  await runMcpServer();
});

interface LogsFlags {
  tail?: string | number;
  all?: boolean;
  level?: string;
  component?: string;
  path?: boolean;
  clear?: boolean;
}

cli
  .command('logs', 'Show the local diagnostics log (use --path / --all to collect & share)')
  .option('--tail <n>', 'Show the last N lines (0 = whole file)', { default: '50' })
  .option('--all', 'Show the whole file')
  .option('--level <lvl>', 'Only lines at >= level (debug|info|warn|error)')
  .option(
    '--component <name>',
    'Only lines from this component (hook|mcp|backfill|sync|git|store|cli)',
  )
  .option('--path', 'Print the resolved log file path and exit')
  .option('--clear', 'Truncate the log file (and remove the rotated .1 backup) and exit')
  .action((flags: LogsFlags) => {
    const file = logFilePath();

    if (flags.path) {
      console.log(file);
      return;
    }

    if (flags.clear) {
      writeFileSync(file, '', 'utf8');
      rmSync(`${file}.1`, { force: true });
      console.log(`tre-mem: cleared ${file}`);
      return;
    }

    const n = Number.parseInt(String(flags.tail ?? 50), 10);
    const result = readLogTail(file, {
      tail: n,
      all: flags.all ?? false,
      level: flags.level,
      component: flags.component,
    });
    if (!result.exists) {
      console.log(`(no log file yet at ${file})`);
      return;
    }
    for (const l of result.lines) console.log(l);
  });

cli.help();
cli.version(getPackageVersion());

try {
  cli.parse();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logError('cli', 'cli_error', err);
  console.error(`tre: ${msg}`);
  process.exit(1);
}

function getPackageVersion(): string {
  return '0.3.1';
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
  const tag =
    hit.source === 'shared-pin' ? ' [shared]' : hit.source === 'graduated' ? ' [graduated]' : '';
  const breakdown = `sem ${b.semantic.toFixed(2)}  branch ${b.branch.toFixed(2)}  rec ${b.recency.toFixed(2)}  grad ${b.graduated.toFixed(2)}  pin ${b.pin.toFixed(2)}`;
  console.log(`  [${total}] #${obs.id}  ${title}${tag}`);
  console.log(`         ${breakdown}`);
}

async function runSessionStartHookCli(): Promise<void> {
  try {
    const input = await readStdinJson<SessionStartInput>();
    migrate();
    const repo = new TreMemRepo();
    try {
      const result = await runSessionStartHook(input, { repo });
      process.stdout.write(
        `${JSON.stringify({
          continue: true,
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: result.message },
          systemMessage: result.message,
        })}\n`,
      );
    } finally {
      repo.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('hook', 'hook_error', err, { event: 'session-start' });
    process.stderr.write(`tre hook session-start: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  }
}

async function runUserPromptSubmitHookCli(): Promise<void> {
  try {
    const input = await readStdinJson<UserPromptSubmitInput>();
    migrate();
    const adapter = new ClaudeMemAdapter();
    const repo = new TreMemRepo();
    try {
      const result = await runUserPromptSubmitHook(input, {
        getHits: (args) => searchBranchContext({ adapter, repo }, { ...args, k: 5 }),
      });
      const payload =
        result.context === ''
          ? { continue: true }
          : {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext: result.context,
              },
            };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } finally {
      adapter.close();
      repo.close();
    }
  } catch (err) {
    // Never block a prompt — emit a silent continue on any failure.
    const msg = err instanceof Error ? err.message : String(err);
    logError('hook', 'hook_error', err, { event: 'user-prompt-submit' });
    process.stderr.write(`tre hook user-prompt-submit: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  }
}

async function readStdinJson<T>(): Promise<T> {
  if (process.stdin.isTTY) return {} as T;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {} as T;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

#!/usr/bin/env node
import { cac } from 'cac';
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { simpleGit } from 'simple-git';

import { ClaudeMemAdapter } from './adapter/claude-mem.js';
import { claudeMemGuidance, diagnoseClaudeMem, probeClaudeMemIngest } from './adapter/preflight.js';
import { BAMBOO, auto as theme, brand } from './format/colors.js';
import type { PinnedFact, RecentObs } from './format/digest.js';
import { backfill } from './git/backfill.js';
import { branchFromCiEnv, prHeadBranch } from './git/github.js';
import { gitAuthor } from './git/identity.js';
import { mergedBranchFromSubject } from './git/merge.js';
import { NO_GIT, currentBranch, isDetached } from './git/resolver.js';
import {
  type HookFormat,
  emptyEnvelope,
  parseHookFormat,
  promptEnvelope,
  sessionStartEnvelope,
} from './hooks/envelope.js';
import { type SessionStartInput, runSessionStartHook } from './hooks/session-start.js';
import { type UserPromptSubmitInput, runUserPromptSubmitHook } from './hooks/user-prompt-submit.js';
import { log, logError, logFilePath } from './log/logger.js';
import { readLogTail } from './log/read.js';
import { runMcpServer } from './mcp/server.js';
import { detectTools, installPostMergeHook, setupAll, setupTool } from './setup.js';
import { searchBranchContext, type SearchHit } from './retrieval/search.js';
import { migrate } from './store/migrate.js';
import { SYNC_DIR_NAME, ensureSyncScaffold } from './sync/layout.js';
import { exportSync, type SnapshotProvider } from './sync/export.js';
import { graduateBranch } from './sync/graduate.js';
import { importDir } from './sync/import.js';
import { RedactionError } from './sync/redact.js';
import { shareToGit, simpleGitShare } from './sync/share.js';
import { loadShareignore } from './sync/shareignore.js';
import { AdapterSnapshotProvider } from './sync/snapshot.js';
import { TRE_MEM_DB_PATH, TRE_MEM_HOME } from './store/paths.js';
import { TreMemRepo } from './store/repo.js';
import { VERSION } from './version.js';
import { clearDaemon, reconcileDaemon, stopDaemon, writeDaemon } from './web/daemon.js';
import { WEB_HOST, defaultPort, findAvailablePort } from './web/port.js';
import { runWebServer } from './web/server.js';

interface BackfillFlags {
  project?: string;
  since?: string;
  limit?: string;
}

/**
 * `tre export` publishes *curated* facts (pins + graduated), never the local
 * branch_tag index. When an export adds 0 rows, explain why and what to do —
 * the most common cause is "you have lots of tagged context but nothing pinned".
 */
function printNothingToExportHint(opts: {
  exportedBranches: ReadonlyArray<string>;
  projectPins: ReadonlyArray<{ branch: string; shared_at_epoch: number | null }>;
  graduatedCount: number;
}): void {
  const { exportedBranches, projectPins, graduatedCount } = opts;

  if (projectPins.length === 0 && graduatedCount === 0) {
    console.log('');
    console.log('  Nothing to share yet. `tre share` publishes the facts you curate —');
    console.log('  pinned + graduated facts — not the local branch index (your branch_tag');
    console.log('  rows stay on this machine). Curate something first, then run `tre share`:');
    console.log(
      `    ${theme.cyan('tre pin <observation-id>')}        mark a fact important for a branch`,
    );
    console.log(`    ${theme.cyan('tre graduate <observation-id>')}   promote a fact project-wide`);
    console.log('  (or use the pin_fact / graduate_fact MCP tools from Claude Code.)');
    console.log(
      `  Find ids with ${theme.cyan('tre search "<query>"')} or the get_branch_context MCP tool.`,
    );
    return;
  }

  const onExported = projectPins.filter((p) => exportedBranches.includes(p.branch));
  if (onExported.length === 0 && projectPins.length > 0) {
    console.log('');
    console.log(`  No pins on the current branch(es): ${exportedBranches.join(', ') || '(none)'}.`);
    console.log(
      `  ${projectPins.length} pin(s) live on other branches — run ${theme.cyan('tre share --all')} to include them.`,
    );
    return;
  }

  const pendingOnExported = onExported.filter((p) => p.shared_at_epoch === null).length;
  if (pendingOnExported === 0) {
    console.log('');
    console.log('  Everything is already shared — nothing new to add.');
  }
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

  const cm = diagnoseClaudeMem();
  if (!cm.installed || !cm.compatible) {
    console.log('');
    console.log(claudeMemGuidance(cm, theme.isColorSupported));
  } else {
    console.log(`  ${claudeMemGuidance(cm, theme.isColorSupported)}`);
    console.log(`  next: ${theme.cyan('tre backfill')} to branch-tag past observations`);
  }
});

cli.command('doctor', 'Diagnose claude-mem connectivity and tre-mem setup').action(() => {
  console.log(brand(theme)(`${BAMBOO} tre-mem doctor`));
  console.log(`  version: ${VERSION}`);
  console.log(`  home:    ${TRE_MEM_HOME}`);
  console.log(`  db:      ${TRE_MEM_DB_PATH}`);
  const cm = diagnoseClaudeMem();
  const mode = cm.installed && cm.compatible ? 'full' : 'shared-only';
  console.log(`  mode:    ${mode === 'full' ? theme.green('full') : theme.yellow('shared-only')}`);
  console.log('');
  console.log(claudeMemGuidance(cm, theme.isColorSupported));

  // Ingest health — installed ≠ ingesting. claude-mem ingests from the harnesses
  // it wired (Claude Code, Codex, Gemini, Cursor, Antigravity), into one shared DB;
  // the DB can exist yet hold no observations, in which case tre-mem is shared-only.
  if (cm.installed && cm.compatible) {
    const ingest = probeClaudeMemIngest();
    console.log('');
    if (!ingest || ingest.health === 'none') {
      console.log(
        theme.yellow('  ⚠ claude-mem is installed but has no observations yet — tre-mem will run'),
      );
      console.log(
        '    in shared-only mode until claude-mem ingests a session (any wired harness).',
      );
      console.log(
        `    (claude-mem ingests from Claude Code, Codex, Gemini, Cursor, Antigravity. See ${theme.cyan('docs/CROSS-TOOL.md')}.)`,
      );
    } else if (ingest.health === 'stale') {
      const days = Math.round(ingest.ageDays ?? 0);
      console.log(
        theme.yellow(
          `  ⚠ ${ingest.observations} observations, but newest is ${days}d old — ingest may have stopped.`,
        ),
      );
    } else {
      const days = Math.round(ingest.ageDays ?? 0);
      const when = days <= 0 ? 'today' : `${days}d ago`;
      console.log(
        theme.green(`  ✓ ingesting: ${ingest.observations} observations, newest ${when}.`),
      );
    }
  }
  process.exitCode = cm.installed && cm.compatible ? 0 : 1;
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
      if (pins.length === 0 && graduatedCount === 0) {
        console.log(
          `  shared: nothing curated yet — ${theme.cyan('tre pin <id>')} / ${theme.cyan('tre graduate <id>')}, then ${theme.cyan('tre share')}`,
        );
      } else {
        console.log(
          `  shared to git: ${sharedPins} pin(s) shared · ${pendingPins} not shared yet · ${graduatedCount} graduated`,
        );
        if (pendingPins > 0) {
          console.log(
            `    → run ${theme.cyan('tre share')} to push ${pendingPins} unshared pin(s) to your team`,
          );
        }
      }
      console.log(
        `  .tre-mem/: ${hasSyncDir ? `${syncDir} (travels through git)` : pins.length === 0 && graduatedCount === 0 ? '(not present — curate a fact first, then `tre share`)' : '(not present — run `tre share`)'}`,
      );

      // Cross-tool wiring (Phase 4): which harnesses are installed + wired.
      const present = detectTools(cwd).filter((t) => t.installed);
      if (present.length > 0) {
        const summary = present.map((t) => `${t.tool}${t.wired ? '✓' : '·'}`).join('  ');
        console.log(`  tools: ${summary}   ${theme.dim('(✓ wired · = run `tre setup <tool>`)')}`);
      }
    } finally {
      repo.close();
    }

    const cm = diagnoseClaudeMem();
    if (!cm.installed || !cm.compatible) {
      console.log('');
      console.log(claudeMemGuidance(cm, theme.isColorSupported));
      return;
    }
    const schema = cm.schemaVersion !== null ? `v${cm.schemaVersion}` : 'unknown';
    console.log(`  claude-mem: schema ${schema} (tested up to v${cm.testedSchema})`);
    if (cm.newerThanTested) {
      console.log(claudeMemGuidance(cm, theme.isColorSupported));
    }
    const adapter = new ClaudeMemAdapter();
    try {
      const obs = adapter.getObservations({ project, limit: 1 });
      const head = obs[0];
      console.log(
        head
          ? `  claude-mem observations: >=1 (newest at ${head.created_at})`
          : '  claude-mem observations: 0',
      );
    } finally {
      adapter.close();
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
    if (!ensureClaudeMemReady()) return;
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
    'Run a session hook (event=session-start | user-prompt-submit). Reads JSON from stdin.',
  )
  .option('--format <tool>', 'Output envelope: claude (default) | codex | gemini')
  .action(async (event: string, flags: { format?: string }) => {
    const format = parseHookFormat(flags.format);
    if (event === 'session-start') {
      await runSessionStartHookCli(format);
      return;
    }
    if (event === 'user-prompt-submit') {
      await runUserPromptSubmitHookCli(format);
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
      if (!ensureClaudeMemReady()) return;
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

interface ExportFlags {
  cwd?: string;
  project?: string;
  branch?: string;
  all?: boolean;
  out?: string;
  author?: string;
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Run the export half of sharing — write curated pins + graduated facts into
 * `.tre-mem/` and print the per-branch report. Returns the output dir + total rows
 * added, or null when claude-mem is unavailable. Reused by both `tre export` and
 * `tre share` so the two never drift. `quiet` suppresses the "commit to share" hint
 * (the `tre share` caller does the git step itself and prints its own next-step).
 */
async function runExport(
  flags: ExportFlags,
  opts: { quiet?: boolean } = {},
): Promise<{ dir: string; totalAdded: number; project: string } | null> {
  const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
  const project = flags.project ?? basename(cwd);
  const dir = flags.out ? resolve(flags.out) : resolve(cwd, SYNC_DIR_NAME);
  const author = flags.author ?? (await gitAuthor(cwd));

  migrate();
  // Sharing curated pins must work on any harness — claude-mem is OPTIONAL here.
  // When it is present we hydrate live observation snapshots; when it is absent
  // each pin falls back to its own stored title/body, so a teammate on Codex/Gemini
  // can still share. (Other commands that need raw observations still require it.)
  const cm = diagnoseClaudeMem();
  const claudeMemReady = cm.installed && cm.compatible;
  const adapter = claudeMemReady ? new ClaudeMemAdapter() : null;
  const snapshots: SnapshotProvider = adapter
    ? new AdapterSnapshotProvider(adapter)
    : { getSnapshots: () => new Map() };
  const repo = new TreMemRepo();
  try {
    if (!claudeMemReady) {
      console.log(
        `  ${theme.dim('claude-mem unavailable — sharing curated pins from the sidecar (snapshots limited).')}`,
      );
    }
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
        snapshots,
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
        process.stderr.write(`tre share blocked: ${err.matches.length} potential secret(s):\n`);
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
    } else if (totalAdded > 0) {
      ensureSyncScaffold(result.dir);
      if (!opts.quiet) {
        console.log(
          `  added ${totalAdded} row(s). Run ${theme.cyan('tre share')} to push them to your team's git.`,
        );
      } else {
        console.log(`  added ${totalAdded} row(s).`);
      }
    }
    if (totalAdded === 0) {
      printNothingToExportHint({
        exportedBranches: result.branches.map((b) => b.branch),
        projectPins: repo.listPinsForProject(project),
        graduatedCount: repo.listGraduated(project).length,
      });
    }
    return { dir: result.dir, totalAdded, project };
  } finally {
    adapter?.close();
    repo.close();
  }
}

cli
  .command('export', 'Write pins + graduated facts to .tre-mem/ (low-level; see `tre share`)')
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
  .action(async (flags: ExportFlags) => {
    await runExport(flags);
  });

cli
  .command('share', 'Push your memory to git: export pins + graduated facts, then commit + push')
  .option('--cwd <path>', 'Repo root to derive project + branch from (defaults to current dir)')
  .option('--project <slug>', 'Override project slug')
  .option('--branch <name>', 'Share a single branch (defaults to current branch)')
  .option('--all', 'Share every branch that has pins')
  .option('--out <dir>', 'Output directory (defaults to <cwd>/.tre-mem)')
  .option('--author <name>', 'Attribution (defaults to git config user.name)')
  .option('--message <msg>', 'Commit message (defaults to a generated summary)')
  .option('--no-push', 'Commit .tre-mem/ but do not push')
  .option('--no-commit', 'Stage .tre-mem/ but do not commit or push')
  .option(
    '--force',
    'Proceed past detected secrets by replacing them with [REDACTED:*] placeholders',
  )
  .option('--dry-run', 'Compute export changes without writing, committing, or pushing')
  .action(async (flags: ExportFlags & { message?: string; push?: boolean; commit?: boolean }) => {
    const exported = await runExport(flags, { quiet: true });
    if (exported === null) return; // claude-mem unavailable; runExport explained why
    if (flags.dryRun) {
      console.log(`  (dry-run) skipping git — re-run without --dry-run to commit + push.`);
      return;
    }

    const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
    // cac maps --no-push / --no-commit to push:false / commit:false (default true).
    const doCommit = flags.commit !== false;
    const doPush = flags.push !== false;
    const message =
      flags.message ??
      `chore(tre-mem): share ${exported.totalAdded} memory fact(s) for ${exported.project}`;

    let result;
    try {
      result = await shareToGit({
        git: simpleGitShare(cwd),
        dir: exported.dir,
        pathspec: SYNC_DIR_NAME,
        message,
        commit: doCommit,
        push: doPush,
      });
    } catch (err) {
      // Not a git repo / git missing: the export already landed on disk.
      process.stderr.write(
        `tre share: export written, but git steps were skipped (${err instanceof Error ? err.message.split('\n')[0] : 'git unavailable'}).\n` +
          `  Initialize git and run: git add ${SYNC_DIR_NAME} && git commit && git push\n`,
      );
      process.exit(2);
    }

    console.log('');
    if (result.note !== null && !result.committed && !result.pushed) {
      console.log(`tre-mem share: ${result.note}`);
    } else if (result.pushed) {
      console.log(
        `tre-mem share: ${theme.green('✓')} committed + pushed ${SYNC_DIR_NAME}/ to ${result.upstream} (${result.branch}).`,
      );
      console.log(
        `  Teammates get it on ${theme.cyan('git pull')} — the SessionStart hook auto-imports.`,
      );
    } else if (result.committed) {
      console.log(`tre-mem share: committed ${SYNC_DIR_NAME}/ on ${result.branch}.`);
      if (result.note) console.log(`  ${result.note}`);
      if (result.pushHint) console.log(`  To publish, run: ${theme.cyan(result.pushHint)}`);
    }
  });

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
          // Numeric ref = a GitHub PR number. Try gh, then fall back to CI env
          // vars (GitLab/Bitbucket pass the branch directly — no API needed).
          branch =
            (await prHeadBranch(Number.parseInt(ref, 10), flags.repo)) ??
            branchFromCiEnv() ??
            undefined;
          if (!branch) {
            process.stderr.write(
              `tre graduate-pr: could not resolve PR #${ref} to a branch.\n` +
                `  • On GitHub, install + auth the gh CLI, or\n` +
                `  • On GitLab/Bitbucket/any CI, run from the merge pipeline (branch is read from\n` +
                `    CI env), or\n` +
                `  • Pass --branch <name> to graduate a branch directly (works on any provider).\n`,
            );
            process.exit(2);
          }
        } else {
          branch = ref; // non-numeric ref is treated as a branch name (provider-agnostic)
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
  .command(
    'graduate-merge',
    "Graduate the just-merged branch's pins (designed for a post-merge git hook)",
  )
  .option('--cwd <path>', 'Repo root that holds the .tre-mem/ directory (defaults to current dir)')
  .option('--dir <path>', 'Sync directory (defaults to <cwd>/.tre-mem)')
  .option('--author <name>', 'Attribution (defaults to git config user.name)')
  .action(async (flags: { cwd?: string; dir?: string; author?: string }) => {
    const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
    const dir = flags.dir ? resolve(flags.dir) : resolve(cwd, SYNC_DIR_NAME);
    try {
      // A post-merge hook runs after `git merge`/`git pull`: HEAD is the merge
      // commit. Recover the merged branch from its subject — silent no-op when
      // HEAD is not a recognizable merge, so the hook never gets in the way.
      const subject = (await simpleGit(cwd).raw(['log', '-1', '--format=%s'])).trim();
      const branch = mergedBranchFromSubject(subject);
      if (branch === null) return;

      migrate();
      const author = flags.author ?? (await gitAuthor(cwd));
      const result = graduateBranch({
        dir,
        branch,
        now: Math.floor(Date.now() / 1000),
        author,
        dryRun: false,
      });
      if (result.graduated > 0) {
        console.log(`tre-mem: graduated ${result.graduated} fact(s) from merged branch ${branch}.`);
        console.log(
          `  run ${theme.cyan('tre share')} to publish ${SYNC_DIR_NAME}/graduated.jsonl to your team.`,
        );
      }
    } catch {
      // A hook must never block git — swallow everything.
    }
  });

cli
  .command(
    'setup [tool]',
    'Wire tre-mem into a tool (claude-code|codex|codex-desktop|gemini|cursor|antigravity | --all)',
  )
  .option('--all', 'Set up every installed harness (+ claude-code for this repo)')
  .option('--cwd <path>', 'Repo root to write config into (defaults to current dir)')
  .option(
    '--with-hook',
    'Also install a local post-merge git hook that graduates on merge (any provider, no CI)',
  )
  .option('--auto-inject', 'Also wire the prompt-time inject hook (Codex/Gemini/Claude)')
  .action(
    (
      tool: string | undefined,
      flags: {
        all?: boolean;
        cwd?: string;
        withHook?: boolean;
        autoInject?: boolean;
      },
    ) => {
      const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();
      const opts = {
        autoInject: flags.autoInject ?? false,
      };

      const reportHook = (): void => {
        if (!flags.withHook) return;
        const hook = installPostMergeHook(cwd);
        if (hook.status === 'created') {
          console.log(`  ✓ installed post-merge git hook: ${hook.path}`);
          console.log(`    graduates merged-branch pins locally — no CI, any git provider.`);
        } else if (hook.status === 'present') {
          console.log(`  · post-merge hook already wired: ${hook.path}`);
        } else if (hook.status === 'foreign') {
          console.log(
            `  ⚠ a post-merge hook already exists and isn't tre-mem's: ${hook.path}\n` +
              `    add this line yourself: tre graduate-merge >/dev/null 2>&1 || true`,
          );
        } else {
          console.log(`  · skipped post-merge hook — ${cwd} is not a git repo`);
        }
      };

      if (flags.all || tool === 'all') {
        const results = setupAll(cwd, opts);
        for (const r of results) {
          console.log(r.message);
          console.log('');
        }
        reportHook();
        return;
      }

      if (!tool) {
        console.error('tre setup: specify a tool or pass --all. See `tre setup --help`.');
        process.exit(2);
      }

      const result = setupTool(tool, cwd, opts);
      console.log(result.message);
      if (result.settingsPath) console.log(`  settings: ${result.settingsPath}`);
      reportHook();
      if (!result.supported) process.exit(2);
    },
  );

cli.command('mcp', 'Start the tre-mem MCP server on stdio').action(async () => {
  await runMcpServer();
});

interface WebFlags {
  background?: boolean;
  port?: string;
  open?: boolean;
}

cli
  .command('web [action]', 'Open the team memory dashboard (start | stop | status)')
  .option('--background', 'Run the dashboard server detached in the background')
  .option('--port <port>', 'Port to bind (default: TRE_MEM_WEB_PORT or 38700+uid)')
  .option('--no-open', 'Do not auto-open the browser')
  .action(async (action: string | undefined, flags: WebFlags) => {
    const cmd = action ?? 'start';
    const portFlag = flags.port ? Number.parseInt(flags.port, 10) : undefined;
    const port = portFlag !== undefined && Number.isInteger(portFlag) ? portFlag : undefined;

    if (cmd === 'status') {
      const info = reconcileDaemon();
      if (info) {
        console.log(
          `tre web: running (pid ${info.pid}) → ${theme.cyan(`http://127.0.0.1:${info.port}/`)}`,
        );
      } else {
        console.log('tre web: not running');
      }
      return;
    }

    if (cmd === 'stop') {
      const result = stopDaemon();
      console.log(
        result.stopped ? `tre web: stopped (pid ${result.pid})` : 'tre web: nothing to stop',
      );
      return;
    }

    // Hidden action used by the detached background child.
    if (cmd === '__serve') {
      const running = await runWebServer({ port, open: false });
      writeDaemon({
        pid: process.pid,
        port: running.port,
        startedAtEpoch: Math.floor(Date.now() / 1000),
      });
      const shutdown = (): void => {
        clearDaemon();
        void running.close().then(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return;
    }

    if (cmd !== 'start') {
      console.error(`tre web: unknown action "${cmd}" (use start | stop | status)`);
      process.exitCode = 1;
      return;
    }

    if (flags.background) {
      const existing = reconcileDaemon();
      if (existing) {
        console.log(
          `tre web: already running (pid ${existing.pid}) → http://127.0.0.1:${existing.port}/`,
        );
        return;
      }
      spawnWebDaemon(port);
      console.log('tre web: starting in background — check `tre web status` in a moment.');
      return;
    }

    const running = await runWebServer({ port, open: flags.open !== false });
    console.log(
      `${brand(theme)(`${BAMBOO} tre web`)}: ${theme.bold(running.mode)} mode → ${theme.cyan(running.url)}`,
    );
    console.log('  press Ctrl-C to stop.');
    const shutdown = (): void => {
      void running.close().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
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
  return VERSION;
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

/**
 * Print friendly guidance and flag a failing exit if claude-mem can't be read.
 * Returns true when the adapter is safe to open. Keeps commands stack-trace-free
 * for the most common first-run footgun (claude-mem not installed).
 */
function ensureClaudeMemReady(): boolean {
  const cm = diagnoseClaudeMem();
  if (!cm.installed || !cm.compatible) {
    console.error(claudeMemGuidance(cm, theme.isColorSupported));
    process.exitCode = 1;
    return false;
  }
  return true;
}

const RECENT_LIMIT = 8;

/**
 * Resolve the most-recent branch-tagged observations for the session digest,
 * preserving recency order. Throws if claude-mem is missing/incompatible (when
 * there are tags to resolve) — the hook catches it and degrades gracefully.
 */
function recentObservations(repo: TreMemRepo, project: string, branch: string): RecentObs[] {
  const tags = repo.listBranchTagsForBranch(project, branch, RECENT_LIMIT);
  if (tags.length === 0) return [];
  const adapter = new ClaudeMemAdapter();
  try {
    const ids = tags.map((t) => t.observation_id);
    const byId = new Map(adapter.getObservationsByIds(ids).map((o) => [o.id, o]));
    return ids
      .map((id) => byId.get(id))
      .filter((o): o is NonNullable<typeof o> => o !== undefined)
      .map((o) => ({
        id: o.id,
        type: o.type,
        title: o.title ?? o.subtitle ?? (o.text ? o.text.slice(0, 70) : null),
      }));
  } finally {
    adapter.close();
  }
}

/**
 * Resolve curated pins for the session digest. Resilient by design: prefers the
 * live observation title/type, but falls back to the pin's own snapshot so a
 * teammate's shared pin still renders even without claude-mem or the source
 * observation locally. Never throws — pins must not block a session.
 */
function pinnedFacts(repo: TreMemRepo, project: string, branch: string): PinnedFact[] {
  const pins = repo.listPinsForBranch(project, branch).slice(0, RECENT_LIMIT);
  if (pins.length === 0) return [];

  let byId = new Map<number, { type: string | null; title: string | null }>();
  const ids = pins.map((p) => p.observation_id).filter((id): id is number => id !== null);
  if (ids.length > 0) {
    try {
      const adapter = new ClaudeMemAdapter();
      try {
        byId = new Map(
          adapter
            .getObservationsByIds(ids)
            .map((o) => [o.id, { type: o.type, title: o.title ?? o.subtitle ?? null }]),
        );
      } finally {
        adapter.close();
      }
    } catch {
      /* claude-mem unavailable — fall back to pin snapshots below */
    }
  }

  return pins.map((p) => {
    const live = p.observation_id !== null ? byId.get(p.observation_id) : undefined;
    return {
      id: p.observation_id,
      type: live?.type ?? null,
      title: live?.title ?? p.title ?? null,
      note: p.note,
      shared: p.shared_at_epoch !== null,
    };
  });
}

async function runSessionStartHookCli(format: HookFormat): Promise<void> {
  try {
    const input = await readStdinJson<SessionStartInput>();
    migrate();
    const repo = new TreMemRepo();
    try {
      const dashboardUrl = (await ensureWebDashboard()) ?? undefined;
      const result = await runSessionStartHook(input, {
        repo,
        recent: ({ project, branch }) => recentObservations(repo, project, branch),
        pinned: ({ project, branch }) => pinnedFacts(repo, project, branch),
        dashboardUrl,
      });
      process.stdout.write(
        `${JSON.stringify(sessionStartEnvelope(format, result.message, result.display))}\n`,
      );
    } finally {
      repo.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('hook', 'hook_error', err, { event: 'session-start' });
    process.stderr.write(`tre hook session-start: ${msg}\n`);
    process.stdout.write(`${JSON.stringify(emptyEnvelope(format))}\n`);
  }
}

async function runUserPromptSubmitHookCli(format: HookFormat): Promise<void> {
  try {
    const input = await readStdinJson<UserPromptSubmitInput>();
    migrate();
    // claude-mem is optional here too — on a non-Claude-Code harness we inject
    // from shared pins + graduated only (adapter null → shared-only search).
    const cm = diagnoseClaudeMem();
    const adapter = cm.installed && cm.compatible ? new ClaudeMemAdapter() : null;
    const repo = new TreMemRepo();
    try {
      const result = await runUserPromptSubmitHook(input, {
        getHits: (args) => searchBranchContext({ adapter, repo }, { ...args, k: 5 }),
      });
      process.stdout.write(`${JSON.stringify(promptEnvelope(format, result.context))}\n`);
    } finally {
      adapter?.close();
      repo.close();
    }
  } catch (err) {
    // Never block a prompt — emit a silent continue on any failure.
    const msg = err instanceof Error ? err.message : String(err);
    logError('hook', 'hook_error', err, { event: 'user-prompt-submit' });
    process.stderr.write(`tre hook user-prompt-submit: ${msg}\n`);
    process.stdout.write(`${JSON.stringify(emptyEnvelope(format))}\n`);
  }
}

/** Spawn the detached background dashboard server (`web __serve`). */
function spawnWebDaemon(port?: number): void {
  const args = [process.argv[1] as string, 'web', '__serve'];
  if (port !== undefined) args.push('--port', String(port));
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

/**
 * Ensure the background dashboard is running and return its URL — auto-started
 * from the SessionStart hook so the live link surfaces like claude-mem's. A
 * single global daemon (one pidfile in ~/.tre-mem) serves every project, so this
 * is a fast no-op once it's up. Best-effort: returns null (never throws), and is
 * skipped in tests / CI / when TRE_MEM_WEB_AUTOSTART is turned off.
 */
async function ensureWebDashboard(): Promise<string | null> {
  const flag = (process.env.TRE_MEM_WEB_AUTOSTART ?? '').trim().toLowerCase();
  const disabled = flag === '0' || flag === 'false' || flag === 'off' || flag === 'no';
  if (disabled || process.env.VITEST) return null;
  if (process.env.CI && flag === '') return null; // off in CI unless explicitly enabled
  try {
    const existing = reconcileDaemon();
    if (existing) return `http://${WEB_HOST}:${existing.port}/`;
    const port = await findAvailablePort(defaultPort(), WEB_HOST);
    spawnWebDaemon(port);
    return `http://${WEB_HOST}:${port}/`;
  } catch {
    return null; // a convenience link must never break the hook
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

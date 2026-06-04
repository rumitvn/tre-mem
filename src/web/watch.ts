import chokidar, { type FSWatcher } from 'chokidar';
import { join } from 'node:path';

import { GitWatcher } from '../git/watcher.js';
import { log } from '../log/logger.js';
import type { TreMemRepo } from '../store/repo.js';
import { SYNC_DIR_NAME } from '../sync/layout.js';

import type { SseHub } from './sse.js';

const SIDECAR_POLL_MS = 2000;

export interface WatchOptions {
  cwd: string;
  project: string;
  repo: TreMemRepo;
  sse: SseHub;
  now: () => number;
  pollMs?: number;
}

export interface WebWatchers {
  stop: () => Promise<void>;
}

/** Cheap fingerprint of the sidecar for this project — detects external writes. */
function sidecarFingerprint(repo: TreMemRepo, project: string): string {
  const tags = repo.countBranchTags(project);
  const pins = repo.listPinsForProject(project).length;
  const grad = repo.listGraduated(project).length;
  return `${tags}:${pins}:${grad}`;
}

/**
 * Wire the three live-update sources to SSE:
 *  - `.git/HEAD` (reuse GitWatcher) → branch-changed
 *  - `.tre-mem/` dir (chokidar)     → team-memory-changed
 *  - sidecar count poll             → sidecar-changed (catches CLI writes elsewhere)
 */
export async function startWatchers(opts: WatchOptions): Promise<WebWatchers> {
  const { cwd, project, repo, sse, now } = opts;

  const gitWatcher = new GitWatcher({
    cwd,
    project,
    repo,
    now,
    onSync: (branch) => sse.broadcast({ event: 'branch-changed', data: { branch } }),
  });
  await gitWatcher.start();

  let syncWatcher: FSWatcher | null = null;
  const syncDir = join(cwd, SYNC_DIR_NAME);
  syncWatcher = chokidar.watch(syncDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  const onSyncChange = (): void => {
    sse.broadcast({ event: 'team-memory-changed', data: {} });
  };
  syncWatcher.on('add', onSyncChange);
  syncWatcher.on('change', onSyncChange);
  syncWatcher.on('unlink', onSyncChange);

  let fingerprint = sidecarFingerprint(repo, project);
  const poll = setInterval(() => {
    try {
      const next = sidecarFingerprint(repo, project);
      if (next !== fingerprint) {
        fingerprint = next;
        sse.broadcast({ event: 'sidecar-changed', data: {} });
      }
    } catch {
      /* transient DB lock — retry next tick */
    }
  }, opts.pollMs ?? SIDECAR_POLL_MS);
  poll.unref?.();

  log({ level: 'info', component: 'web', event: 'watch_start', fields: { project } });

  return {
    stop: async (): Promise<void> => {
      clearInterval(poll);
      await gitWatcher.stop();
      if (syncWatcher) await syncWatcher.close();
    },
  };
}

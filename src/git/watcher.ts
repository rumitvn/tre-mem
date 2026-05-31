import chokidar, { type FSWatcher } from 'chokidar';
import { join } from 'node:path';

import type { TreMemRepo } from '../store/repo.js';

import { currentBranch } from './resolver.js';

export interface WatcherOptions {
  cwd: string;
  project: string;
  repo: TreMemRepo;
  now?: () => number;
  onSync?: (branch: string) => void;
}

export class GitWatcher {
  private watcher: FSWatcher | null = null;
  private readonly headPath: string;
  private readonly now: () => number;

  constructor(private readonly opts: WatcherOptions) {
    this.headPath = join(opts.cwd, '.git', 'HEAD');
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async start(): Promise<void> {
    await this.sync();
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.headPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });
    const handler = (): void => {
      void this.sync();
    };
    this.watcher.on('change', handler);
    this.watcher.on('add', handler);
  }

  async sync(): Promise<string> {
    const branch = await currentBranch(this.opts.cwd);
    this.opts.repo.upsertBranchState({
      cwd: this.opts.cwd,
      project: this.opts.project,
      current_branch: branch,
      updated_at_epoch: this.now(),
    });
    this.opts.onSync?.(branch);
    return branch;
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;
    await this.watcher.close();
    this.watcher = null;
  }
}

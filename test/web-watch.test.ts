import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../src/store/migrate.js';
import { TreMemRepo } from '../src/store/repo.js';
import { SseHub } from '../src/web/sse.js';
import { startWatchers, type WebWatchers } from '../src/web/watch.js';

function captureHub(): { hub: SseHub; frames: string[] } {
  const hub = new SseHub();
  const frames: string[] = [];
  const res = {
    writeHead: () => {},
    write: (chunk: string) => {
      frames.push(chunk);
      return true;
    },
    end: () => {},
    on: () => {},
  };
  hub.add(res as never);
  return { hub, frames };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('web watchers → SSE', () => {
  let tmp: string;
  let repo: TreMemRepo;
  let watchers: WebWatchers | null = null;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tre-web-watch-'));
    const dbPath = join(tmp, 'tre-mem.db');
    migrate(dbPath);
    repo = new TreMemRepo({ dbPath });
  });

  afterEach(async () => {
    if (watchers) await watchers.stop();
    watchers = null;
    repo.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('broadcasts sidecar-changed when a pin appears (external write)', async () => {
    const { hub, frames } = captureHub();
    watchers = await startWatchers({
      cwd: tmp,
      project: 'demo',
      repo,
      sse: hub,
      now: () => 1,
      pollMs: 25,
    });

    repo.addPin({ project: 'demo', branch: 'main', observation_id: 7, created_at_epoch: 10 });

    // wait for at least one poll tick past the write
    for (let i = 0; i < 20 && !frames.join('').includes('sidecar-changed'); i += 1) {
      await wait(20);
    }
    expect(frames.join('')).toContain('sidecar-changed');
  });

  it('emits branch-changed on initial git sync', async () => {
    const { hub, frames } = captureHub();
    watchers = await startWatchers({
      cwd: tmp,
      project: 'demo',
      repo,
      sse: hub,
      now: () => 1,
      pollMs: 1000,
    });
    // GitWatcher.start() runs an initial sync → onSync → branch-changed
    expect(frames.join('')).toContain('branch-changed');
  });
});

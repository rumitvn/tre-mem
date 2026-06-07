#!/usr/bin/env node
/**
 * seed-demo — build a self-contained, throwaway tre-mem environment for demo
 * screenshots and video guides. NOTHING here touches your real ~/.tre-mem or
 * ~/.claude-mem: everything lands under a demo home you pass in.
 *
 *   pnpm build            # needs dist/ (this script imports the compiled store)
 *   pnpm demo:seed                       # → ./demo-env
 *   node scripts/seed-demo.mjs --home /tmp/tre-demo --force
 *
 * Then drive the demo against that env (the two vars are the ONLY wiring):
 *
 *   export TRE_MEM_HOME=$PWD/demo-env/.tre-mem
 *   export CLAUDE_MEM_HOME=$PWD/demo-env/.claude-mem
 *   tre status
 *   (cd demo-env/repos/shop && tre status)   # branch-aware view
 *   tre web                                   # dashboard for screenshots
 *
 * Re-run with --force to rebuild from scratch.
 */
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from '../dist/store/migrate.js';
import { TreMemRepo } from '../dist/store/repo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const homeArg = argv.indexOf('--home');
const HOME = resolve(homeArg >= 0 ? argv[homeArg + 1] : join(REPO_ROOT, 'demo-env'));
const FORCE = argv.includes('--force');

// Guard: never let the demo home collide with a real install.
if (HOME === resolve(process.env.HOME ?? '', '.tre-mem') || HOME.endsWith('/.tre-mem')) {
  console.error(`refusing to seed into ${HOME} — pass a fresh --home dir, not a real install`);
  process.exit(1);
}

const TRE_HOME = join(HOME, '.tre-mem');
const CM_HOME = join(HOME, '.claude-mem');
const TRE_DB = join(TRE_HOME, 'tre-mem.db');
const CM_DB = join(CM_HOME, 'claude-mem.db');
const REPO_DIR = join(HOME, 'repos', 'shop');

if (existsSync(HOME)) {
  if (!FORCE) {
    console.error(`${HOME} already exists — pass --force to rebuild it.`);
    process.exit(1);
  }
  rmSync(HOME, { recursive: true, force: true });
}
mkdirSync(TRE_HOME, { recursive: true });
mkdirSync(CM_HOME, { recursive: true });

// ── demo timeline (deterministic-ish, relative to "now" so it reads as recent) ─
const PROJECT = 'shop';
const REMOTE = 'github.com/acme/shop';
const nowMs = Date.now();
const DAY = 86_400_000;
const ago = (days, hours = 0) => nowMs - days * DAY - hours * 3_600_000;
const sec = (ms) => Math.floor(ms / 1000);
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const AUTHORS = {
  alice: 'Alice Nguyen <alice@acme.dev>',
  bob: 'Bob Tran <bob@acme.dev>',
  carol: 'Carol Pham <carol@acme.dev>',
};

/**
 * The demo memory. `id` is the claude-mem observation id; branch + type drive
 * the tre-mem sidecar (tags, icons). Spread across branches and time so the
 * dashboard graph and recent lists look alive.
 */
const OBS = [
  // main — foundational decisions
  {
    id: 1001,
    branch: 'main',
    type: 'decision',
    author: 'alice',
    at: ago(21),
    title: 'Adopt Stripe for payments over PayPal',
    files: ['docs/adr/0007-payments.md'],
  },
  {
    id: 1002,
    branch: 'main',
    type: 'discovery',
    author: 'bob',
    at: ago(20, 3),
    title: 'Cart totals computed in two places — consolidate into pricing service',
    files: ['src/cart/total.ts', 'src/checkout/summary.ts'],
  },
  {
    id: 1003,
    branch: 'main',
    type: 'decision',
    author: 'alice',
    at: ago(18),
    title: 'Search runs on Postgres FTS now; revisit OpenSearch past 1M SKUs',
    files: ['docs/adr/0009-search.md'],
  },
  {
    id: 1004,
    branch: 'main',
    type: 'security_note',
    author: 'carol',
    at: ago(17, 6),
    title: 'Webhook endpoints must verify Stripe signature before parsing body',
    files: ['src/payments/webhook.ts'],
  },

  // feature/payment
  {
    id: 1010,
    branch: 'feature/payment',
    type: 'feature',
    author: 'alice',
    at: ago(6),
    title: 'Stripe PaymentIntent flow with 3DS fallback',
    files: ['src/payments/intent.ts'],
  },
  {
    id: 1011,
    branch: 'feature/payment',
    type: 'decision',
    author: 'alice',
    at: ago(5, 4),
    title: 'Use Stripe webhook v3 — idempotency keys on the order id',
    files: ['src/payments/webhook.ts'],
  },
  {
    id: 1012,
    branch: 'feature/payment',
    type: 'bugfix',
    author: 'bob',
    at: ago(4, 2),
    title: 'Double-charge on retry: guard with idempotency key',
    files: ['src/payments/intent.ts'],
  },
  {
    id: 1013,
    branch: 'feature/payment',
    type: 'security_note',
    author: 'carol',
    at: ago(3, 8),
    title: 'Never log full PAN — Stripe tokens only in events',
    files: ['src/payments/log.ts'],
  },
  {
    id: 1014,
    branch: 'feature/payment',
    type: 'change',
    author: 'alice',
    at: ago(2, 1),
    title: 'Refund path wired to the same idempotency strategy',
    files: ['src/payments/refund.ts'],
  },

  // feature/search
  {
    id: 1020,
    branch: 'feature/search',
    type: 'feature',
    author: 'bob',
    at: ago(7),
    title: 'Typeahead search with Postgres trigram index',
    files: ['src/search/typeahead.ts'],
  },
  {
    id: 1021,
    branch: 'feature/search',
    type: 'discovery',
    author: 'bob',
    at: ago(5, 5),
    title: 'GIN index cut p95 query from 240ms to 18ms',
    files: ['migrations/0042_trgm.sql'],
  },
  {
    id: 1022,
    branch: 'feature/search',
    type: 'refactor',
    author: 'carol',
    at: ago(3, 3),
    title: 'Extract ranking into a pure scorer for testability',
    files: ['src/search/rank.ts'],
  },
  {
    id: 1023,
    branch: 'feature/search',
    type: 'change',
    author: 'bob',
    at: ago(1, 6),
    title: 'Debounce typeahead at 120ms; cancel in-flight on new keystroke',
    files: ['src/search/typeahead.ts'],
  },

  // fix/cart-flicker
  {
    id: 1030,
    branch: 'fix/cart-flicker',
    type: 'bugfix',
    author: 'carol',
    at: ago(2, 4),
    title: 'Cart badge flickers on optimistic add — snapshot then reconcile',
    files: ['src/cart/badge.tsx'],
  },
  {
    id: 1031,
    branch: 'fix/cart-flicker',
    type: 'discovery',
    author: 'carol',
    at: ago(1, 2),
    title: 'Flicker traced to a key remount on quantity change',
    files: ['src/cart/list.tsx'],
  },
];

// ── 1) claude-mem.db (the read-only source tre-mem builds on) ─────────────────
console.log(`building mock claude-mem.db → ${CM_DB}`);
const cm = new Database(CM_DB);
cm.pragma('journal_mode = WAL');
cm.exec(`
  CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at_epoch INTEGER NOT NULL);
  CREATE TABLE observations (
    id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT NOT NULL,
    text TEXT, type TEXT, title TEXT, subtitle TEXT, facts TEXT, narrative TEXT,
    concepts TEXT, files_read TEXT, files_modified TEXT, prompt_number INTEGER,
    created_at TEXT, created_at_epoch INTEGER
  );
  CREATE TABLE session_summaries (
    id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT,
    investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT,
    files_read TEXT, files_edited TEXT, notes TEXT, prompt_number INTEGER,
    created_at TEXT, created_at_epoch INTEGER
  );
  CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT, created_at_epoch INTEGER);
  CREATE TABLE pending_messages (id INTEGER PRIMARY KEY, project TEXT, created_at_epoch INTEGER);
  CREATE VIRTUAL TABLE observations_fts USING fts5(title, text, subtitle, facts, narrative);
`);
// claude-mem records applied migrations; MAX(version) is its effective schema.
const cmVer = cm.prepare('INSERT INTO schema_versions(version, applied_at_epoch) VALUES (?, ?)');
for (let v = 1; v <= 32; v++) cmVer.run(v, sec(ago(30)));

const insObs = cm.prepare(`
  INSERT INTO observations
    (id, memory_session_id, project, text, type, title, subtitle, facts, narrative,
     concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch)
  VALUES (@id, @sid, @project, @text, @type, @title, @subtitle, @facts, @narrative,
          @concepts, @files_read, @files_modified, @prompt_number, @created_at, @created_at_epoch)`);
const insFts = cm.prepare(
  'INSERT INTO observations_fts(rowid, title, text, subtitle, facts, narrative) VALUES (?,?,?,?,?,?)',
);
const seedObs = cm.transaction(() => {
  let n = 0;
  for (const o of OBS) {
    const text = `${o.title}. Worked on ${o.branch} touching ${o.files.join(', ')}.`;
    const facts = JSON.stringify([o.title, `branch: ${o.branch}`, `files: ${o.files.join(', ')}`]);
    const narrative = `${o.title} — captured while working on ${PROJECT}/${o.branch}.`;
    insObs.run({
      id: o.id,
      sid: `sess-${o.branch}-${o.id}`,
      project: PROJECT,
      text,
      type: o.type,
      title: o.title,
      subtitle: `${o.branch} · ${o.type}`,
      facts,
      narrative,
      concepts: JSON.stringify(['demo', o.type]),
      files_read: JSON.stringify(o.files),
      files_modified: JSON.stringify(o.files),
      prompt_number: ++n,
      created_at: new Date(o.at).toISOString(),
      created_at_epoch: o.at, // ms — adapter detects + normalizes to seconds
    });
    insFts.run(o.id, o.title, text, `${o.branch} · ${o.type}`, facts, narrative);
  }
});
seedObs();
cm.close();
console.log(`  ✓ ${OBS.length} observations across 4 branches`);

// ── 2) tre-mem.db sidecar (branch tags, pins, graduated, branch_state) ────────
console.log(`building tre-mem sidecar → ${TRE_DB}`);
migrate(TRE_DB);
const repo = new TreMemRepo({ dbPath: TRE_DB });

// branch tags: every observation, tagged on its branch
const tagTx = () => {
  for (const o of OBS) {
    repo.upsertBranchTag({
      observation_id: o.id,
      project: PROJECT,
      branch: o.branch,
      tagged_at_epoch: sec(o.at),
      source: 'live',
    });
  }
};
tagTx();

// pins (curated decisions). Some already shared with the team ([shared] badge).
const PINS = [
  {
    obs: 1011,
    branch: 'feature/payment',
    note: 'Stripe webhook v3 + idempotency on order id — do NOT downgrade',
    shared: true,
  },
  {
    obs: 1013,
    branch: 'feature/payment',
    note: 'PCI: tokens only in logs, never the PAN',
    shared: true,
  },
  {
    obs: 1021,
    branch: 'feature/search',
    note: 'GIN trigram index is why search is fast — keep the migration',
    shared: true,
  },
  {
    obs: 1012,
    branch: 'feature/payment',
    note: 'Retry guard lives in intent.ts; mirror it in refund.ts',
    shared: false,
  },
  {
    obs: 1031,
    branch: 'fix/cart-flicker',
    note: 'Stable list keys fixed the flicker; watch quantity remounts',
    shared: false,
  },
];
for (const p of PINS) {
  const pin = repo.addPin({
    project: PROJECT,
    branch: p.branch,
    observation_id: p.obs,
    note: p.note,
    created_at_epoch: sec(ago(2)),
  });
  if (p.shared) repo.markPinShared(pin.id, hash(`pin:${p.obs}:${p.note}`), sec(ago(1)));
}

// graduated facts (branch knowledge promoted project-wide on merge), all shared
const GRADS = [
  { obs: 1004, from: 'main' },
  { obs: 1011, from: 'feature/payment' },
  { obs: 1021, from: 'feature/search' },
];
for (const g of GRADS) {
  const grad = repo.graduateFact({
    project: PROJECT,
    observation_id: g.obs,
    graduated_from_branch: g.from,
    graduated_at_epoch: sec(ago(1, 2)),
  });
  repo.markGraduatedShared(grad.id, hash(`grad:${g.obs}`), sec(ago(1)));
}

// branch state: the primary clone + a linked clone (same remote → cross-clone union)
repo.upsertBranchState({
  cwd: REPO_DIR,
  project: PROJECT,
  current_branch: 'feature/payment',
  updated_at_epoch: sec(nowMs),
  remote: REMOTE,
});
repo.upsertBranchState({
  cwd: join(HOME, 'repos', 'shop-2'),
  project: PROJECT,
  current_branch: 'feature/search',
  updated_at_epoch: sec(ago(0, 2)),
  remote: REMOTE,
});
repo.close();
console.log(`  ✓ ${OBS.length} tags · ${PINS.length} pins · ${GRADS.length} graduated · 2 clones`);

// ── 3) a tiny git repo so `tre status` detects the branch + contributors light up ─
function git(args, opts = {}) {
  execFileSync('git', args, { cwd: REPO_DIR, stdio: 'ignore', ...opts });
}
try {
  mkdirSync(REPO_DIR, { recursive: true });
  git(['init', '-q', '-b', 'main']);
  git(['remote', 'add', 'origin', `https://${REMOTE}.git`]);
  const commit = (author, msg) => {
    execFileSync('git', ['commit', '-q', '--allow-empty', '--author', author, '-m', msg], {
      cwd: REPO_DIR,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_COMMITTER_NAME: 'Demo Bot',
        GIT_COMMITTER_EMAIL: 'bot@acme.dev',
        GIT_AUTHOR_DATE: new Date(ago(3)).toISOString(),
        GIT_COMMITTER_DATE: new Date(ago(3)).toISOString(),
      },
    });
  };
  commit(AUTHORS.alice, 'feat(payments): Stripe PaymentIntent + 3DS');
  commit(AUTHORS.bob, 'feat(search): typeahead with trigram index');
  commit(AUTHORS.carol, 'fix(cart): stop badge flicker on optimistic add');
  commit(AUTHORS.alice, 'chore: payments webhook idempotency');
  git(['checkout', '-q', '-b', 'feature/payment']);
  console.log(`  ✓ demo git repo at ${REPO_DIR} (branch feature/payment, 3 authors)`);
} catch (err) {
  console.log(`  · skipped demo git repo (${err instanceof Error ? err.message : err})`);
}

// ── run instructions ──────────────────────────────────────────────────────────
console.log(`
✅ demo environment ready — fully isolated from your real install.

  export TRE_MEM_HOME="${TRE_HOME}"
  export CLAUDE_MEM_HOME="${CM_HOME}"

  tre status                                  # project + sharing overview
  (cd "${REPO_DIR}" && tre status)            # branch-aware (feature/payment)
  tre web                                      # dashboard → screenshots / video

Reset/rebuild any time:  pnpm demo:seed --force
Throw it away:           rm -rf "${HOME}"
`);

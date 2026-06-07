import type { GraduatedRecord, PinRecord } from '../sync/format.js';

/** Live facts only — grove never operates on tombstone records. */
type LiveRecord = PinRecord | GraduatedRecord;

/**
 * Grove = the contributor view of a repo's shared memory. Pure, HTTP-free
 * helpers so the aggregation, scoring, and graph-building can be unit-tested
 * directly. Contributor identity lives only in the committed `.tre-mem/` JSONL
 * (`author` per record) — never in the sidecar DB — so everything here reads
 * `SyncRecord`s produced by `readSyncRecords`.
 */

/** Branch-local pins count 1×; graduated (repo-wide, survived a merge) count 3×. */
export const PIN_WEIGHT = 1;
export const GRADUATED_WEIGHT = 3;

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

/** Bucket label for records whose author was never recorded (shared pre-attribution). */
export const UNATTRIBUTED = '(unattributed)';

export type BadgeId = 'gardener_of_week' | 'most_rooted' | 'longest_streak' | 'first_sprout';

export type GroveSource = 'shared' | 'git-fallback';

export interface ContributorStat {
  author: string;
  /** false only for the synthetic UNATTRIBUTED bucket. */
  attributed: boolean;
  pins: number;
  graduated: number;
  facts_total: number;
  /** Commits on touched branches — populated only in git-fallback mode. */
  commits: number;
  branches: string[];
  branches_touched: number;
  first_activity_epoch: number;
  last_activity_epoch: number;
  /** Longest run of consecutive UTC days with ≥1 contribution. */
  streak_days: number;
  value_score: number;
  breakdown: { pin: number; graduated: number };
  badges: BadgeId[];
}

export interface ContributorsResponse {
  project: string;
  source: GroveSource;
  contributors: ContributorStat[];
  attributed_total: number;
  unattributed_total: number;
  has_sync_dir: boolean;
}

export type GraphNodeKind = 'root' | 'branch' | 'contributor' | 'fact';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  factKind?: 'pin' | 'graduated';
  author?: string | null;
  branch?: string;
  observation_id?: number | null;
  epoch?: number;
  /** Relative sizing hint: contributor = value_score, branch = fact/commit count. */
  weight?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'authored' | 'lives_on' | 'graduates_into' | 'committed';
}

export interface GraphResponse {
  project: string;
  source: GroveSource;
  nodes: GraphNode[];
  edges: GraphEdge[];
  has_sync_dir: boolean;
}

interface Acc {
  author: string;
  attributed: boolean;
  pins: number;
  graduated: number;
  branches: Set<string>;
  epochs: number[];
}

function recordEpoch(r: LiveRecord): number {
  return r.kind === 'pin' ? r.tagged_at_epoch : r.graduated_at_epoch;
}

function recordBranch(r: LiveRecord): string {
  return r.kind === 'pin' ? r.branch : r.graduated_from_branch;
}

/** Longest run of consecutive UTC days that appears in the epoch list. */
function longestStreakDays(epochs: number[]): number {
  if (epochs.length === 0) return 0;
  const days = [...new Set(epochs.map((e) => Math.floor(e / DAY_SECONDS)))].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = days[i] === (days[i - 1] as number) + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Roll up the shared records into a per-author leaderboard, then assign the
 * playful "awards" (each badge goes to at most one contributor). Sorted by
 * value_score desc, tie-broken by most-recent activity.
 */
export function aggregateContributors(
  records: LiveRecord[],
  project: string,
  now: number,
): { contributors: ContributorStat[]; attributed_total: number; unattributed_total: number } {
  const scoped = records.filter((r) => r.project === project);
  const accs = new Map<string, Acc>();
  let attributed = 0;
  let unattributed = 0;

  for (const r of scoped) {
    const attributedRow = r.author !== null && r.author.trim() !== '';
    if (attributedRow) attributed += 1;
    else unattributed += 1;
    const author = attributedRow ? (r.author as string) : UNATTRIBUTED;
    let acc = accs.get(author);
    if (!acc) {
      acc = {
        author,
        attributed: attributedRow,
        pins: 0,
        graduated: 0,
        branches: new Set(),
        epochs: [],
      };
      accs.set(author, acc);
    }
    if (r.kind === 'pin') acc.pins += 1;
    else acc.graduated += 1;
    acc.branches.add(recordBranch(r));
    acc.epochs.push(recordEpoch(r));
  }

  const contributors: ContributorStat[] = [...accs.values()].map((a) => {
    const value_score = a.pins * PIN_WEIGHT + a.graduated * GRADUATED_WEIGHT;
    return {
      author: a.author,
      attributed: a.attributed,
      pins: a.pins,
      graduated: a.graduated,
      facts_total: a.pins + a.graduated,
      commits: 0,
      branches: [...a.branches].sort((x, y) => x.localeCompare(y)),
      branches_touched: a.branches.size,
      first_activity_epoch: Math.min(...a.epochs),
      last_activity_epoch: Math.max(...a.epochs),
      streak_days: longestStreakDays(a.epochs),
      value_score,
      breakdown: { pin: a.pins, graduated: a.graduated },
      badges: [],
    };
  });

  assignBadges(contributors, accs, now);
  contributors.sort(
    (a, b) => b.value_score - a.value_score || b.last_activity_epoch - a.last_activity_epoch,
  );
  return { contributors, attributed_total: attributed, unattributed_total: unattributed };
}

function assignBadges(contributors: ContributorStat[], accs: Map<string, Acc>, now: number): void {
  const eligible = contributors.filter((c) => c.attributed);
  if (eligible.length === 0) return;
  const byAuthor = new Map(contributors.map((c) => [c.author, c]));
  const award = (winner: ContributorStat | undefined, badge: BadgeId): void => {
    if (winner) winner.badges.push(badge);
  };

  // Gardener of the week — most contributions in the last 7 days.
  const weeklyScore = new Map<string, number>();
  for (const acc of accs.values()) {
    if (!acc.attributed) continue;
    const recent = acc.epochs.filter((e) => now - e <= WEEK_SECONDS).length;
    if (recent > 0) weeklyScore.set(acc.author, recent);
  }
  const topWeekly = [...weeklyScore.entries()].sort((a, b) => b[1] - a[1])[0];
  award(topWeekly ? byAuthor.get(topWeekly[0]) : undefined, 'gardener_of_week');

  // Most rooted — most graduated facts (must have at least one).
  const rooted = eligible
    .filter((c) => c.graduated > 0)
    .sort((a, b) => b.graduated - a.graduated || b.value_score - a.value_score)[0];
  award(rooted, 'most_rooted');

  // Longest streak — must be a real run (≥2 days).
  const streak = [...eligible].sort((a, b) => b.streak_days - a.streak_days)[0];
  if (streak && streak.streak_days >= 2) award(streak, 'longest_streak');

  // First sprout — earliest contributor.
  const firstSprout = [...eligible].sort(
    (a, b) => a.first_activity_epoch - b.first_activity_epoch,
  )[0];
  award(firstSprout, 'first_sprout');
}

/**
 * Build the force-graph from shared records. Node kinds: a single `root` (the
 * project trunk), one `branch` per branch, one `contributor` per distinct
 * author, and one `fact` per record. Edges wire authorship, where a fact lives,
 * and how branches graduate into the trunk.
 */
export function buildGraph(
  records: LiveRecord[],
  extraBranches: string[],
  project: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const scoped = records.filter((r) => r.project === project);
  const nodes: GraphNode[] = [{ id: 'root', kind: 'root', label: project }];
  const edges: GraphEdge[] = [];

  const branchFacts = new Map<string, number>();
  const contributorScore = new Map<string, number>();
  const seenFact = new Set<string>();

  for (const r of scoped) {
    const branch = recordBranch(r);
    branchFacts.set(branch, (branchFacts.get(branch) ?? 0) + 1);
    const factId = `fact:${r.content_hash}`;
    if (!seenFact.has(factId)) {
      seenFact.add(factId);
      nodes.push({
        id: factId,
        kind: 'fact',
        label: (r.title ??
          (r.kind === 'pin' ? r.note : null) ??
          r.content_hash.slice(0, 8)) as string,
        factKind: r.kind,
        author: r.author,
        branch,
        observation_id: r.observation_id,
        epoch: recordEpoch(r),
        weight: r.kind === 'graduated' ? GRADUATED_WEIGHT : PIN_WEIGHT,
      });
      edges.push({ source: factId, target: `branch:${branch}`, kind: 'lives_on' });
      if (r.author && r.author.trim() !== '') {
        const cid = `contributor:${r.author}`;
        edges.push({ source: cid, target: factId, kind: 'authored' });
        contributorScore.set(
          r.author,
          (contributorScore.get(r.author) ?? 0) +
            (r.kind === 'graduated' ? GRADUATED_WEIGHT : PIN_WEIGHT),
        );
      }
    }
  }

  const branchNames = new Set<string>([...branchFacts.keys(), ...extraBranches]);
  for (const branch of [...branchNames].sort((a, b) => a.localeCompare(b))) {
    nodes.push({
      id: `branch:${branch}`,
      kind: 'branch',
      label: branch,
      branch,
      weight: branchFacts.get(branch) ?? 0,
    });
    edges.push({ source: `branch:${branch}`, target: 'root', kind: 'graduates_into' });
  }

  for (const [author, score] of [...contributorScore.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    nodes.push({
      id: `contributor:${author}`,
      kind: 'contributor',
      label: author,
      author,
      weight: score,
    });
  }

  return { nodes, edges };
}

export interface BranchAuthors {
  branch: string;
  authors: Array<{ name: string; commits: number }>;
}

/**
 * Solo/unshared fallback: derive contributors from git commit authors per
 * branch when nothing has been shared yet. value_score is the commit count so
 * the leaderboard still ranks. These rows carry `commits` and zero facts.
 */
export function buildGitContributors(perBranch: BranchAuthors[], now: number): ContributorStat[] {
  const byAuthor = new Map<string, { commits: number; branches: Set<string> }>();
  for (const { branch, authors } of perBranch) {
    for (const { name, commits } of authors) {
      let acc = byAuthor.get(name);
      if (!acc) {
        acc = { commits: 0, branches: new Set() };
        byAuthor.set(name, acc);
      }
      acc.commits += commits;
      acc.branches.add(branch);
    }
  }
  const contributors: ContributorStat[] = [...byAuthor.entries()].map(([author, a]) => ({
    author,
    attributed: true,
    pins: 0,
    graduated: 0,
    facts_total: 0,
    commits: a.commits,
    branches: [...a.branches].sort((x, y) => x.localeCompare(y)),
    branches_touched: a.branches.size,
    first_activity_epoch: now,
    last_activity_epoch: now,
    streak_days: 0,
    value_score: a.commits,
    breakdown: { pin: 0, graduated: 0 },
    badges: [],
  }));
  contributors.sort((a, b) => b.value_score - a.value_score || a.author.localeCompare(b.author));
  if (contributors[0]) contributors[0].badges.push('most_rooted');
  return contributors;
}

/** Fallback graph: root + branches + contributors wired by `committed` edges. */
export function buildGitGraph(
  perBranch: BranchAuthors[],
  project: string,
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [{ id: 'root', kind: 'root', label: project }];
  const edges: GraphEdge[] = [];
  const contributorCommits = new Map<string, number>();

  for (const { branch, authors } of perBranch) {
    const total = authors.reduce((s, a) => s + a.commits, 0);
    nodes.push({ id: `branch:${branch}`, kind: 'branch', label: branch, branch, weight: total });
    edges.push({ source: `branch:${branch}`, target: 'root', kind: 'graduates_into' });
    for (const { name, commits } of authors) {
      edges.push({ source: `contributor:${name}`, target: `branch:${branch}`, kind: 'committed' });
      contributorCommits.set(name, (contributorCommits.get(name) ?? 0) + commits);
    }
  }
  for (const [author, commits] of [...contributorCommits.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    nodes.push({
      id: `contributor:${author}`,
      kind: 'contributor',
      label: author,
      author,
      weight: commits,
    });
  }
  return { nodes, edges };
}

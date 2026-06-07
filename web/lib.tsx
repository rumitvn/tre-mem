import { useCallback, useEffect, useState } from 'react';

/* ---- API types (mirror src/web/api.ts JSON) ------------------------- */

export type Mode = 'full' | 'shared-only';

export interface Health {
  ok: boolean;
  version: string;
  mode: Mode;
  project: string;
  cwd: string;
  remote: string | null;
  linked_clones: string[];
}

export interface BranchInfo {
  branch: string;
  count: number;
  pins: number;
  last_active_epoch: number | null;
}

export interface BranchesResponse {
  project: string;
  current_branch: string | null;
  branches: BranchInfo[];
  linked_clones: string[];
}

export interface Pin {
  id: number;
  branch: string;
  observation_id: number | null;
  note: string | null;
  title: string | null;
  body: string | null;
  created_at_epoch: number;
  shared: boolean;
  shared_at_epoch: number | null;
}

export interface Graduated {
  id: number;
  observation_id: number;
  from_branch: string;
  title: string | null;
  body: string | null;
  graduated_at_epoch: number;
  shared: boolean;
}

export interface TimelineEntry {
  observation_id: number;
  title: string | null;
  type: string | null;
  tagged_at_epoch: number;
  source: string;
}

export interface BranchDetail {
  project: string;
  branch: string;
  timeline: TimelineEntry[];
  pins: Pin[];
  graduated: Graduated[];
}

export interface ShareStatus {
  project: string;
  pending_export: number;
  shared_pins: number;
  total_pins: number;
  graduated: number;
  has_sync_dir: boolean;
}

export interface Breakdown {
  semantic: number;
  branch: number;
  recency: number;
  graduated: number;
  pin: number;
}

export type HitSource = 'observation' | 'shared-pin' | 'graduated';

export interface SearchHit {
  observation_id: number | null;
  title: string | null;
  type: string | null;
  snippet: string | null;
  source: HitSource;
  total: number;
  breakdown?: Breakdown;
}

export interface SearchResponse {
  project: string;
  branch: string;
  query: string;
  mode: Mode;
  hits: SearchHit[];
}

/* ---- grove (contributor graph + leaderboard) ------------------------ */

export type BadgeId = 'gardener_of_week' | 'most_rooted' | 'longest_streak' | 'first_sprout';
export type GroveSource = 'shared' | 'git-fallback';

export interface ContributorStat {
  author: string;
  attributed: boolean;
  pins: number;
  graduated: number;
  facts_total: number;
  commits: number;
  branches: string[];
  branches_touched: number;
  first_activity_epoch: number;
  last_activity_epoch: number;
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

export const BADGE_META: Record<BadgeId, { icon: string; label: string }> = {
  gardener_of_week: { icon: '🌱', label: 'Gardener of the week' },
  most_rooted: { icon: '🎋', label: 'Most rooted' },
  longest_streak: { icon: '🔥', label: 'Longest streak' },
  first_sprout: { icon: '🌿', label: 'First sprout' },
};

/* ---- fetching ------------------------------------------------------- */

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

export interface Async<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Fetch `path` (rebuilt whenever `key` changes), with a manual `reload`. */
export function useApi<T>(path: string | null, key: string): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Subscribe to the dashboard event stream; returns the live connection flag. */
export function useSse(onChange: (event: string) => void): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource('/api/events');
    const events = ['branch-changed', 'team-memory-changed', 'sidecar-changed'];
    const handler = (e: Event): void => onChange(e.type);
    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));
    for (const name of events) es.addEventListener(name, handler);
    return () => es.close();
  }, []);
  return connected;
}

/* ---- format helpers ------------------------------------------------- */

// Lightweight locale hook for timeAgo so the many existing call sites don't need
// to thread `lang` through. Set by the LanguageProvider whenever the language changes.
let timeLang: 'en' | 'vi' = 'en';
export function setTimeLang(lang: 'en' | 'vi'): void {
  timeLang = lang;
}

export function timeAgo(epochSeconds: number | null): string {
  if (!epochSeconds) return '—';
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  const units: Array<[number, string]> = [
    [60, 's'],
    [3600, 'm'],
    [86400, 'h'],
    [2592000, 'd'],
    [Infinity, 'mo'],
  ];
  let prev = 1;
  for (const [limit, label] of units) {
    if (secs < limit) {
      const v = `${Math.floor(secs / prev)}${label}`;
      return timeLang === 'vi' ? `${v} trước` : `${v} ago`;
    }
    prev = limit;
  }
  return timeLang === 'vi' ? 'vừa nãy' : 'just now';
}

export function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---- atoms ---------------------------------------------------------- */

export function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={clsx('badge', kind)}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

export function Skeletons({ n = 4 }: { n?: number }) {
  return (
    <div className="feed" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

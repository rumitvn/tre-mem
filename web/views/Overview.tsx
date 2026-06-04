import {
  Empty,
  Skeletons,
  clsx,
  timeAgo,
  useApi,
  type Async,
  type BranchesResponse,
  type ShareStatus,
} from '../lib.js';

interface OverviewProps {
  project: string;
  branches: Async<BranchesResponse>;
  refreshKey: string;
  onOpenBranch: (branch: string) => void;
}

export function Overview({ project, branches, refreshKey, onOpenBranch }: OverviewProps) {
  const q = `project=${encodeURIComponent(project)}`;
  const share = useApi<ShareStatus>(`/api/share-status?${q}`, refreshKey);

  const rows = branches.data?.branches ?? [];
  const maxCount = rows.reduce((m, b) => Math.max(m, b.count), 1);
  const current = branches.data?.current_branch ?? null;
  const s = share.data;

  return (
    <>
      <h1 className="lede">
        Shared <em>roots</em> for your codebase.
      </h1>
      <p className="sub">
        Every branch, every pinned decision, every fact that graduated to repo-wide knowledge — read
        straight from git. This is what your team knows about <strong>{project}</strong>.
      </p>

      <div className="stat-grid">
        <div className="stat" style={{ ['--spine' as string]: 'var(--branch)' }}>
          <div className="n">{rows.length}</div>
          <div className="k">branches with memory</div>
        </div>
        <div className="stat" style={{ ['--spine' as string]: 'var(--pin)' }}>
          <div className="n">{s ? s.total_pins : '—'}</div>
          <div className="k">pinned decisions</div>
        </div>
        <div className="stat" style={{ ['--spine' as string]: 'var(--growth)' }}>
          <div className="n">{s ? s.graduated : '—'}</div>
          <div className="k">graduated repo-wide</div>
        </div>
        <div className="stat" style={{ ['--spine' as string]: 'var(--warn)' }}>
          <div className="n">{s ? s.pending_export : '—'}</div>
          <div className="k">pins pending export</div>
        </div>
      </div>

      <div className="section-head">
        <h2>Branch graph</h2>
        <span className="hint">
          {s?.has_sync_dir ? '.tre-mem/ present — shared via git' : 'no .tre-mem/ yet — local only'}
        </span>
      </div>

      <div className="card branch-graph">
        {branches.loading ? (
          <Skeletons n={5} />
        ) : rows.length === 0 ? (
          <Empty
            title="No branch memory yet"
            hint="Run `tre backfill` to branch-tag past observations, then pin what matters."
          />
        ) : (
          rows.map((b) => {
            const isCurrent = b.branch === current;
            return (
              <button
                key={b.branch}
                className={clsx('branch-row', isCurrent && 'current')}
                onClick={() => onOpenBranch(b.branch)}
                aria-label={`Open branch ${b.branch}`}
              >
                <span className="branch-node" aria-hidden="true">
                  <i />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="branch-name">
                    <span className="label">{b.branch}</span>
                    {isCurrent ? <span className="you">HEAD</span> : null}
                  </span>
                  <span
                    className="barline"
                    style={{ ['--spine' as string]: isCurrent ? 'var(--bark)' : 'var(--branch)' }}
                  >
                    <i style={{ width: `${Math.round((b.count / maxCount) * 100)}%` }} />
                  </span>
                </span>
                <span className="branch-meta">
                  <span>
                    <b>{b.count}</b> tagged
                  </span>
                  <span>
                    <b>{b.pins}</b> pins
                  </span>
                  <span>{timeAgo(b.last_active_epoch)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

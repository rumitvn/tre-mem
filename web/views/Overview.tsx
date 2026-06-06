import { useI18n } from '../i18n.js';
import {
  Empty,
  Skeletons,
  clsx,
  timeAgo,
  useApi,
  type Async,
  type BranchesResponse,
  type ContributorsResponse,
  type ShareStatus,
} from '../lib.js';

interface OverviewProps {
  project: string;
  branches: Async<BranchesResponse>;
  refreshKey: string;
  onOpenBranch: (branch: string) => void;
  onOpenGrove: () => void;
}

export function Overview({
  project,
  branches,
  refreshKey,
  onOpenBranch,
  onOpenGrove,
}: OverviewProps) {
  const { t } = useI18n();
  const q = `project=${encodeURIComponent(project)}`;
  const share = useApi<ShareStatus>(`/api/share-status?${q}`, refreshKey);
  const contributors = useApi<ContributorsResponse>(`/api/contributors?${q}`, refreshKey);

  const rows = branches.data?.branches ?? [];
  const maxCount = rows.reduce((m, b) => Math.max(m, b.count), 1);
  const current = branches.data?.current_branch ?? null;
  const s = share.data;
  const cs = contributors.data;
  const topContributor = cs?.contributors[0] ?? null;

  return (
    <>
      <h1 className="lede">
        {t('ov.lede.a')} <em>{t('ov.lede.em')}</em>
        {t('ov.lede.b')}
      </h1>
      <p className="sub">
        {t('ov.sub.a')}
        <strong>{project}</strong>
        {t('ov.sub.b')}
      </p>

      <div className="stat-grid">
        <div className="stat" style={{ ['--spine' as string]: 'var(--branch)' }}>
          <div className="n">{rows.length}</div>
          <div className="k">{t('ov.stat.branches')}</div>
        </div>
        <div className="stat" style={{ ['--spine' as string]: 'var(--pin)' }}>
          <div className="n">{s ? s.total_pins : '—'}</div>
          <div className="k">{t('ov.stat.pins')}</div>
        </div>
        <div className="stat" style={{ ['--spine' as string]: 'var(--growth)' }}>
          <div className="n">{s ? s.graduated : '—'}</div>
          <div className="k">{t('ov.stat.graduated')}</div>
        </div>
        <div className="stat" style={{ ['--spine' as string]: 'var(--warn)' }}>
          <div className="n">{s ? s.pending_export : '—'}</div>
          <div className="k">{t('ov.stat.pending')}</div>
        </div>
      </div>

      <button className="grove-promo" onClick={onOpenGrove} aria-label={t('nav.grove')}>
        <span className="grove-promo-mark" aria-hidden="true">
          🎋
        </span>
        <span className="grove-promo-body">
          <span className="grove-promo-title">
            {t('ov.promo.a')}
            <em>{t('ov.promo.em')}</em>
          </span>
          <span className="grove-promo-sub">
            {topContributor
              ? t('ov.promo.lead', {
                  author: topContributor.author,
                  metric:
                    cs?.source === 'git-fallback'
                      ? t('metric.commits', { n: topContributor.commits })
                      : t('metric.score', { n: topContributor.value_score }),
                })
              : t('ov.promo.empty')}
          </span>
        </span>
        <span className="grove-promo-go" aria-hidden="true">
          →
        </span>
      </button>

      <div className="section-head">
        <h2>{t('ov.section.branchGraph')}</h2>
        <span className="hint">{s?.has_sync_dir ? t('ov.hint.synced') : t('ov.hint.local')}</span>
      </div>

      <div className="card branch-graph">
        {branches.loading ? (
          <Skeletons n={5} />
        ) : rows.length === 0 ? (
          <Empty title={t('ov.empty.title')} hint={t('ov.empty.hint')} />
        ) : (
          rows.map((b) => {
            const isCurrent = b.branch === current;
            return (
              <button
                key={b.branch}
                className={clsx('branch-row', isCurrent && 'current')}
                onClick={() => onOpenBranch(b.branch)}
                aria-label={b.branch}
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
                    <b>{b.count}</b> {t('branch.tagged')}
                  </span>
                  <span>
                    <b>{b.pins}</b> {t('branch.pins')}
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

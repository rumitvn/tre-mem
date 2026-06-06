import { useI18n } from '../i18n.js';
import {
  Badge,
  Empty,
  Skeletons,
  timeAgo,
  useApi,
  type BranchDetail as BranchDetailData,
} from '../lib.js';

interface BranchDetailProps {
  project: string;
  branch: string;
  refreshKey: string;
  onBack: () => void;
}

export function BranchDetail({ project, branch, refreshKey, onBack }: BranchDetailProps) {
  const { t } = useI18n();
  const q = `project=${encodeURIComponent(project)}`;
  const detail = useApi<BranchDetailData>(
    `/api/branch/${encodeURIComponent(branch)}?${q}`,
    `${refreshKey}:${branch}`,
  );
  const d = detail.data;

  return (
    <>
      <button className="icon-btn" onClick={onBack} style={{ marginBottom: '1rem' }}>
        {t('bd.back')}
      </button>
      <h1 className="lede" style={{ fontSize: 'var(--text-xl)' }}>
        <span className="mono">{branch}</span>
      </h1>
      <p className="sub">
        {t('bd.sub.a')}
        <strong>{project}</strong>
        {t('bd.sub.b')}
      </p>

      {detail.loading ? (
        <Skeletons n={4} />
      ) : !d ? (
        <Empty title={t('bd.notfound')} />
      ) : (
        <>
          <Section title={t('tm.pinned')} count={d.pins.length}>
            {d.pins.length === 0 ? (
              <Empty title={t('bd.pins.empty.title')} hint={t('bd.pins.empty.hint')} />
            ) : (
              <div className="feed">
                {d.pins.map((p) => (
                  <article key={p.id} className="entry pin">
                    <div className="entry-head">
                      <Badge kind="pin">{t('entry.pin')}</Badge>
                      <span className="entry-title">
                        {p.title ?? p.note ?? t('entry.pinnedfact')}
                      </span>
                      <Badge kind={p.shared ? 'graduated' : 'pending'}>
                        {p.shared ? t('entry.shared') : t('entry.local')}
                      </Badge>
                    </div>
                    {p.body && p.body !== p.title ? <p className="entry-body">{p.body}</p> : null}
                    <div className="entry-meta">
                      {p.observation_id !== null ? (
                        <span className="mono">#{p.observation_id}</span>
                      ) : (
                        <span>{t('entry.freetext')}</span>
                      )}
                      <span>{timeAgo(p.created_at_epoch)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Section>

          <Section title={t('bd.gradhere')} count={d.graduated.length}>
            {d.graduated.length === 0 ? (
              <Empty title={t('bd.gradhere.empty')} />
            ) : (
              <div className="feed">
                {d.graduated.map((g) => (
                  <article key={g.id} className="entry graduated">
                    <div className="entry-head">
                      <Badge kind="graduated">{t('entry.graduated')}</Badge>
                      <span className="entry-title">{g.title ?? `#${g.observation_id}`}</span>
                    </div>
                    {g.body ? <p className="entry-body">{g.body}</p> : null}
                    <div className="entry-meta">
                      <span className="mono">#{g.observation_id}</span>
                      <span>{timeAgo(g.graduated_at_epoch)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Section>

          <Section title={t('bd.activity')} count={d.timeline.length}>
            {d.timeline.length === 0 ? (
              <Empty title={t('bd.activity.empty')} />
            ) : (
              <div className="feed">
                {d.timeline.map((row) => (
                  <article key={row.observation_id} className="entry observation">
                    <div className="entry-head">
                      <Badge kind="observation">{row.type ?? t('entry.observation')}</Badge>
                      <span className="entry-title">{row.title ?? `#${row.observation_id}`}</span>
                    </div>
                    <div className="entry-meta">
                      <span className="mono">#{row.observation_id}</span>
                      <span>{row.source}</span>
                      <span>{timeAgo(row.tagged_at_epoch)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: '1.6rem' }}>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="hint">{count}</span>
      </div>
      {children}
    </section>
  );
}

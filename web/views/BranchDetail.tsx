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
  const q = `project=${encodeURIComponent(project)}`;
  const detail = useApi<BranchDetailData>(
    `/api/branch/${encodeURIComponent(branch)}?${q}`,
    `${refreshKey}:${branch}`,
  );
  const d = detail.data;

  return (
    <>
      <button className="icon-btn" onClick={onBack} style={{ marginBottom: '1rem' }}>
        ← branches
      </button>
      <h1 className="lede" style={{ fontSize: 'var(--text-xl)' }}>
        <span className="mono">{branch}</span>
      </h1>
      <p className="sub">
        Curated knowledge and tagged activity on this branch of <strong>{project}</strong>.
      </p>

      {detail.loading ? (
        <Skeletons n={4} />
      ) : !d ? (
        <Empty title="Branch not found" />
      ) : (
        <>
          <Section title="Pinned decisions" count={d.pins.length}>
            {d.pins.length === 0 ? (
              <Empty title="No pins on this branch" hint="Pin a fact to share it with the team." />
            ) : (
              <div className="feed">
                {d.pins.map((p) => (
                  <article key={p.id} className="entry pin">
                    <div className="entry-head">
                      <Badge kind="pin">pin</Badge>
                      <span className="entry-title">{p.title ?? p.note ?? '(pinned fact)'}</span>
                      <Badge kind={p.shared ? 'graduated' : 'pending'}>
                        {p.shared ? 'shared' : 'local'}
                      </Badge>
                    </div>
                    {p.body && p.body !== p.title ? <p className="entry-body">{p.body}</p> : null}
                    <div className="entry-meta">
                      {p.observation_id !== null ? (
                        <span className="mono">#{p.observation_id}</span>
                      ) : (
                        <span>free-text</span>
                      )}
                      <span>{timeAgo(p.created_at_epoch)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Section>

          <Section title="Graduated from here" count={d.graduated.length}>
            {d.graduated.length === 0 ? (
              <Empty title="Nothing graduated from this branch" />
            ) : (
              <div className="feed">
                {d.graduated.map((g) => (
                  <article key={g.id} className="entry graduated">
                    <div className="entry-head">
                      <Badge kind="graduated">graduated</Badge>
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

          <Section title="Tagged activity" count={d.timeline.length}>
            {d.timeline.length === 0 ? (
              <Empty title="No tagged observations" />
            ) : (
              <div className="feed">
                {d.timeline.map((t) => (
                  <article key={t.observation_id} className="entry observation">
                    <div className="entry-head">
                      <Badge kind="observation">{t.type ?? 'observation'}</Badge>
                      <span className="entry-title">{t.title ?? `#${t.observation_id}`}</span>
                    </div>
                    <div className="entry-meta">
                      <span className="mono">#{t.observation_id}</span>
                      <span>{t.source}</span>
                      <span>{timeAgo(t.tagged_at_epoch)}</span>
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

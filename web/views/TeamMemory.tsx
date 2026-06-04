import { Badge, Empty, Skeletons, timeAgo, useApi, type Graduated, type Pin } from '../lib.js';

interface TeamMemoryProps {
  project: string;
  refreshKey: string;
  onOpenBranch: (branch: string) => void;
}

interface PinsResponse {
  project: string;
  pins: Pin[];
}
interface GradResponse {
  project: string;
  graduated: Graduated[];
}

export function TeamMemory({ project, refreshKey, onOpenBranch }: TeamMemoryProps) {
  const q = `project=${encodeURIComponent(project)}`;
  const pins = useApi<PinsResponse>(`/api/pins?${q}`, refreshKey);
  const grad = useApi<GradResponse>(`/api/graduated?${q}`, refreshKey);

  const pinRows = pins.data?.pins ?? [];
  const gradRows = grad.data?.graduated ?? [];
  const loading = pins.loading || grad.loading;

  return (
    <>
      <h1 className="lede" style={{ fontSize: 'var(--text-xl)' }}>
        Team memory
      </h1>
      <p className="sub">
        What the team chose to remember about <strong>{project}</strong> — pinned decisions and the
        facts that graduated to repo-wide knowledge. Shared rows travel through git.
      </p>

      {loading ? (
        <Skeletons n={5} />
      ) : pinRows.length === 0 && gradRows.length === 0 ? (
        <Empty
          title="No shared memory yet"
          hint="Pin a decision, then `tre export` to share it with the team."
        />
      ) : (
        <>
          <div className="section-head">
            <h2>Pinned decisions</h2>
            <span className="hint">{pinRows.length}</span>
          </div>
          <div className="feed">
            {pinRows.map((p) => (
              <article key={p.id} className="entry pin">
                <div className="entry-head">
                  <Badge kind="pin">pin</Badge>
                  <span className="entry-title">{p.title ?? p.note ?? '(pinned fact)'}</span>
                  <Badge kind={p.shared ? 'graduated' : 'pending'}>
                    {p.shared ? 'shared' : 'pending export'}
                  </Badge>
                </div>
                {p.body && p.body !== p.title ? <p className="entry-body">{p.body}</p> : null}
                {p.note && p.note !== p.title ? (
                  <p className="entry-body">
                    <span className="who">note</span> · {p.note}
                  </p>
                ) : null}
                <div className="entry-meta">
                  <button className="who" onClick={() => onOpenBranch(p.branch)}>
                    {p.branch}
                  </button>
                  {p.observation_id !== null ? (
                    <span className="mono">#{p.observation_id}</span>
                  ) : null}
                  <span>{timeAgo(p.created_at_epoch)}</span>
                </div>
              </article>
            ))}
          </div>

          <div className="section-head" style={{ marginTop: '1.6rem' }}>
            <h2>Graduated facts</h2>
            <span className="hint">{gradRows.length}</span>
          </div>
          {gradRows.length === 0 ? (
            <Empty
              title="Nothing graduated yet"
              hint="Merge a PR (or `tre graduate`) to promote a fact repo-wide."
            />
          ) : (
            <div className="feed">
              {gradRows.map((g) => (
                <article key={g.id} className="entry graduated">
                  <div className="entry-head">
                    <Badge kind="graduated">graduated</Badge>
                    <span className="entry-title">{g.title ?? `#${g.observation_id}`}</span>
                  </div>
                  {g.body ? <p className="entry-body">{g.body}</p> : null}
                  <div className="entry-meta">
                    <span>from</span>
                    <button className="who" onClick={() => onOpenBranch(g.from_branch)}>
                      {g.from_branch}
                    </button>
                    <span>{timeAgo(g.graduated_at_epoch)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

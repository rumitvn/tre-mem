import { useEffect, useState } from 'react';

import { useI18n } from '../i18n.js';
import { Badge, Empty, clsx, api, type SearchResponse, type Breakdown } from '../lib.js';

interface SearchProps {
  project: string;
  branch: string | null;
}

const SIGNALS: Array<keyof Breakdown> = ['semantic', 'branch', 'recency', 'graduated', 'pin'];

export function Search({ project, branch }: SearchProps) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query === '') {
      setRes(null);
      return;
    }
    let live = true;
    setLoading(true);
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ q: query, project });
      if (branch) params.set('branch', branch);
      api<SearchResponse>(`/api/search?${params.toString()}`)
        .then((r) => live && setRes(r))
        .catch(() => live && setRes(null))
        .finally(() => live && setLoading(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [q, project, branch]);

  const hits = res?.hits ?? [];

  return (
    <>
      <h1 className="lede" style={{ fontSize: 'var(--text-xl)' }}>
        {t('s.title')}
      </h1>
      <p className="sub">
        {t('s.sub.a')}
        {branch ? (
          <>
            {t('s.sub.on')}
            <span className="mono">{branch}</span>
          </>
        ) : null}
        {t('s.sub.b')}
      </p>

      <div className="search-bar">
        <input
          className="search-input"
          type="search"
          placeholder={t('s.placeholder')}
          value={q}
          autoFocus
          aria-label={t('s.title')}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {res && res.mode === 'shared-only' ? (
        <p className="sub" style={{ marginTop: '-0.8rem' }}>
          {t('s.sharedonly')}
        </p>
      ) : null}

      {q.trim() === '' ? (
        <Empty title={t('s.empty.type.title')} hint={t('s.empty.type.hint')} />
      ) : loading && hits.length === 0 ? (
        <Empty title={t('s.searching')} />
      ) : hits.length === 0 ? (
        <Empty title={t('s.nomatch.title')} hint={t('s.nomatch.hint')} />
      ) : (
        <div className="feed">
          {hits.map((h, i) => (
            <article
              key={`${h.observation_id}-${i}`}
              className={clsx('entry', h.source.replace('shared-', ''))}
            >
              <div className="entry-head">
                <Badge kind={h.source === 'shared-pin' ? 'pin' : h.source}>{h.source}</Badge>
                <span className="entry-title">{h.title ?? `#${h.observation_id}`}</span>
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
                  {h.total.toFixed(2)}
                </span>
              </div>
              {h.snippet ? <p className="entry-body">{h.snippet}</p> : null}
              {h.breakdown ? (
                <div className="entry-meta">
                  <span className="score">
                    {SIGNALS.map((sig) => {
                      const v = h.breakdown![sig];
                      return (
                        <span key={sig} className={clsx('seg', v > 0 && 'on')} title={sig}>
                          {sig[0]}
                          {v.toFixed(1)}
                        </span>
                      );
                    })}
                  </span>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

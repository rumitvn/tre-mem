import { useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../i18n.js';
import { Empty, Skeletons, useApi, type ContributorsResponse, type GraphResponse } from '../lib.js';
import { GraphCanvas } from './GraphCanvas.js';
import { Leaderboard } from './Leaderboard.js';
import { ShareCard } from './ShareCard.js';

interface GroveProps {
  project: string;
  refreshKey: string;
  onOpenBranch: (branch: string) => void;
}

const TIMELAPSE_STEPS = 24;
const STEP_MS = 320;

export function Grove({ project, refreshKey, onOpenBranch }: GroveProps) {
  const { t } = useI18n();
  const q = `project=${encodeURIComponent(project)}`;
  const contributors = useApi<ContributorsResponse>(`/api/contributors?${q}`, refreshKey);
  const graph = useApi<GraphResponse>(`/api/graph?${q}`, refreshKey);

  const [selected, setSelected] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const factEpochs = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .filter((n) => n.kind === 'fact' && typeof n.epoch === 'number')
        .map((n) => n.epoch as number)
        .sort((a, b) => a - b),
    [graph.data],
  );
  const minE = factEpochs[0] ?? 0;
  const maxE = factEpochs[factEpochs.length - 1] ?? 0;
  const hasTimeline = factEpochs.length > 1 && maxE > minE;
  const span = maxE - minE || 1;

  // Time-lapse playback steps the cutoff from earliest to latest, then resets.
  useEffect(() => {
    if (!playing || !hasTimeline) return;
    timer.current = window.setInterval(() => {
      setCutoff((prev) => {
        const base = prev ?? minE;
        const next = base + span / TIMELAPSE_STEPS;
        if (next >= maxE) {
          setPlaying(false);
          return null; // snap back to the full, live grove
        }
        return next;
      });
    }, STEP_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, hasTimeline, minE, maxE, span]);

  const c = contributors.data;
  const g = graph.data;
  const loading = contributors.loading || graph.loading;
  const noFacts = (g?.nodes.filter((n) => n.kind === 'fact').length ?? 0) === 0;
  const noContributors = (c?.contributors.length ?? 0) === 0;

  const title = (
    <h1 className="lede">
      {t('grove.title.a')}
      <em>{t('grove.title.em')}</em>
    </h1>
  );

  if (loading && !c && !g) {
    return (
      <>
        {title}
        <Skeletons n={5} />
      </>
    );
  }

  if (g && noContributors && noFacts) {
    return (
      <>
        {title}
        <Empty title={t('grove.empty.title')} hint={t('grove.empty.hint')} />
      </>
    );
  }

  const factCount = g?.nodes.filter((n) => n.kind === 'fact').length ?? 0;
  const branchCount = g?.nodes.filter((n) => n.kind === 'branch').length ?? 0;

  return (
    <>
      <div className="section-head">
        {title}
        <div className="grove-actions">
          {c ? (
            <ShareCard
              project={project}
              contributors={c.contributors}
              source={c.source}
              facts={factCount}
              branches={branchCount}
            />
          ) : null}
        </div>
      </div>
      <p className="sub">
        {t('grove.sub.a')}
        <strong>{project}</strong>
        {t('grove.sub.b')}{' '}
        {c?.source === 'git-fallback' ? (
          <span className="badge warn">{t('grove.source.git')}</span>
        ) : c && c.unattributed_total > 0 ? (
          <span className="hint">
            {c.unattributed_total === 1
              ? t('grove.unattributed.one')
              : t('grove.unattributed', { n: c.unattributed_total })}
          </span>
        ) : null}
      </p>

      <div className="grove-layout">
        <div className="card grove-graph-card">
          {g ? (
            <GraphCanvas
              graph={g}
              highlight={selected}
              cutoffEpoch={cutoff}
              onOpenBranch={onOpenBranch}
              onSelectContributor={setSelected}
            />
          ) : (
            <Skeletons n={1} />
          )}
          {hasTimeline ? (
            <div className="timelapse" role="group" aria-label={t('timelapse.play')}>
              <button
                className="icon-btn"
                onClick={() => {
                  if (!playing && (cutoff === null || cutoff >= maxE)) setCutoff(minE);
                  setPlaying((p) => !p);
                }}
                aria-label={playing ? t('timelapse.pause') : t('timelapse.play')}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <input
                type="range"
                min={minE}
                max={maxE}
                step={Math.max(1, Math.floor(span / 200))}
                value={cutoff ?? maxE}
                onChange={(e) => {
                  setPlaying(false);
                  const v = Number(e.target.value);
                  setCutoff(v >= maxE ? null : v);
                }}
                aria-label={t('timelapse.play')}
              />
              <span className="timelapse-label">
                {cutoff === null ? t('timelapse.now') : t('timelapse.growing')}
              </span>
            </div>
          ) : null}
        </div>

        <div className="grove-board card">
          <div className="section-head">
            <h2>{t('grove.contributors')}</h2>
            <span className="hint">
              {c?.source === 'git-fallback' ? t('grove.by.commits') : t('grove.by.score')}
            </span>
          </div>
          {c && c.contributors.length > 0 ? (
            <Leaderboard
              contributors={c.contributors}
              source={c.source}
              selected={selected}
              onSelect={setSelected}
              onOpenBranch={onOpenBranch}
            />
          ) : (
            <Empty title={t('grove.board.empty.title')} hint={t('grove.board.empty.hint')} />
          )}
        </div>
      </div>
    </>
  );
}

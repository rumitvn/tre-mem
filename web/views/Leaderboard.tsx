import { useI18n } from '../i18n.js';
import { BADGE_META, clsx, timeAgo, type ContributorStat, type GroveSource } from '../lib.js';

interface LeaderboardProps {
  contributors: ContributorStat[];
  source: GroveSource;
  selected: string | null;
  onSelect: (author: string | null) => void;
  onOpenBranch: (branch: string) => void;
}

const RANK_SHOOT = ['🥇', '🥈', '🥉'];

export function Leaderboard({
  contributors,
  source,
  selected,
  onSelect,
  onOpenBranch,
}: LeaderboardProps) {
  const { t } = useI18n();
  const top = contributors[0]?.value_score ?? 1;
  const isGit = source === 'git-fallback';

  return (
    <div className="leaderboard">
      {contributors.map((c, i) => {
        const active = c.author === selected;
        const height = Math.max(6, Math.round((c.value_score / top) * 100));
        return (
          <div key={c.author} className={clsx('lb-card', active && 'active')}>
            <button
              className="lb-main"
              onClick={() => onSelect(active ? null : c.author)}
              aria-pressed={active}
              aria-label={c.author}
            >
              <span className="lb-rank" aria-hidden="true">
                {RANK_SHOOT[i] ?? `#${i + 1}`}
              </span>
              <span className="lb-culm" aria-hidden="true">
                <i style={{ height: `${height}%` }} />
              </span>
              <span className="lb-body">
                <span className="lb-name">
                  {c.author}
                  {!c.attributed ? <span className="lb-tag">{t('lb.unattributed')}</span> : null}
                </span>
                <span className="lb-stats">
                  {isGit ? (
                    <span>
                      <b>{c.commits}</b> {t('lb.commits')}
                    </span>
                  ) : (
                    <>
                      <span>
                        <b>{c.value_score}</b> {t('lb.score')}
                      </span>
                      <span>
                        <b>{c.pins}</b> {t('lb.pins')}
                      </span>
                      <span className="lb-rooted">
                        <b>{c.graduated}</b> {t('lb.rooted')}
                      </span>
                    </>
                  )}
                  <span>
                    <b>{c.branches_touched}</b>{' '}
                    {c.branches_touched === 1 ? t('lb.branch') : t('lb.branches')}
                  </span>
                  {!isGit ? (
                    <span className="lb-when">{timeAgo(c.last_activity_epoch)}</span>
                  ) : null}
                </span>
                {c.badges.length > 0 ? (
                  <span className="lb-badges">
                    {c.badges.map((b) => (
                      <span key={b} className="lb-badge" title={t(`badge.${b}`)}>
                        {BADGE_META[b].icon} {t(`badge.${b}`)}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
            {active && c.branches.length > 0 ? (
              <div className="lb-branches">
                {c.branches.map((b) => (
                  <button key={b} className="who" onClick={() => onOpenBranch(b)}>
                    {b}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

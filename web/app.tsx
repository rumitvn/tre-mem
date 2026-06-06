import { useCallback, useEffect, useState } from 'react';

import { useI18n } from './i18n.js';
import { clsx, useApi, useSse, type BranchesResponse, type Health } from './lib.js';
import { BranchDetail } from './views/BranchDetail.js';
import { Grove } from './views/Grove.js';
import { Overview } from './views/Overview.js';
import { Search } from './views/Search.js';
import { TeamMemory } from './views/TeamMemory.js';

type Tab = 'overview' | 'grove' | 'team' | 'search';

interface ProjectsResponse {
  current: string;
  projects: string[];
}

export function App() {
  const { t } = useI18n();
  const health = useApi<Health>('/api/health', 'init');
  const projects = useApi<ProjectsResponse>('/api/projects', 'init');

  const [project, setProject] = useState<string>('');
  const [tab, setTab] = useState<Tab>('overview');
  const [branch, setBranch] = useState<string | null>(null); // detail drill-down
  const [nonce, setNonce] = useState(0);
  const refreshKey = `${project}:${nonce}`;

  // Adopt the launched project once health resolves.
  useEffect(() => {
    if (health.data && project === '') setProject(health.data.project);
  }, [health.data, project]);

  const bump = useCallback(() => setNonce((n) => n + 1), []);
  const connected = useSse(bump);

  const branches = useApi<BranchesResponse>(
    project ? `/api/branches?project=${encodeURIComponent(project)}` : null,
    refreshKey,
  );
  const currentBranch = branches.data?.current_branch ?? null;

  const openBranch = useCallback((b: string) => {
    setBranch(b);
    setTab('overview');
  }, []);

  const go = useCallback((t: Tab) => {
    setBranch(null);
    setTab(t);
  }, []);

  const mode = health.data?.mode;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">
          <b>tre</b>
          <span>{t('wordmark.tagline')}</span>
        </div>
        <div className="topbar-spacer" />
        {mode ? <span className="mode-badge">{mode}</span> : null}
        {projects.data && projects.data.projects.length > 1 ? (
          <select
            className="select"
            value={project}
            aria-label="Project"
            onChange={(e) => {
              setProject(e.target.value);
              go('overview');
            }}
          >
            {projects.data.projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : null}
        <span
          className={clsx('dot', connected && 'live')}
          title={connected ? t('topbar.live') : t('topbar.disconnected')}
          aria-label={connected ? t('topbar.live') : t('topbar.disconnected')}
        />
        <LangToggle />
        <ThemeToggle />
      </header>

      <nav className="tabs" aria-label="Views">
        <button
          className="tab"
          aria-current={tab === 'overview' && !branch}
          onClick={() => go('overview')}
        >
          {t('nav.overview')}
        </button>
        <button className="tab" aria-current={tab === 'grove'} onClick={() => go('grove')}>
          {t('nav.grove')}
        </button>
        <button className="tab" aria-current={tab === 'team'} onClick={() => go('team')}>
          {t('nav.team')}
        </button>
        <button className="tab" aria-current={tab === 'search'} onClick={() => go('search')}>
          {t('nav.search')}
        </button>
      </nav>

      <main>
        {health.error ? (
          <p className="sub">{t('err.server', { error: health.error })}</p>
        ) : !project ? (
          <div className="skeleton" style={{ height: '6rem' }} />
        ) : branch ? (
          <BranchDetail
            project={project}
            branch={branch}
            refreshKey={refreshKey}
            onBack={() => setBranch(null)}
          />
        ) : tab === 'overview' ? (
          <Overview
            project={project}
            branches={branches}
            refreshKey={refreshKey}
            onOpenBranch={openBranch}
            onOpenGrove={() => go('grove')}
          />
        ) : tab === 'grove' ? (
          <Grove project={project} refreshKey={refreshKey} onOpenBranch={openBranch} />
        ) : tab === 'team' ? (
          <TeamMemory project={project} refreshKey={refreshKey} onOpenBranch={openBranch} />
        ) : (
          <Search project={project} branch={currentBranch} />
        )}
      </main>
    </div>
  );
}

function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.dataset.theme ?? 'light',
  );
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('tre-theme', next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  }, [theme]);
  return (
    <button
      className="icon-btn"
      onClick={toggle}
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

/** EN ⇄ VI toggle. Shows the language you'll switch TO. */
function LangToggle() {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'vi' ? 'en' : 'vi';
  return (
    <button
      className="icon-btn lang-toggle"
      onClick={() => setLang(next)}
      aria-label={t('lang.toggle')}
      title={t('lang.toggle')}
    >
      {lang === 'vi' ? 'VI' : 'EN'}
    </button>
  );
}

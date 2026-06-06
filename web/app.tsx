import { useCallback, useEffect, useState } from 'react';

import { clsx, useApi, useSse, type BranchesResponse, type Health } from './lib.js';
import { BranchDetail } from './views/BranchDetail.js';
import { Overview } from './views/Overview.js';
import { Search } from './views/Search.js';
import { TeamMemory } from './views/TeamMemory.js';

type Tab = 'overview' | 'team' | 'search';

interface ProjectsResponse {
  current: string;
  projects: string[];
}

export function App() {
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
          <BambooMark />
          <b>tre</b>
          <span>shared roots</span>
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
          title={connected ? 'live' : 'disconnected'}
          aria-label={connected ? 'live updates connected' : 'disconnected'}
        />
        <ThemeToggle />
      </header>

      <nav className="tabs" aria-label="Views">
        <button
          className="tab"
          aria-current={tab === 'overview' && !branch}
          onClick={() => go('overview')}
        >
          Overview
        </button>
        <button className="tab" aria-current={tab === 'team'} onClick={() => go('team')}>
          Team memory
        </button>
        <button className="tab" aria-current={tab === 'search'} onClick={() => go('search')}>
          Search
        </button>
      </nav>

      <main>
        {health.error ? (
          <p className="sub">Could not reach the dashboard server: {health.error}</p>
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
          />
        ) : tab === 'team' ? (
          <TeamMemory project={project} refreshKey={refreshKey} onOpenBranch={openBranch} />
        ) : (
          <Search project={project} branch={currentBranch} />
        )}
      </main>
    </div>
  );
}

/** A bamboo culm with two nodes (đốt tre) and a leaf — tre's mark, tinted --bamboo. */
function BambooMark() {
  return (
    <svg
      className="wordmark-mark"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d="M10 21 V4" />
        <path d="M7.5 8.5 H12.5" />
        <path d="M7.5 14.5 H12.5" />
      </g>
      <path d="M12 7 C16 5 19 6 20 8 C16 9.5 13 9 12 7 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ThemeToggle() {
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
    <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

import { type Palette, colors, forced } from './colors.js';
import { iconFor, legendLine } from './icons.js';

export interface RecentObs {
  id: number;
  type: string | null;
  title: string | null;
}

export interface SessionDigestParts {
  project: string;
  branch: string;
  source: string;
  /** Preformatted local time label (e.g. "1:44pm") — injected for testability. */
  timeLabel: string;
  taggedOnBranch: number;
  taggedOnProject: number;
  importedPins: number;
  importedGraduated: number;
  /** Most-recent branch-tagged observations (already resolved + ordered). */
  recent: RecentObs[];
  /** Optional trailing note (plain text), e.g. a claude-mem compatibility hint. */
  note?: string;
}

export interface SessionDigest {
  /** Colored, multi-line — for a hook's `systemMessage` (Claude Code renders ANSI). */
  display: string;
  /** Plain ASCII, no ANSI — for `additionalContext` (the model reads this). */
  context: string;
}

const TITLE_MAX = 70;
const RECENT_MAX = 8;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function render(parts: SessionDigestParts, c: Palette): string {
  const lines: string[] = [];

  lines.push(
    `${c.bold(c.cyan('[tre-mem] recent context'))} · ${c.bold(parts.branch)} · ${parts.project} · ${c.dim(
      parts.timeLabel,
    )}`,
  );
  lines.push(`${c.dim('Legend:')} ${legendLine()}`);

  let stats = `${c.bold('tagged:')} ${parts.taggedOnBranch} on branch · ${parts.taggedOnProject} on project`;
  if (parts.importedPins + parts.importedGraduated > 0) {
    stats += ` · imported: ${parts.importedPins}pin/${parts.importedGraduated}grad`;
  }
  stats += ` · ${c.dim(`source: ${parts.source}`)}`;
  lines.push(stats);

  lines.push('');
  const recent = parts.recent.slice(0, RECENT_MAX);
  if (recent.length === 0) {
    lines.push(c.dim('no branch-tagged observations yet — run `tre backfill`'));
  } else {
    for (const o of recent) {
      const { emoji } = iconFor(o.type);
      const title = truncate(o.title ?? '(untitled)', TITLE_MAX);
      lines.push(`${c.dim(`#${o.id}`)} ${emoji} ${title}`);
    }
  }

  if (parts.note && parts.note.trim() !== '') {
    lines.push('');
    lines.push(parts.note);
  }

  return lines.join('\n');
}

/** Build both the colored display string and the plain model-facing context. */
export function buildSessionDigest(parts: SessionDigestParts): SessionDigest {
  return {
    display: render(parts, forced),
    context: render(parts, colors(false)),
  };
}

/** Format an epoch (ms) as a compact local time label, e.g. "1:44pm". */
export function timeLabel(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')}${ampm}`;
}

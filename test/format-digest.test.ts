import { describe, expect, it } from 'vitest';

import { forced } from '../src/format/colors.js';
import { buildSessionDigest, timeLabel, type SessionDigestParts } from '../src/format/digest.js';
import { iconFor, legendLine } from '../src/format/icons.js';

const ESC = String.fromCharCode(27);

function base(overrides: Partial<SessionDigestParts> = {}): SessionDigestParts {
  return {
    project: 'tre-mem',
    branch: 'main',
    source: 'startup',
    timeLabel: '1:44pm',
    taggedOnBranch: 179,
    taggedOnProject: 232,
    importedPins: 0,
    importedGraduated: 0,
    recent: [],
    ...overrides,
  };
}

describe('buildSessionDigest', () => {
  it('renders header, legend, and stats in both display and context', () => {
    const { display, context } = buildSessionDigest(base());
    for (const out of [display, context]) {
      expect(out).toContain('[tre-mem] recent context');
      expect(out).toContain('main');
      expect(out).toContain('179 on branch');
      expect(out).toContain('232 on project');
      expect(out).toContain('source: startup');
      expect(out).toContain('1:44pm');
    }
  });

  it('keeps context plain ASCII while display carries color codes when enabled', () => {
    const { display, context } = buildSessionDigest(base());
    expect(context.includes(ESC)).toBe(false);
    if (forced.isColorSupported) expect(display.includes(ESC)).toBe(true);
  });

  it('lists recent observations with type emoji, newest first', () => {
    const { context } = buildSessionDigest(
      base({
        recent: [
          { id: 1882, type: 'refactor', title: 'Log utils extracted' },
          { id: 1880, type: 'feature', title: 'tre logs CLI command' },
        ],
      }),
    );
    expect(context).toContain('#1882 🔄 Log utils extracted');
    expect(context).toContain('#1880 🟣 tre logs CLI command');
  });

  it('shows a backfill hint when there are no recent observations', () => {
    const { context } = buildSessionDigest(base({ recent: [] }));
    expect(context).toContain('run `tre backfill`');
  });

  it('includes the imported counts only when something was imported', () => {
    expect(buildSessionDigest(base()).context).not.toContain('imported:');
    expect(buildSessionDigest(base({ importedPins: 1, importedGraduated: 2 })).context).toContain(
      'imported: 1pin/2grad',
    );
  });

  it('appends an optional note', () => {
    const { context } = buildSessionDigest(base({ note: 'run `tre doctor`' }));
    expect(context).toContain('run `tre doctor`');
  });

  it('truncates over-long titles', () => {
    const long = 'x'.repeat(200);
    const { context } = buildSessionDigest(
      base({ recent: [{ id: 1, type: 'change', title: long }] }),
    );
    expect(context).toContain('…');
    expect(context).not.toContain(long);
  });
});

describe('icons', () => {
  it('maps known types and falls back for unknown', () => {
    expect(iconFor('bugfix').emoji).toBe('🔴');
    expect(iconFor('FEATURE').emoji).toBe('🟣');
    expect(iconFor('totally-unknown').emoji).toBe('•');
    expect(iconFor(null).emoji).toBe('•');
  });

  it('legend line lists the core types', () => {
    const legend = legendLine();
    expect(legend).toContain('🔴bugfix');
    expect(legend).toContain('🟣feature');
    expect(legend).toContain('⚖️decision');
  });
});

describe('timeLabel', () => {
  it('formats 12-hour time with am/pm', () => {
    expect(timeLabel(new Date(2026, 5, 4, 13, 44))).toBe('1:44pm');
    expect(timeLabel(new Date(2026, 5, 4, 0, 5))).toBe('12:05am');
    expect(timeLabel(new Date(2026, 5, 4, 12, 0))).toBe('12:00pm');
    expect(timeLabel(new Date(2026, 5, 4, 9, 30))).toBe('9:30am');
  });
});

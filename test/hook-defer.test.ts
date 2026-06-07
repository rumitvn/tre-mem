import { describe, expect, it } from 'vitest';

import { FIRST_SESSION_DEFER_MS, STEADY_DEFER_MS, sessionDeferMs } from '../src/hooks/defer.js';

const base = {
  format: 'claude' as const,
  claudeMemPresent: true,
  claudeMemHasProject: true,
};

describe('sessionDeferMs', () => {
  it('defers the steady delay on Claude Code once a project has claude-mem memory', () => {
    expect(sessionDeferMs(base)).toBe(STEADY_DEFER_MS);
  });

  it('defers longer on the first session — claude-mem prints its slower onboarding banner', () => {
    expect(sessionDeferMs({ ...base, claudeMemHasProject: false })).toBe(FIRST_SESSION_DEFER_MS);
  });

  it('does not defer when claude-mem is absent (nothing to render below)', () => {
    expect(sessionDeferMs({ ...base, claudeMemPresent: false })).toBe(0);
    expect(sessionDeferMs({ ...base, claudeMemPresent: false, claudeMemHasProject: false })).toBe(
      0,
    );
  });

  it('does not auto-defer on Codex/Gemini — they order session-start hooks themselves', () => {
    // Codex/Gemini batch all session-start hooks and emit them in a fixed order
    // (config hooks before plugin hooks); a defer is pure latency with no effect.
    expect(sessionDeferMs({ ...base, format: 'codex' })).toBe(0);
    expect(sessionDeferMs({ ...base, format: 'codex', claudeMemHasProject: false })).toBe(0);
    expect(sessionDeferMs({ ...base, format: 'gemini' })).toBe(0);
  });

  it('honours an explicit TRE_MEM_HOOK_DELAY_MS override on every harness', () => {
    expect(sessionDeferMs({ ...base, envOverride: '750' })).toBe(750);
    // Override wins even on the first-session path…
    expect(sessionDeferMs({ ...base, claudeMemHasProject: false, envOverride: '0' })).toBe(0);
    // …when claude-mem is absent…
    expect(sessionDeferMs({ ...base, claudeMemPresent: false, envOverride: '500' })).toBe(500);
    // …and on Codex/Gemini, where there is no auto-defer otherwise.
    expect(sessionDeferMs({ ...base, format: 'codex', envOverride: '800' })).toBe(800);
  });

  it('treats a blank or malformed override as no override / disabled', () => {
    expect(sessionDeferMs({ ...base, envOverride: '   ' })).toBe(STEADY_DEFER_MS);
    expect(sessionDeferMs({ ...base, envOverride: 'nope' })).toBe(0);
    expect(sessionDeferMs({ ...base, envOverride: '-5' })).toBe(0);
  });
});

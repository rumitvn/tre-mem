import { describe, expect, it } from 'vitest';

import { FIRST_SESSION_DEFER_MS, STEADY_DEFER_MS, sessionDeferMs } from '../src/hooks/defer.js';

const base = {
  claudeMemPresent: true,
  claudeMemHasProject: true,
};

describe('sessionDeferMs', () => {
  it('defers the steady delay once a project has claude-mem memory', () => {
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

  it('defers on every harness with claude-mem present — Codex/Gemini race too', () => {
    // The defer is format-agnostic: claude-mem runs its SessionStart hook on
    // Claude Code, Codex, and Gemini alike, so tre-mem must wait on all three.
    expect(sessionDeferMs(base)).toBe(STEADY_DEFER_MS);
    expect(sessionDeferMs({ ...base, claudeMemHasProject: false })).toBe(FIRST_SESSION_DEFER_MS);
  });

  it('honours an explicit TRE_MEM_HOOK_DELAY_MS override over every heuristic', () => {
    expect(sessionDeferMs({ ...base, envOverride: '750' })).toBe(750);
    // Override wins even on the first-session path…
    expect(sessionDeferMs({ ...base, claudeMemHasProject: false, envOverride: '0' })).toBe(0);
    // …and even when claude-mem is absent.
    expect(sessionDeferMs({ ...base, claudeMemPresent: false, envOverride: '500' })).toBe(500);
  });

  it('treats a blank or malformed override as no override / disabled', () => {
    expect(sessionDeferMs({ ...base, envOverride: '   ' })).toBe(STEADY_DEFER_MS);
    expect(sessionDeferMs({ ...base, envOverride: 'nope' })).toBe(0);
    expect(sessionDeferMs({ ...base, envOverride: '-5' })).toBe(0);
  });
});

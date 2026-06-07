/**
 * Steady-state defer (ms). Once a project has claude-mem memory, its SessionStart
 * banner renders fast, so a short defer is enough for tre-mem to land below it.
 */
export const STEADY_DEFER_MS = 250;

/**
 * First-session defer (ms). With no memory yet, claude-mem prints its longer
 * first-run onboarding banner, which takes more than the steady delay to render —
 * so tre-mem must wait longer to reliably land BELOW it rather than racing above.
 */
export const FIRST_SESSION_DEFER_MS = 1200;

export interface DeferInput {
  /** claude-mem is present on disk (its SessionStart banner will print too). */
  claudeMemPresent: boolean;
  /** claude-mem already holds memory for this project (steady-state, fast banner). */
  claudeMemHasProject: boolean;
  /** Raw `TRE_MEM_HOOK_DELAY_MS` value, when set. */
  envOverride?: string;
}

/**
 * How long to defer the SessionStart banner so tre-mem renders BELOW claude-mem.
 *
 * Pure by design — all disk/env probing happens in the caller and is passed in,
 * so the ordering policy is unit-testable. An explicit `TRE_MEM_HOOK_DELAY_MS`
 * always wins (0 disables; blank/malformed is ignored). Otherwise we defer
 * whenever claude-mem is present (Claude Code, Codex, and Gemini all run
 * claude-mem's SessionStart hook too and render in completion order), and the
 * first session of a project (claude-mem's slower onboarding banner) defers
 * longer than steady state.
 */
export function sessionDeferMs(input: DeferInput): number {
  const raw = input.envOverride;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (!input.claudeMemPresent) return 0;
  return input.claudeMemHasProject ? STEADY_DEFER_MS : FIRST_SESSION_DEFER_MS;
}

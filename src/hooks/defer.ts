import type { HookFormat } from './envelope.js';

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
  /** Which harness is consuming the hook output. */
  format: HookFormat;
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
 * always wins on every harness (0 disables; blank/malformed is ignored).
 *
 * Auto-defer is **Claude Code only**: it renders SessionStart hooks in
 * completion order, so waiting lands tre-mem below claude-mem. Codex and Gemini
 * collect every session-start hook and emit them together in a fixed order they
 * choose (config-defined hooks before plugin hooks) — a defer there is pure
 * latency with no effect on order, so we skip it (a user who still wants one can
 * force it via `TRE_MEM_HOOK_DELAY_MS`). On Claude Code, the first session of a
 * project (claude-mem's slower onboarding banner) defers longer than steady state.
 */
export function sessionDeferMs(input: DeferInput): number {
  const raw = input.envOverride;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (input.format !== 'claude' || !input.claudeMemPresent) return 0;
  return input.claudeMemHasProject ? STEADY_DEFER_MS : FIRST_SESSION_DEFER_MS;
}

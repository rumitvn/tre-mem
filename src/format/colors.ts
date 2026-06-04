import pc from 'picocolors';

/** The picocolors palette shape (bold, red, cyan, dim, …). */
export type Palette = ReturnType<typeof pc.createColors>;

function noColorRequested(): boolean {
  const v = process.env.NO_COLOR;
  return v !== undefined && v !== '';
}

/**
 * Build a palette with an explicit on/off switch — `NO_COLOR` always wins.
 * Use `colors(true)` for output that should be colored even when stdout is a
 * pipe (e.g. a hook's `systemMessage`, which Claude Code renders as ANSI).
 */
export function colors(enabled: boolean): Palette {
  return pc.createColors(enabled && !noColorRequested());
}

/** TTY/`NO_COLOR`-aware palette for ordinary CLI output. */
export const auto: Palette = pc.createColors(pc.isColorSupported);

/** Always-colored palette (unless `NO_COLOR`), for piped hook display strings. */
export const forced: Palette = colors(true);

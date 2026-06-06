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

/**
 * The bamboo motif — tre's mark in terminal output. `tre` means _bamboo_ in
 * Vietnamese; the brand color is green (the closest ANSI bridge to the web
 * dashboard's `--bamboo` jade). See docs/BRAND.md.
 */
export const BAMBOO = '🎋';

/**
 * Brand styling: bamboo green + bold. Use for tre's name and section headers in
 * terminal output so the identity reads green everywhere. With a no-color
 * palette this is an identity passthrough (plain text).
 */
export function brand(c: Palette): (s: string) => string {
  return (s) => c.bold(c.green(s));
}

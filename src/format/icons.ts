/**
 * Observation-type → emoji + label, mirroring claude-mem's legend so a
 * tre-mem digest reads consistently next to claude-mem's own output.
 */

export interface TypeIcon {
  emoji: string;
  label: string;
}

const TYPE_ICONS: Record<string, TypeIcon> = {
  session: { emoji: '🎯', label: 'session' },
  bugfix: { emoji: '🔴', label: 'bugfix' },
  feature: { emoji: '🟣', label: 'feature' },
  refactor: { emoji: '🔄', label: 'refactor' },
  change: { emoji: '✅', label: 'change' },
  discovery: { emoji: '🔵', label: 'discovery' },
  decision: { emoji: '⚖️', label: 'decision' },
  security_alert: { emoji: '🚨', label: 'security_alert' },
  security_note: { emoji: '🔐', label: 'security_note' },
};

const FALLBACK: TypeIcon = { emoji: '•', label: 'note' };

/** Icon for an observation type (case-insensitive); neutral fallback if unknown. */
export function iconFor(type: string | null | undefined): TypeIcon {
  if (!type) return FALLBACK;
  return TYPE_ICONS[type.toLowerCase()] ?? FALLBACK;
}

/** The legend line, e.g. `🔴bugfix 🟣feature ✅change ⚖️decision …`. */
export function legendLine(): string {
  return Object.values(TYPE_ICONS)
    .map((i) => `${i.emoji}${i.label}`)
    .join(' ');
}

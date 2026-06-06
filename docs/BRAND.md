# tre-mem brand & design system 🎋

> _Tre — shared roots for your codebase._

`tre` means **bamboo** in Vietnamese — many stalks rising from one root system,
swaying separately in the wind but standing together through every storm. The
identity is **green**, the way a bamboo grove is green: a calm jade for the brand,
a green-tinted rice paper for the ground, and a small set of grove colors for the
branch graph.

This file is the single source of truth for that identity. Two surfaces consume
it: the **web dashboard** (`tre web`, OKLCH tokens in `web/styles.css`) and the
**terminal** (the SessionStart digest + CLI, ANSI via `picocolors` in
`src/format/`). Keep both in step with the table below.

---

## Palette

The web uses [OKLCH](https://oklch.com) for perceptual consistency across light
and dark. The terminal only has 8/16 ANSI colors, so each role maps to its
nearest ANSI bridge — **bamboo green → `green`** carries the brand.

| Role                                 | Token (web)     | Light OKLCH              | Dark OKLCH             | Terminal (ANSI)    |
| ------------------------------------ | --------------- | ------------------------ | ---------------------- | ------------------ |
| **Primary / brand / current branch** | `--bamboo`      | `oklch(48% 0.12 152)`    | `oklch(74% 0.13 150)`  | `green` + bold     |
| Text-on-bamboo                       | `--bamboo-deep` | `oklch(38% 0.1 152)`     | `oklch(82% 0.1 150)`   | —                  |
| Branch-local observations            | `--branch`      | `oklch(60% 0.1 235)`     | `oklch(74% 0.1 235)`   | `cyan`             |
| Graduated (repo-wide) facts          | `--growth`      | `oklch(72% 0.15 130)`    | `oklch(80% 0.15 130)`  | `green`            |
| Pinned decisions                     | `--pin`         | `oklch(72% 0.13 80)`     | `oklch(82% 0.12 82)`   | `yellow`           |
| Warning / unshared / pending         | `--warn`        | `oklch(56% 0.16 32)`     | `oklch(70% 0.16 34)`   | `red`              |
| Rice paper (background)              | `--paper`       | `oklch(98.5% 0.008 140)` | `oklch(20% 0.014 150)` | (terminal default) |
| Ink (text)                           | `--ink`         | `oklch(24% 0.02 150)`    | `oklch(94% 0.01 140)`  | (terminal default) |

The paper/ink ramp carries a faint green tint (hue 140–150, very low chroma) so
the whole UI reads as grove, never neutral grey.

### Semantic spine legend

The branch graph and memory feed use a **colored left spine** (`--spine`) to say
what a row is at a glance. The five accents are the grove:

```
● bamboo  jade green   primary · current branch · active tab · wordmark
● branch  sky blue     branch-local observation
● growth  young shoot  graduated to repo-wide
● pin     lacquer gold pinned decision
● warn    clay red     warning · not shared yet
```

**Rule:** the five hues stay ≥ ~30–40° apart, or differ strongly in lightness, so
they remain distinguishable on the branch graph and for color-vision deficiency.
Primary (jade, hue 152, darker) and graduated (young-shoot, hue 130, lighter)
are the closest pair — they're separated by lightness, and they appear in
different roles (a filled node vs. a row spine), never as adjacent swatches.

---

## Typography

A deliberate serif-display + sans-body pairing; mono for code and IDs.

| Family | Token          | Stack head              | Used for                        |
| ------ | -------------- | ----------------------- | ------------------------------- |
| Serif  | `--font-serif` | `Iowan Old Style`       | headings, `.lede`, the wordmark |
| Sans   | `--font-sans`  | system UI               | body, controls, labels          |
| Mono   | `--font-mono`  | `SF Mono` / `JetBrains` | branch names, observation IDs   |

Type scale is fluid via `clamp()` (`--text-xs` … `--text-display`). Headings
carry a slight negative letter-spacing; the wordmark is `tre` in `--bamboo`.

---

## Motion

Compositor-only — animate `transform` and `opacity`, never layout-bound
properties. Durations `--dur-fast: 130ms` / `--dur: 240ms`, easing
`--ease: cubic-bezier(0.16, 1, 0.3, 1)`. Honor `prefers-reduced-motion`.

---

## Motif & voice

- **Mark:** 🎋 in the terminal; a small bamboo-culm SVG (two nodes — _đốt tre_ —
  and a leaf) before the `tre` wordmark on the web.
- **Language:** _gốc chung · shared roots_; "branches of one codebase." Keep the
  Vietnamese framing — it's the heart of the name, not decoration.
- **Both themes intentional.** Light is rice-paper-by-day; dark is the night
  grove (deep green-black, not blue-slate). Never default to dark automatically.

---

## Where it lives

| Surface           | File                                              |
| ----------------- | ------------------------------------------------- |
| Web tokens        | `web/styles.css` (`:root`, `[data-theme='dark']`) |
| Web wordmark/mark | `web/app.tsx` (`BambooMark`)                      |
| Web shell/favicon | `scripts/build-web.mjs`                           |
| Terminal palette  | `src/format/colors.ts` (`brand`, `BAMBOO`)        |
| Terminal digest   | `src/format/digest.ts`                            |

When you touch a color, change it here first, then propagate to both surfaces.

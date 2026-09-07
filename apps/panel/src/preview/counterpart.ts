/**
 * The counterpart theme: this kit's palette, in the other mode.
 *
 * A theme switch in the panel is a token-set swap -- preview, docs and the
 * component gallery all turn together because they all read one variable set.
 * The kit itself has exactly one mode, because that is what the captures
 * supported, so the counterpart has to be *derived*, and derivation is where a
 * preview can quietly start lying. Four rules keep it honest:
 *
 *   - **Surfaces and text flip; brand fills do not.** Background, surface,
 *     hover, selection, border, text and the disabled pair are a lightness
 *     ladder, and flipping a ladder is what a mode change is. `primary` and
 *     `destructive` keep their hue, chroma *and* lightness: a kit whose brand
 *     colour changed in dark mode would be a different kit.
 *   - **The ladder is re-spread, not just mirrored.** A light kit separates its
 *     page from its panels by 0.02 lightness near white, where the eye is
 *     sensitive; the same 0.02 near black is invisible. So the mirrored values
 *     are mapped onto a band that reaches the ends of the new mode, which keeps
 *     the ordering and the proportions while restoring the separation.
 *   - **The contrast floors are re-enforced**, using the engine's own walker
 *     over the kit's own pair list and each pair's own floor. A derived theme
 *     that failed AA would be a worse artefact than no derived theme.
 *   - **It is labelled everywhere it appears, and it is never exported.** The
 *     kit ships in the mode it was distilled in. This is a way to look at the
 *     palette, not a second kit.
 */
import { contrastRatio, enforceContrast, formatOklch, oklchToHex, parseColor } from '@ingot/engine'
import type { ColorRoleName, TokensDocument } from '@ingot/engine'

/** Which theme the preview is showing. */
export type PreviewTheme = 'kit' | 'counterpart'

/**
 * The roles that make up the lightness ladder.
 *
 * Everything a surface is drawn on or a label is drawn in. `selectedSurface` is
 * on the list even though it carries hue: a mint selection band cannot survive
 * a move to dark mode, and keeping its hue while flipping its lightness is what
 * makes it still read as selection.
 */
const LADDER: ColorRoleName[] = [
  'background',
  'surface',
  'surfaceHover',
  'selectedSurface',
  'border',
  'text',
  'textMuted',
  'disabledSurface',
  'disabledForeground',
]

/**
 * The band the flipped ladder is spread across, per target mode.
 *
 * Not 0 to 1: a dark UI whose page is pure black and whose text is pure white
 * is harsher than any of the kits this engine distils, and neither end is a
 * value a real interface uses.
 */
const BAND: Record<'light' | 'dark', { low: number; high: number }> = {
  dark: { low: 0.12, high: 0.96 },
  light: { low: 0.2, high: 0.99 },
}

/** The mode a theme resolves to, for labelling. */
export function modeOf(tokens: TokensDocument, theme: PreviewTheme): 'light' | 'dark' {
  if (theme === 'kit') return tokens.color.mode
  return tokens.color.mode === 'dark' ? 'light' : 'dark'
}

/**
 * Derive the counterpart-mode token set.
 *
 * Pure and deterministic: same document in, same document out, so the derived
 * theme is stable across renders and can be memoised on the document.
 */
export function counterpartTokens(tokens: TokensDocument): TokensDocument {
  const next = JSON.parse(JSON.stringify(tokens)) as TokensDocument
  const mode = tokens.color.mode === 'dark' ? 'light' : 'dark'
  next.color.mode = mode

  const flipped = new Map<ColorRoleName, number>()
  for (const role of LADDER) {
    const parsed = parseColor(tokens.color.roles[role]?.value.hex ?? '')
    if (parsed === undefined) continue
    flipped.set(role, 1 - parsed.oklch.l)
  }

  const values = [...flipped.values()]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const band = BAND[mode]
  // A degenerate ladder -- every role at the same lightness -- has nothing to
  // spread, so it is left where the mirror put it rather than divided by zero.
  const spread = (value: number): number =>
    high - low < 0.001 ? value : band.low + ((value - low) / (high - low)) * (band.high - band.low)

  for (const [role, mirrored] of flipped) {
    const parsed = parseColor(next.color.roles[role]?.value.hex ?? '')
    if (parsed === undefined) continue
    write(next, role, { ...parsed.oklch, l: clamp01(spread(mirrored)) })
  }

  enforceKitPairs(next)
  remeasure(next)

  next.diagnostics = [
    ...next.diagnostics,
    {
      level: 'info',
      code: 'preview.counterpart-theme',
      message:
        `This is the ${mode}-mode palette derived in the panel for preview: the surface and text ladder flipped ` +
        'and re-spread, the brand roles kept as they are, and every guaranteed pair re-enforced. It is not part of ' +
        `the exported kit, which ships in ${tokens.color.mode} mode.`,
    },
  ]

  return next
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function write(
  tokens: TokensDocument,
  role: ColorRoleName,
  color: { l: number; c: number; h: number | undefined },
): void {
  const token = tokens.color.roles[role]
  if (token === undefined) return
  token.value = {
    oklch: formatOklch(color),
    hex: oklchToHex(color),
    lightness: Math.round(color.l * 10000) / 10000,
    chroma: Math.round(color.c * 10000) / 10000,
    hue: color.c === 0 || color.h === undefined ? 0 : Math.round(color.h * 100) / 100,
  }
  // The engine's adjustment described a walk on the kit's own value, not on
  // this derived one; carrying it over would credit it with the wrong move.
  delete token.contrastAdjustment
}

/**
 * Re-enforce the kit's own pair list over the flipped palette.
 *
 * The pairs and their floors come from `tokens.color.contrast`, which is the
 * engine's statement of what it guarantees -- so the counterpart guarantees
 * exactly the same set, without this file having to know what that set is.
 */
function enforceKitPairs(tokens: TokensDocument): void {
  const byForeground = new Map<string, { floor: number; backgrounds: string[] }>()
  for (const pair of tokens.color.contrast) {
    const entry = byForeground.get(pair.foreground) ?? { floor: 0, backgrounds: [] }
    // The strictest floor any of this foreground's pairings asks for: walking
    // once to the highest bar clears every lower one at the same time.
    entry.floor = Math.max(entry.floor, pair.floor)
    entry.backgrounds.push(pair.background)
    byForeground.set(pair.foreground, entry)
  }

  // Sorted, so the walk order -- and therefore the result -- does not depend on
  // the order the pairs happened to be listed in.
  for (const path of [...byForeground.keys()].sort()) {
    const entry = byForeground.get(path)
    if (entry === undefined) continue
    const role = path.replace('color.roles.', '') as ColorRoleName
    const parsed = parseColor(tokens.color.roles[role]?.value.hex ?? '')
    if (parsed === undefined) continue

    const backgrounds = entry.backgrounds.flatMap((background) => {
      const hex = tokens.color.roles[background.replace('color.roles.', '') as ColorRoleName]?.value.hex
      const colour = hex === undefined ? undefined : parseColor(hex)
      return colour === undefined ? [] : [{ path: background, color: colour.oklch }]
    })
    if (backgrounds.length === 0) continue

    const { color } = enforceContrast(path, parsed.oklch, backgrounds, entry.floor)
    write(tokens, role, color)
  }
}

/** Restate every ratio against the palette as it now stands. */
function remeasure(tokens: TokensDocument): void {
  const colorOf = (path: string): ReturnType<typeof parseColor> => {
    const hex = tokens.color.roles[path.replace('color.roles.', '') as ColorRoleName]?.value.hex
    return hex === undefined ? undefined : parseColor(hex)
  }

  for (const pair of tokens.color.contrast) {
    const foreground = colorOf(pair.foreground)
    const background = colorOf(pair.background)
    if (foreground === undefined || background === undefined) continue
    pair.ratio = contrastRatio(foreground.oklch, background.oklch)
    pair.passes = pair.ratio >= pair.floor
  }

  const disabled = tokens.components.states.disabled
  const foreground = colorOf(disabled.foreground)
  const surface = colorOf(disabled.surface)
  if (foreground !== undefined && surface !== undefined) {
    disabled.ratio = contrastRatio(foreground.oklch, surface.oklch)
  }
}

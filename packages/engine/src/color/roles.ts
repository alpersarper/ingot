/**
 * Semantic role assignment.
 *
 * Turns an unordered bag of colour clusters into the small named set a design
 * system actually uses. Every rule here is a total order over the candidates,
 * so the same captures always produce the same roles.
 *
 * The shape of the heuristics:
 *   1. Decide light or dark from the observed background colours.
 *   2. Claim the structural neutrals (background, surface, border) from the
 *      low-chroma clusters, extreme-first.
 *   3. Claim the brand colours from the high-chroma clusters, background
 *      channel first (a brand colour that fills a button is more certainly the
 *      brand than one that only tints some text).
 *   4. Derive whatever is still missing from what was claimed.
 */
import { byNumber, byString, chain } from '../util/sort'
import { clamp, round } from '../util/num'
import type { ColorCluster } from './cluster'
import type { Oklch } from './space'
import { contrastRatio, oklchToHex, renderedDistance, withLightness } from './space'
import type { ColorRoleName } from '../tokens/types'

/**
 * Chroma at or below this counts as neutral.
 *
 * 0.05 admits deliberately tinted greys -- a navy body text like `#1a1f36`
 * (chroma 0.044) is a neutral, not a brand colour -- while excluding every
 * saturated hue in the fixture sets (the least saturated is chroma 0.158).
 */
export const NEUTRAL_CHROMA_MAX = 0.05

/** Minimum lightness separation for two neutrals to be distinct surfaces. */
const SURFACE_SEPARATION_MIN = 0.015

/**
 * Contrast bands searched, strongest first, when looking for the body text
 * colour. AAA is tried before AA so a page that has a proper high-contrast text
 * colour is never represented by its secondary one.
 */
const TEXT_CONTRAST_BANDS = [7, 4.5, 0] as const

/**
 * Minimum lightness gap between `textMuted` and both `text` and `background`.
 * Without it a set containing two near-identical dark greys will happily emit
 * one as text and the other as "muted", which is not a distinction a reader can
 * see.
 */
const MUTED_SEPARATION_MIN = 0.1

/** Hue window (OKLCH degrees) that reads as "red" for the destructive role. */
const DESTRUCTIVE_HUE = { min: 5, max: 55 }

/** Minimum chroma for a colour to be read as a signal colour rather than a tint. */
const SIGNAL_CHROMA_MIN = 0.1

export type Mode = 'light' | 'dark'

/** A role assignment: which cluster (if any) became which role, and why. */
export interface RoleAssignment {
  role: ColorRoleName
  /** The cluster that supplied the value, or `undefined` when derived. */
  cluster?: ColorCluster
  color: Oklch
  /** Stable identifier of the rule that made the call. */
  rule: string
  /** The rule stated concretely for this input. */
  detail: string
  /** Roles this value was computed from. Empty when observed. */
  derivedFrom: ColorRoleName[]
}

const isNeutral = (cluster: ColorCluster): boolean => cluster.oklch.c <= NEUTRAL_CHROMA_MAX
const isChromatic = (cluster: ColorCluster): boolean => cluster.oklch.c > NEUTRAL_CHROMA_MAX

/**
 * Light or dark, decided by the lightness of the observed background colours
 * weighted by how often each was observed. Foreground colours are ignored: a
 * dark page with a lot of white text is still a dark page.
 */
export function detectMode(clusters: readonly ColorCluster[]): Mode {
  const backgrounds = clusters.filter((cluster) => cluster.channels.background > 0)
  if (backgrounds.length === 0) return 'light'
  let weighted = 0
  let total = 0
  for (const cluster of backgrounds) {
    weighted += cluster.oklch.l * cluster.channels.background
    total += cluster.channels.background
  }
  return weighted / total < 0.5 ? 'dark' : 'light'
}

/** In dark mode structural colours get lighter as they come forward; in light mode, darker. */
function forwardDirection(mode: Mode): 1 | -1 {
  return mode === 'dark' ? 1 : -1
}

/**
 * Assign every role the captures can support, then derive the rest.
 *
 * Returns assignments in a fixed order so the output document's key order is
 * itself deterministic.
 */
export function assignRoles(clusters: readonly ColorCluster[], mode: Mode): RoleAssignment[] {
  const assignments: RoleAssignment[] = []
  const claimed = new Set<string>()
  const push = (assignment: RoleAssignment): void => {
    assignments.push(assignment)
    if (assignment.cluster) claimed.add(assignment.cluster.id)
  }
  const get = (role: ColorRoleName): RoleAssignment | undefined =>
    assignments.find((assignment) => assignment.role === role)

  const forward = forwardDirection(mode)
  /** Extremity: how far a colour sits in the "page background" direction. */
  const backwardness = (cluster: ColorCluster): number => -forward * cluster.oklch.l

  // --- background -----------------------------------------------------------
  // The most extreme low-chroma background colour: the darkest in a dark set,
  // the lightest in a light set. Frequency only breaks ties, because a page
  // background is defined by being the furthest back, not the most common.
  const backgroundCandidates = clusters
    .filter((cluster) => isNeutral(cluster) && cluster.channels.background > 0)
    .sort(
      chain<ColorCluster>(
        (a, b) => byNumber(backwardness(b), backwardness(a)),
        (a, b) => byNumber(b.channels.background, a.channels.background),
        (a, b) => byString(a.hex, b.hex),
      ),
    )

  const background = backgroundCandidates[0]
  if (background) {
    push({
      role: 'background',
      cluster: background,
      color: background.oklch,
      rule: 'extreme-neutral-background',
      detail: `${mode} mode: chose the ${mode === 'dark' ? 'darkest' : 'lightest'} neutral background colour (L ${background.oklch.l}) of ${backgroundCandidates.length} candidates`,
      derivedFrom: [],
    })
  } else {
    const color: Oklch = mode === 'dark' ? { l: 0.145, c: 0, h: undefined } : { l: 1, c: 0, h: undefined }
    push({
      role: 'background',
      color,
      rule: 'default-background',
      detail: `no neutral background colour was captured; fell back to the ${mode}-mode default L ${color.l}`,
      derivedFrom: [],
    })
  }
  const backgroundColor = (get('background') as RoleAssignment).color

  // --- surface --------------------------------------------------------------
  // The neutral background colour nearest the page background but still
  // distinguishable from it. "Nearest" rather than "second most extreme" so a
  // stray dark panel on a light page cannot claim the role.
  const surfaceCandidates = clusters
    .filter(
      (cluster) =>
        isNeutral(cluster) &&
        cluster.channels.background > 0 &&
        !claimed.has(cluster.id) &&
        Math.abs(cluster.oklch.l - backgroundColor.l) >= SURFACE_SEPARATION_MIN,
    )
    .sort(
      chain<ColorCluster>(
        (a, b) =>
          byNumber(
            Math.abs(a.oklch.l - backgroundColor.l),
            Math.abs(b.oklch.l - backgroundColor.l),
          ),
        (a, b) => byNumber(b.channels.background, a.channels.background),
        (a, b) => byString(a.hex, b.hex),
      ),
    )

  const surface = surfaceCandidates[0]
  if (surface) {
    push({
      role: 'surface',
      cluster: surface,
      color: surface.oklch,
      rule: 'nearest-distinct-neutral-background',
      detail: `nearest neutral background colour at least ${SURFACE_SEPARATION_MIN} lightness from background (delta L ${round(surface.oklch.l - backgroundColor.l, 4)})`,
      derivedFrom: [],
    })
  } else {
    const color = withLightness(backgroundColor, backgroundColor.l + forward * 0.04)
    push({
      role: 'surface',
      color,
      rule: 'oklch-lightness-offset',
      detail: `no distinct panel colour was captured; lifted background lightness by ${forward > 0 ? '+' : ''}${forward * 0.04}`,
      derivedFrom: ['background'],
    })
  }

  // --- text -----------------------------------------------------------------
  // The most used neutral foreground colour that carries body-text contrast.
  // Frequency leads because the body text colour is, by definition, the one
  // most of the page is set in; the contrast band is what stops a rarely used
  // pure white label on a brand button from claiming the role just for being
  // the furthest from the background.
  const neutralForegrounds = clusters.filter(
    (cluster) => isNeutral(cluster) && cluster.channels.foreground > 0,
  )
  let textBand = 0
  let textCandidates: ColorCluster[] = []
  for (const band of TEXT_CONTRAST_BANDS) {
    const eligible = neutralForegrounds.filter(
      (cluster) => contrastRatio(cluster.oklch, backgroundColor) >= band,
    )
    if (eligible.length > 0) {
      textBand = band
      textCandidates = eligible.sort(
        chain<ColorCluster>(
          (a, b) => byNumber(b.channels.foreground, a.channels.foreground),
          (a, b) =>
            byNumber(Math.abs(b.oklch.l - backgroundColor.l), Math.abs(a.oklch.l - backgroundColor.l)),
          (a, b) => byString(a.hex, b.hex),
        ),
      )
      break
    }
  }

  const text = textCandidates[0]
  if (text) {
    push({
      role: 'text',
      cluster: text,
      color: text.oklch,
      rule: 'most-observed-high-contrast-foreground',
      detail: `most observed neutral foreground colour clearing ${textBand}:1 against background (${text.channels.foreground} observations at ${contrastRatio(text.oklch, backgroundColor)}:1) of ${textCandidates.length} candidates`,
      derivedFrom: [],
    })
  } else {
    const color: Oklch = mode === 'dark' ? { l: 0.985, c: 0, h: undefined } : { l: 0.145, c: 0, h: undefined }
    push({
      role: 'text',
      color,
      rule: 'default-text',
      detail: `no neutral foreground colour was captured; fell back to the ${mode}-mode default L ${color.l}`,
      derivedFrom: [],
    })
  }
  const textColor = (get('text') as RoleAssignment).color

  // --- textMuted ------------------------------------------------------------
  // A neutral foreground colour that sits between text and background. The most
  // frequently observed such colour wins; ties go to the one nearest the
  // midpoint, which is where a de-emphasised colour belongs.
  const midpoint = (textColor.l + backgroundColor.l) / 2
  const between = (l: number): boolean =>
    l > Math.min(textColor.l, backgroundColor.l) && l < Math.max(textColor.l, backgroundColor.l)

  const mutedCandidates = clusters
    .filter(
      (cluster) =>
        isNeutral(cluster) &&
        cluster.channels.foreground > 0 &&
        !claimed.has(cluster.id) &&
        between(cluster.oklch.l) &&
        Math.abs(cluster.oklch.l - textColor.l) >= MUTED_SEPARATION_MIN &&
        Math.abs(cluster.oklch.l - backgroundColor.l) >= MUTED_SEPARATION_MIN,
    )
    .sort(
      chain<ColorCluster>(
        (a, b) => byNumber(b.channels.foreground, a.channels.foreground),
        (a, b) => byNumber(Math.abs(a.oklch.l - midpoint), Math.abs(b.oklch.l - midpoint)),
        (a, b) => byString(a.hex, b.hex),
      ),
    )

  const muted = mutedCandidates[0]
  if (muted) {
    push({
      role: 'textMuted',
      cluster: muted,
      color: muted.oklch,
      rule: 'most-observed-mid-neutral-foreground',
      detail: `most observed neutral foreground colour sitting at least ${MUTED_SEPARATION_MIN} lightness from both text and background (L ${muted.oklch.l}, ${muted.channels.foreground} observations)`,
      derivedFrom: [],
    })
  } else {
    const color = withLightness(textColor, textColor.l + (backgroundColor.l - textColor.l) * 0.45)
    push({
      role: 'textMuted',
      color,
      rule: 'lightness-interpolation',
      detail: 'no de-emphasised text colour was captured; interpolated 45% from text toward background',
      derivedFrom: ['text', 'background'],
    })
  }

  // --- border ---------------------------------------------------------------
  const borderCandidates = clusters
    .filter((cluster) => isNeutral(cluster) && cluster.channels.border > 0)
    .sort(
      chain<ColorCluster>(
        (a, b) => byNumber(b.channels.border, a.channels.border),
        (a, b) => byString(a.hex, b.hex),
      ),
    )

  const border = borderCandidates[0]
  if (border) {
    push({
      role: 'border',
      cluster: border,
      color: border.oklch,
      rule: 'most-observed-neutral-border',
      detail: `most observed neutral border colour (${border.channels.border} observations)`,
      derivedFrom: [],
    })
  } else {
    const color = withLightness(backgroundColor, backgroundColor.l + forward * 0.08)
    push({
      role: 'border',
      color,
      rule: 'oklch-lightness-offset',
      detail: `no border colour was captured; offset background lightness by ${forward > 0 ? '+' : ''}${forward * 0.08}`,
      derivedFrom: ['background'],
    })
  }

  // --- primary --------------------------------------------------------------
  // The brand colour. Filling a surface is stronger evidence than tinting text,
  // so background-channel clusters rank first; then overall usage, because a
  // brand colour recurs and a one-off signal colour does not; then chroma.
  const chromatic = clusters.filter(isChromatic)
  const primaryCandidates = [...chromatic].sort(
    chain<ColorCluster>(
      (a, b) => byNumber(Math.sign(b.channels.background), Math.sign(a.channels.background)),
      (a, b) => byNumber(b.channels.background, a.channels.background),
      (a, b) => byNumber(b.count, a.count),
      (a, b) => byNumber(b.oklch.c, a.oklch.c),
      (a, b) => byString(a.hex, b.hex),
    ),
  )

  const primary = primaryCandidates[0]
  if (primary) {
    push({
      role: 'primary',
      cluster: primary,
      color: primary.oklch,
      rule: 'most-used-saturated-background',
      detail:
        primary.channels.background > 0
          ? `most used saturated background colour (${primary.channels.background} background observation(s), ${primary.count} total, chroma ${primary.oklch.c})`
          : `no saturated colour filled a surface; used the most saturated accent colour (chroma ${primary.oklch.c})`,
      derivedFrom: [],
    })
  } else {
    const color: Oklch = { l: clamp(backgroundColor.l + forward * 0.45, 0.35, 0.7), c: 0.18, h: 265 }
    push({
      role: 'primary',
      color,
      rule: 'default-primary',
      detail: 'no saturated colour was captured; fell back to a neutral-blue brand placeholder',
      derivedFrom: [],
    })
  }
  const primaryColor = (get('primary') as RoleAssignment).color
  const primaryCluster = get('primary')?.cluster

  // --- primaryForeground ----------------------------------------------------
  // Prefer a colour actually observed on top of the primary colour -- a
  // foreground observation in a capture whose background resolved to the
  // primary cluster; otherwise pick whichever of black or white reads better.
  const primaryBackgroundIds = new Set(primaryCluster?.channelCaptureIds.background ?? [])
  const onPrimaryCount = (cluster: ColorCluster): number =>
    cluster.channelCaptureIds.foreground.filter((id) => primaryBackgroundIds.has(id)).length
  const onPrimary = primaryCluster
    ? clusters
        .filter((cluster) => cluster.id !== primaryCluster.id && onPrimaryCount(cluster) > 0)
        .sort(
          chain<ColorCluster>(
            (a, b) => byNumber(onPrimaryCount(b), onPrimaryCount(a)),
            (a, b) => byNumber(b.channels.foreground, a.channels.foreground),
            (a, b) => byNumber(contrastRatio(b.oklch, primaryColor), contrastRatio(a.oklch, primaryColor)),
            (a, b) => byString(a.hex, b.hex),
          ),
        )[0]
    : undefined

  if (onPrimary) {
    push({
      role: 'primaryForeground',
      cluster: onPrimary,
      color: onPrimary.oklch,
      rule: 'observed-on-primary',
      detail: `observed as the text colour on ${onPrimaryCount(onPrimary)} capture(s) that use the primary colour as a background`,
      derivedFrom: [],
    })
  } else {
    const white: Oklch = { l: 1, c: 0, h: undefined }
    const black: Oklch = { l: 0, c: 0, h: undefined }
    const color = contrastRatio(white, primaryColor) >= contrastRatio(black, primaryColor) ? white : black
    push({
      role: 'primaryForeground',
      color,
      rule: 'best-contrast-pole',
      detail: `nothing was captured on top of the primary colour; chose ${color.l === 1 ? 'white' : 'black'} for higher contrast`,
      derivedFrom: ['primary'],
    })
  }

  // --- destructive ----------------------------------------------------------
  // Optional: only emitted when the captures actually contain a red signal
  // colour. Inventing one would be inventing a design decision.
  const destructive = chromatic
    .filter(
      (cluster) =>
        !claimed.has(cluster.id) &&
        cluster.oklch.c >= SIGNAL_CHROMA_MIN &&
        cluster.oklch.h !== undefined &&
        cluster.oklch.h >= DESTRUCTIVE_HUE.min &&
        cluster.oklch.h < DESTRUCTIVE_HUE.max,
    )
    .sort(
      chain<ColorCluster>(
        (a, b) => byNumber(b.count, a.count),
        (a, b) => byNumber(b.oklch.c, a.oklch.c),
        (a, b) => byString(a.hex, b.hex),
      ),
    )[0]

  if (destructive) {
    push({
      role: 'destructive',
      cluster: destructive,
      color: destructive.oklch,
      rule: 'red-signal-colour',
      detail: `saturated red-hued colour (hue ${destructive.oklch.h}, chroma ${destructive.oklch.c}) observed ${destructive.count} time(s)`,
      derivedFrom: [],
    })
    const white: Oklch = { l: 1, c: 0, h: undefined }
    const black: Oklch = { l: 0, c: 0, h: undefined }
    const color =
      contrastRatio(white, destructive.oklch) >= contrastRatio(black, destructive.oklch) ? white : black
    push({
      role: 'destructiveForeground',
      color,
      rule: 'best-contrast-pole',
      detail: `chose ${color.l === 1 ? 'white' : 'black'} for higher contrast on the destructive colour`,
      derivedFrom: ['destructive'],
    })
  }

  return assignments
}

/**
 * Shade/base pairings that are supposed to be visibly different.
 *
 * The contrast floor can push a derived shade back onto the colour it was
 * derived from -- on a dark kit the hover lift moves a brand fill toward its
 * white label, so holding the label at AA can cost the entire lift. Two tokens
 * with one value under prose that claims they differ is the failure mode this
 * list exists to make audible.
 *
 * It lives here, beside the derivation that creates the shades, because both
 * the distiller (which raises `color.state-collapsed`) and the exporter (which
 * warns the consumer) have to agree on which pairings are load-bearing. One
 * owner, two readers.
 */
export interface ShadeRelation {
  shade: ColorRoleName
  base: ColorRoleName
  /**
   * Smallest rendered perceptual distance ({@link renderedDistance}) at which
   * this pairing still reads as two values rather than one.
   *
   * Measured, not guessed. Quality run #2 rendered the four fixture kits and
   * compared each pair on screen:
   *
   * | pairing | stripe-light | ghost-warm | messy-mixed | linear-dark |
   * | --- | --- | --- | --- | --- |
   * | primaryHover vs primary   | 0.040 | 0.042 | 0.043 | **0.010** |
   * | primaryActive vs primary  | 0.079 | 0.080 | 0.085 | **0.010** |
   * | primaryActive vs hover    | 0.039 | 0.038 | 0.042 | **0.000** |
   * | surfaceHover vs surface   | 0.030 | 0.030 | 0.030 | 0.031 |
   * | selectedSurface vs surface| 0.025 | 0.054 | 0.029 | 0.051 |
   *
   * The three kits whose primary states a reviewer could see sit at 0.038 and
   * above; linear-dark, whose default, hover and pressed buttons were
   * indistinguishable on screen, sits at 0.010 and below. Anything in
   * 0.02--0.03 separates them, so {@link CONTROL_STATE_SEPARATION_MIN} takes
   * the middle of that window.
   *
   * The ambient surfaces are held to a lower bar on purpose: a hovered row that
   * cleared the control floor would shout. They are quiet by design and only
   * `0` is a failure -- {@link AMBIENT_SEPARATION_MIN} is the point below which
   * a tint stops surviving a real screen.
   */
  floor: number
  /**
   * Separation the chroma rescue aims to restore when the contrast floor
   * confiscated the lightness offset this shade was derived on.
   *
   * Present only on the pairings a contrast guarantee can actually flatten --
   * the primary interaction shades, which `DERIVED_PAIRS` moves because their
   * label is pinned at a gamut pole. The ambient surfaces are never moved by
   * contrast enforcement (their foregrounds yield instead), so a collapse there
   * is a fact about the palette rather than a confiscation, and the diagnostic
   * is the whole answer.
   */
  restore?: number
}

/**
 * Perceptibility floor for a control's own interaction fills.
 *
 * A button that does not visibly change under the pointer has no hover state,
 * whatever its token set says.
 */
export const CONTROL_STATE_SEPARATION_MIN = 0.025

/**
 * Perceptibility floor for the ambient row and panel tints.
 *
 * A hovered or selected row is deliberately quieter than a control: it marks a
 * position, it does not announce a state.
 */
export const AMBIENT_SEPARATION_MIN = 0.015

export const SHADE_RELATIONS: ReadonlyArray<ShadeRelation> = [
  { shade: 'primaryHover', base: 'primary', floor: CONTROL_STATE_SEPARATION_MIN, restore: 0.04 },
  { shade: 'primaryActive', base: 'primary', floor: CONTROL_STATE_SEPARATION_MIN, restore: 0.08 },
  { shade: 'primaryActive', base: 'primaryHover', floor: CONTROL_STATE_SEPARATION_MIN, restore: 0.04 },
  { shade: 'surfaceHover', base: 'surface', floor: AMBIENT_SEPARATION_MIN },
  { shade: 'selectedSurface', base: 'surface', floor: AMBIENT_SEPARATION_MIN },
  { shade: 'selectedSurface', base: 'surfaceHover', floor: AMBIENT_SEPARATION_MIN },
]

/**
 * The pairings that render as one value, given a way to read each role.
 *
 * The single owner of the question "is this state visible?". It replaced an
 * equality test on the two hex strings, which only ever fired on an exact
 * collision: linear-dark's `primaryHover` (#616dd5) and `primary` (#5e6ad2)
 * differ by one hex digit and 1.04:1, so the kit shipped a button with three
 * identical states and said nothing. Perceptibility is the question the
 * diagnostic was always asking; equality was a proxy that answered it wrong.
 *
 * `colorOf` returns `undefined` for a role the kit does not carry, and a
 * pairing with a missing side is not a collapse.
 */
export function collapsedShades(
  colorOf: (role: ColorRoleName) => Oklch | undefined,
): CollapsedShade[] {
  return SHADE_RELATIONS.flatMap((relation) => {
    const shade = colorOf(relation.shade)
    const base = colorOf(relation.base)
    if (shade === undefined || base === undefined) return []
    const distance = round(renderedDistance(shade, base), 4)
    return distance < relation.floor ? [{ ...relation, distance }] : []
  })
}

/** A pairing that failed its floor, with the distance it actually renders at. */
export interface CollapsedShade extends ShadeRelation {
  distance: number
}

/**
 * The one sentence every surface says about a set of collapsed states.
 *
 * `design.md`, the distiller's diagnostic and the override replay's restatement
 * all say it, so it is written once. It distinguishes "identical" from "too
 * close to tell apart", because after the chroma rescue the second is the
 * common case and a kit that called a 1.04:1 difference "the same colour" would
 * be describing a screen nobody has.
 */
export function collapsedShadesSentence(collapsed: readonly CollapsedShade[]): string {
  return collapsed
    .map(
      (entry) =>
        `${entry.shade} and ${entry.base} ${entry.distance === 0 ? 'are the same colour' : `are ${entry.distance} apart, under the ${entry.floor} a reader can see`}`,
    )
    .join('; ')
}

/**
 * Fraction of the distance from `textMuted` to the disabled fill that the
 * disabled label travels before the contrast floor stops it.
 *
 * A disabled control has to read as inactive, and the only honest way to say
 * "inactive" in a token model is a quieter colour -- so the label moves most of
 * the way toward its own background and is then held at the floor.
 */
const DISABLED_FOREGROUND_FADE = 0.4

/** Chroma step the state rescue walks in. Matches the contrast walk's own step. */
const RESCUE_CHROMA_STEP = 0.005

/** Chroma the rescue will not exceed: past this a brand colour stops being one. */
const RESCUE_CHROMA_MAX = 0.4

/** A contrast guarantee a rescued shade has to keep. */
export interface SeparationGuard {
  color: Oklch
  floor: number
}

/** One shade the rescue moved, and what the move bought. */
export interface SeparationRescue {
  role: ColorRoleName
  color: Oklch
  /** Sentence for the assignment's own `detail`, in the same voice as the rest. */
  detail: string
}

/**
 * Buy back a state's visibility on the chroma axis when the contrast floor took
 * the lightness offset it was derived on.
 *
 * This is the derivation half of the collapse fix, and it is preferred to the
 * diagnostic: telling a consumer "your hover state is invisible, signal it some
 * other way" is the right answer only once there is genuinely nothing left to
 * spend. On linear-dark there was. `primary` #5e6ad2 sits within 0.01 lightness
 * of the highest lightness a white label can clear AA on, so the +0.04 hover
 * lift and the +0.08 pressed lift were both walked straight back to it -- but
 * the same hue has room *outwards*, and saturating a fill changes its luminance
 * without touching the lightness coordinate the contrast walk is fighting over.
 * Hue never moves: that is the brand.
 *
 * The walk is bounded by every guarantee the shade already carries, so a rescue
 * cannot reopen a contrast pair to close a perceptibility one. `relations` that
 * remain under their floor afterwards are the palette's real answer, and
 * `color.state-collapsed` says so.
 *
 * Roles are rescued in `SHADE_RELATIONS` order and each sees the moves made
 * before it, which is what lets `primaryActive` separate from a `primaryHover`
 * that has itself just moved.
 */
export function restoreStateSeparation(
  colorOf: (role: ColorRoleName) => Oklch | undefined,
  guardsOf: (role: ColorRoleName) => readonly SeparationGuard[],
): SeparationRescue[] {
  const moved = new Map<ColorRoleName, Oklch>()
  const current = (role: ColorRoleName): Oklch | undefined => moved.get(role) ?? colorOf(role)
  const rescues: SeparationRescue[] = []

  const order: ColorRoleName[] = []
  for (const relation of SHADE_RELATIONS) {
    if (relation.restore !== undefined && !order.includes(relation.shade)) order.push(relation.shade)
  }

  for (const role of order) {
    const start = current(role)
    if (start === undefined || start.h === undefined) continue
    const relations = SHADE_RELATIONS.filter(
      (relation) => relation.shade === role && relation.restore !== undefined,
    ).flatMap((relation) => {
      const base = current(relation.base)
      return base === undefined ? [] : [{ relation, base }]
    })
    if (relations.length === 0) continue
    if (relations.every(({ relation, base }) => renderedDistance(start, base) >= relation.floor)) continue

    const guards = guardsOf(role)
    const meetsGuards = (color: Oklch): boolean =>
      guards.every((guard) => contrastRatio(guard.color, color) >= guard.floor)
    /** How close a candidate comes to every target it has, worst relation first. */
    const satisfaction = (color: Oklch): number =>
      Math.min(
        ...relations.map(({ relation, base }) =>
          Math.min(renderedDistance(color, base) / (relation.restore ?? relation.floor), 1),
        ),
      )

    let best: { color: Oklch; chroma: number; score: number } | undefined
    for (const direction of [1, -1] as const) {
      let chroma = start.c
      for (;;) {
        const next = round(clamp(chroma + direction * RESCUE_CHROMA_STEP, 0, RESCUE_CHROMA_MAX), 4)
        if (next === chroma) break
        chroma = next
        const color: Oklch = { ...start, c: chroma }
        if (!meetsGuards(color)) break
        const score = satisfaction(color)
        const better =
          best === undefined ||
          score > best.score ||
          (score === best.score && Math.abs(chroma - start.c) < Math.abs(best.chroma - start.c))
        if (better) best = { color, chroma, score }
        if (score >= 1) break
      }
    }

    if (best === undefined || best.score <= satisfaction(start)) continue
    moved.set(role, best.color)
    const delta = round(best.chroma - start.c, 4)
    rescues.push({
      role,
      color: best.color,
      detail:
        `the contrast floor walked the lightness offset back onto ${relations[0]?.relation.base ?? 'its base role'},` +
        ` so the state budget was spent on chroma instead: ${round(start.c, 4)} -> ${round(best.chroma, 4)}` +
        ` (${delta > 0 ? '+' : ''}${delta}) at fixed lightness and hue, so the state is visible again`,
    })
  }

  return rescues
}

/**
 * Rendered perceptual distance the selected-row tint aims for, away from
 * `surface`.
 *
 * The rule this replaced asked for a fixed *chroma* -- `min(primary.c, 0.05)`
 * -- and let the sRGB gamut decide what actually landed. Quality run #2
 * measured the result on screen: 0.025 on stripe-light, 0.029 on messy-mixed,
 * 0.051 on linear-dark, 0.054 on ghost-warm. One rule, a 2.2x spread, and two
 * opposite verdicts from the same reviewer -- ghost-warm's selected row was
 * "the loudest thing on the page", stripe-light's was "near-invisible". A light
 * blue at surface lightness has almost no chroma headroom in sRGB and a light
 * green has plenty, so the number that was *asked for* was never the number
 * anybody saw.
 *
 * 0.04 is the middle of that measured range, which is what "a sensible mid"
 * means here: it quiets the two kits that shouted and lifts the two that
 * whispered, and every kit now lands on it rather than near it.
 */
export const SELECTED_SURFACE_SEPARATION = 0.04

/** Search step for the tint. Fine enough to hit the target, coarse enough to stay legible. */
const TINT_STEP = 0.0025

/**
 * The selected-row tint: the primary hue over `surface`, at a fixed *rendered*
 * distance rather than a fixed chroma.
 *
 * Two axes, spent in a fixed order, because they say different things. Hue is
 * spent first -- selection reads by colour where hover reads by lightness, and
 * that separation is what keeps the two states from becoming one. Lightness is
 * the top-up, and only for a palette whose brand hue cannot survive far enough
 * out of the gamut at this lightness to carry the whole distance on its own.
 *
 * Both walks stop at the first step that reaches the target, so the tint moves
 * as little as it has to and the result is a pure function of the two inputs.
 */
function selectedTint(
  surface: Oklch,
  primary: Oklch,
  forward: 1 | -1,
): { color: Oklch; distance: number; spent: string } {
  const ceiling = Math.min(primary.c, NEUTRAL_CHROMA_MAX)
  const at = (lightness: number, chroma: number): Oklch => ({
    l: round(clamp(lightness, 0, 1), 4),
    c: round(chroma, 4),
    h: primary.h,
  })

  const baseLightness = surface.l + forward * 0.02
  let chroma = 0
  let best = { color: at(baseLightness, 0), distance: renderedDistance(at(baseLightness, 0), surface) }
  for (let candidate = TINT_STEP; candidate <= ceiling + 1e-9; candidate = round(candidate + TINT_STEP, 4)) {
    const color = at(baseLightness, candidate)
    const distance = renderedDistance(color, surface)
    if (distance <= best.distance) continue
    chroma = candidate
    best = { color, distance }
    if (distance >= SELECTED_SURFACE_SEPARATION) break
  }

  if (best.distance >= SELECTED_SURFACE_SEPARATION) {
    return {
      color: best.color,
      distance: best.distance,
      spent: `on hue alone at chroma ${round(chroma, 4)}`,
    }
  }

  // The hue ran out of gamut before the target. Walk the lightness offset out
  // from 0.02 until the pair reaches it, so a tint the screen cannot saturate
  // is still a tint the reader can see.
  let lightness = baseLightness
  for (let extra = TINT_STEP; extra <= 0.2; extra = round(extra + TINT_STEP, 4)) {
    const candidate = surface.l + forward * (0.02 + extra)
    const color = at(candidate, chroma)
    if (color.l === best.color.l) break
    lightness = candidate
    best = { color, distance: renderedDistance(color, surface) }
    if (best.distance >= SELECTED_SURFACE_SEPARATION) break
  }
  return {
    color: best.color,
    distance: best.distance,
    spent:
      `on hue at chroma ${round(chroma, 4)} -- all this hue renders at surface lightness -- then on lightness` +
      ` ${forward > 0 ? '+' : '-'}${round(Math.abs(lightness - surface.l), 4)}`,
  }
}

/**
 * Interaction and state shades for the roles that need them.
 *
 * Hover moves a surface one step toward the viewer -- lighter on dark, darker on
 * light -- which is the convention every mainstream kit follows. These are
 * always derived: hover, pressed, selected and disabled states are almost never
 * in a static capture, and guessing them from one stray observation would be
 * worse than computing them consistently.
 *
 * Nothing here is contrast-checked yet. The caller runs the guarantee over the
 * results, because a derived shade that quietly drops its label below AA is the
 * exact failure this layer exists to prevent.
 *
 * `pinned` names roles this function must not produce. Distillation pins
 * nothing; a replay of user overrides pins every role a human set, so a shade
 * the reviewer chose by hand is neither recomputed nor -- because `find` then
 * falls through to `base` -- used at anything but the value they gave it by the
 * shades derived from it.
 */
export function deriveInteractionShades(
  base: ReadonlyArray<RoleAssignment>,
  mode: Mode,
  pinned: ReadonlySet<ColorRoleName> = new Set(),
): RoleAssignment[] {
  const forward = forwardDirection(mode)
  const out: RoleAssignment[] = []
  const find = (role: ColorRoleName): RoleAssignment | undefined =>
    out.find((assignment) => assignment.role === role) ??
    base.find((assignment) => assignment.role === role)

  const shade = (
    role: ColorRoleName,
    from: ColorRoleName,
    delta: number,
    label: string,
  ): void => {
    if (pinned.has(role)) return
    const source = find(from)
    if (!source) return
    const lightness = clamp(source.color.l + forward * delta, 0, 1)
    out.push({
      role,
      color: withLightness(source.color, lightness),
      rule: 'oklch-lightness-offset',
      detail: `${label}: ${from} lightness ${forward > 0 ? '+' : '-'}${delta} (${mode} mode moves ${forward > 0 ? 'lighter' : 'darker'} on interaction), yielding ${oklchToHex(withLightness(source.color, lightness))}`,
      derivedFrom: [from],
    })
  }

  shade('surfaceHover', 'surface', 0.03, 'surface hover state')
  shade('primaryHover', 'primary', 0.04, 'primary hover state')
  shade('primaryActive', 'primary', 0.08, 'primary pressed state')
  shade('disabledSurface', 'surface', 0.06, 'disabled control fill')

  // --- selectedSurface ------------------------------------------------------
  // A selected row is a brand tint, not a darker grey: it has to stay
  // distinguishable from the hover state that sits next to it, and hue is the
  // only axis hover is not already using. The chroma cap is the engine's own
  // neutral threshold, so the result is a tinted neutral rather than a second
  // brand colour.
  const surface = find('surface')
  const primary = find('primary')
  if (surface && primary && !pinned.has('selectedSurface')) {
    const tint = selectedTint(surface.color, primary.color, forward)
    out.push({
      role: 'selectedSurface',
      color: tint.color,
      rule: 'brand-tinted-surface',
      detail:
        `selected row fill: the primary hue (${round(primary.color.h ?? 0, 2)}) laid over surface at a rendered` +
        ` perceptual distance of ${round(tint.distance, 4)} (target ${SELECTED_SURFACE_SEPARATION}), spent` +
        ` ${tint.spent}, so selection reads at the same strength on every palette rather than at whatever` +
        ` chroma this hue happens to survive the sRGB gamut with, yielding ${oklchToHex(tint.color)}`,
      derivedFrom: ['surface', 'primary'],
    })
  }

  // --- disabledForeground ---------------------------------------------------
  const disabledSurface = find('disabledSurface')
  const textMuted = find('textMuted')
  if (disabledSurface && textMuted && !pinned.has('disabledForeground')) {
    const lightness = clamp(
      textMuted.color.l + (disabledSurface.color.l - textMuted.color.l) * DISABLED_FOREGROUND_FADE,
      0,
      1,
    )
    const color = withLightness(textMuted.color, lightness)
    out.push({
      role: 'disabledForeground',
      color,
      rule: 'lightness-interpolation',
      detail: `disabled label: textMuted moved ${round(DISABLED_FOREGROUND_FADE * 100, 0)}% toward disabledSurface so the control reads inactive, yielding ${oklchToHex(color)}; the contrast floor stops it going further`,
      derivedFrom: ['textMuted', 'disabledSurface'],
    })
  }

  return out
}

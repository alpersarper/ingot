/**
 * The distillation entry point.
 *
 * `distill(set)` is a pure function: same capture set in, byte-identical tokens
 * document out. It performs no I/O, reads no clock, and calls no network. The
 * absence of a `generatedAt` field in the output is deliberate -- a timestamp
 * would make every regeneration a diff and destroy the determinism guarantee.
 */
import { byNumber, byString, chain } from './util/sort'
import { validateCaptureSet } from './capture/validate'
import type { CaptureRecord, CaptureSet } from './capture/types'
import { readBorderWidths, readRadii, readSpacing } from './capture/read'
import { clusterColors, readColors } from './color/cluster'
import type { ColorCluster } from './color/cluster'
import {
  assignRoles,
  collapsedShades,
  collapsedShadesSentence,
  deriveInteractionShades,
  detectMode,
  restoreStateSeparation,
} from './color/roles'
import type { RoleAssignment, SeparationGuard } from './color/roles'
import {
  CONTRAST_FLOOR,
  DISABLED_CONTRAST_FLOOR,
  enforceContrast,
  enforceContrastByChroma,
  enforceContrastOnBackground,
} from './color/contrast'
import type { ContrastAdjustment, ContrastPair } from './color/contrast'
import { contrastRatio, formatOklch, oklchToHex, roundOklch } from './color/space'
import type { Oklch } from './color/space'
import { decide, derive, provenance, tally } from './provenance'
import { distillSpacing } from './spacing/spacing'
import { distillBorder } from './border/border'
import { distillRadius } from './radius/radius'
import { distillShadows } from './shadow/shadow'
import { distillTypography } from './typography/typography'
import { distillComponents } from './components/components'
import { ENGINE_NAME, ENGINE_VERSION } from './version'
import { asPristine } from './tokens/documents'
import type { PristineTokens } from './tokens/documents'
import { TOKENS_SCHEMA_VERSION } from './tokens/types'
import { round } from './util/num'
import type {
  ColorRoleName,
  ColorToken,
  ColorTokens,
  Diagnostic,
  TokensDocument,
} from './tokens/types'

/**
 * Order roles are emitted in. Fixed rather than alphabetical so the document
 * reads structurally -- page, then surfaces, then text, then brand.
 */
const ROLE_ORDER: ColorRoleName[] = [
  'background',
  'surface',
  'surfaceHover',
  'selectedSurface',
  'border',
  'text',
  'textMuted',
  'primary',
  'primaryHover',
  'primaryActive',
  'primaryForeground',
  'destructive',
  'destructiveForeground',
  'disabledSurface',
  'disabledForeground',
]

/** One pairing the engine guarantees, and which side yields when it fails. */
interface GuaranteedPair {
  foreground: ColorRoleName
  backgrounds: ColorRoleName[]
  /** Defaults to {@link CONTRAST_FLOOR}. */
  floor?: number
  /**
   * Which colour moves. `foreground` is the default and the house rule -- a
   * foreground carries less identity than the surface behind it. `background`
   * is for a foreground already pinned at a gamut pole, where only the surface
   * has anywhere to go.
   */
  move?: 'foreground' | 'background'
}

/**
 * Pairs enforced against the roles the captures supplied.
 *
 * `text` and `textMuted` must clear both the page background and panel
 * surfaces, because a kit cannot control which one a component lands on.
 * `destructive` is here as a *foreground*: the exported spec presents it as an
 * error-text colour as well as a fill, so it has to be legible on the surfaces
 * that error text lands on. It is enforced before `destructiveForeground` so
 * that pair sees the settled value rather than the captured one.
 */
const BASE_PAIRS: ReadonlyArray<GuaranteedPair> = [
  { foreground: 'text', backgrounds: ['background', 'surface'] },
  { foreground: 'textMuted', backgrounds: ['background', 'surface'] },
  { foreground: 'primaryForeground', backgrounds: ['primary'] },
  { foreground: 'destructive', backgrounds: ['background', 'surface'] },
  { foreground: 'destructiveForeground', backgrounds: ['destructive'] },
]

/**
 * Pairs enforced against the derived interaction and state surfaces.
 *
 * These are the pairs the engine used to compute and never check. A hover shade
 * is an offset of a role that already passed, and an offset is not a guarantee:
 * on a dark kit the hover lift moves the fill *toward* its white label, so
 * every interaction made the label worse while the exported contrast table
 * still read as complete.
 *
 * The derived surface yields, not the base role, wherever the foreground is
 * pinned -- a shade exists to serve a role, so it is the shade that gives way.
 */
const DERIVED_PAIRS: ReadonlyArray<GuaranteedPair> = [
  {
    foreground: 'primaryForeground',
    backgrounds: ['primaryHover', 'primaryActive'],
    move: 'background',
  },
  { foreground: 'text', backgrounds: ['surfaceHover', 'selectedSurface'] },
  { foreground: 'textMuted', backgrounds: ['surfaceHover', 'selectedSurface'] },
  {
    foreground: 'disabledForeground',
    backgrounds: ['disabledSurface'],
    floor: DISABLED_CONTRAST_FLOOR,
  },
]

/**
 * Record a contrast move, folding it into any earlier move of the same role.
 *
 * A role can be pushed twice -- once to clear the page surfaces, again to clear
 * a derived surface that did not exist on the first pass. Merging keeps the
 * *captured* value as the origin, so the record still answers "what did this
 * colour start as", and reports the whole journey in one reason.
 *
 * Returns the record the map actually holds -- `next` itself when the role had
 * none, the merged record otherwise -- so a caller that needs to amend the
 * record afterwards amends the stored one rather than a discarded input.
 */
function recordAdjustment(
  adjustments: Map<ColorRoleName, ContrastAdjustment>,
  role: ColorRoleName,
  next: ContrastAdjustment,
): ContrastAdjustment {
  const existing = adjustments.get(role)
  if (!existing) {
    adjustments.set(role, next)
    return next
  }
  existing.against = [...new Set([...existing.against, ...next.against])]
  existing.to = next.to
  existing.deltaL = round(next.to.lightness - existing.from.lightness, 4)
  existing.ratioAfter = next.ratioAfter
  existing.met = next.met
  existing.reason = `${existing.reason}; then ${next.reason}`
  return existing
}

function colorToken(
  assignment: RoleAssignment,
  color: Oklch,
  adjustment?: ContrastAdjustment,
  rescue?: string,
): ColorToken {
  const rounded = roundOklch(color)
  const value = {
    oklch: formatOklch(color),
    hex: oklchToHex(color),
    lightness: rounded.l,
    chroma: rounded.c,
    hue: rounded.c === 0 || rounded.h === undefined ? 0 : rounded.h,
  }

  const cluster = assignment.cluster
  const observed = cluster
    ? tally(
        cluster.members.flatMap((member) =>
          member.captureIds.map((captureId) => ({ value: member.hex, captureId })),
        ),
      )
    : []

  const decision = cluster
    ? decide('role-assignment', cluster.hex, observed, { unit: 'observation' })
    : derive(value.hex, {
        method: assignment.rule,
        from: assignment.derivedFrom.map((role) => `color.roles.${role}`),
        detail: assignment.detail,
      })

  if (cluster) {
    decision.summary = `${assignment.rule}: ${assignment.detail}`
    if (cluster.members.length > 1) {
      decision.summary += `; merged ${cluster.members.length} near-duplicate colours into ${cluster.hex}`
    }
  }

  // The decision is built from the value that won the role, which is not
  // necessarily the value that ships: the contrast floor may have moved it
  // afterwards. A summary that stops at the winner hands the reader a hex the
  // rest of the document says is inaccessible, so carry the move into it.
  if (adjustment) {
    const direction = adjustment.deltaL < 0 ? 'darkened' : adjustment.deltaL > 0 ? 'lightened' : 'adjusted'
    const against = adjustment.against.map((path) => path.replace('color.roles.', '')).join(', ')
    decision.summary +=
      `; then ${direction} for contrast against ${against}` +
      ` (${adjustment.ratioBefore}:1 -> ${adjustment.ratioAfter}:1)`
  }

  // The state rescue reads last because it happens last: it is the move that
  // answers what the contrast walk cost, and a summary that named it earlier
  // would have the reader believe the floor was never reached.
  if (rescue) decision.summary += `; ${rescue}`
  if (adjustment || rescue) decision.summary += `, yielding ${value.hex}`

  return {
    value,
    provenance: provenance(observed, decision),
    ...(adjustment ? { contrastAdjustment: adjustment } : {}),
  }
}

/** {@link distillColor}'s output: the emitted tokens plus what later stages need. */
interface ColorResult {
  tokens: ColorTokens
  /**
   * The role a capture's own background colour resolved to, when any. Lets the
   * component layer tell a primary-filled button from a secondary one without
   * re-deriving the clustering.
   */
  backgroundRoleByCapture: Map<string, ColorRoleName>
}

function distillColor(
  captures: readonly CaptureRecord[],
  diagnostics: Diagnostic[],
): ColorResult {
  const observations = readColors(captures)
  const clusters = clusterColors(observations)
  const mode = detectMode(clusters)

  const assignments = assignRoles(clusters, mode)

  const byRole = new Map<ColorRoleName, RoleAssignment>()
  for (const assignment of assignments) byRole.set(assignment.role, assignment)

  const colors = new Map<ColorRoleName, Oklch>()
  for (const [role, assignment] of byRole) colors.set(role, assignment.color)

  // --- contrast enforcement -------------------------------------------------
  // Foregrounds move first. Only when a foreground is already pinned at black
  // or white does the brand surface underneath it move instead.
  const adjustments = new Map<ColorRoleName, ContrastAdjustment>()
  const pathOf = (role: ColorRoleName): string => `color.roles.${role}`
  const backgroundsOf = (
    roles: readonly ColorRoleName[],
  ): Array<{ role: ColorRoleName; path: string; color: Oklch }> =>
    roles
      .map((role) => ({ role, path: pathOf(role), color: colors.get(role) }))
      .filter((entry): entry is { role: ColorRoleName; path: string; color: Oklch } => entry.color !== undefined)

  /** Move the foreground away from every background it has to clear. */
  const enforceForeground = (pair: GuaranteedPair, roles: readonly ColorRoleName[]): void => {
    const foreground = colors.get(pair.foreground)
    if (foreground === undefined) return
    const backgrounds = backgroundsOf(roles)
    if (backgrounds.length === 0) return
    const floor = pair.floor ?? CONTRAST_FLOOR

    const result = enforceContrast(pathOf(pair.foreground), foreground, backgrounds, floor)
    colors.set(pair.foreground, result.color)
    const hadPriorRecord = adjustments.has(pair.foreground)
    const stored = result.adjustment
      ? recordAdjustment(adjustments, pair.foreground, result.adjustment)
      : undefined

    const survivor = backgrounds[0]
    if (result.adjustment && stored && !result.adjustment.met && backgrounds.length === 1 && survivor) {
      const backgroundRole = survivor.role
      const nudged = enforceContrastOnBackground(
        pathOf(backgroundRole),
        survivor.color,
        { path: pathOf(pair.foreground), color: result.color },
        floor,
      )
      colors.set(backgroundRole, nudged.color)
      if (nudged.adjustment) recordAdjustment(adjustments, backgroundRole, nudged.adjustment)

      if (nudged.adjustment?.met) {
        // The foreground had nowhere to go, so its own record would claim an
        // unmet floor that the background move has since closed. Drop the
        // record only when this pass created it and it records no movement;
        // a record merged from an earlier pass carries real history and is
        // amended instead.
        if (result.adjustment.deltaL === 0 && !hadPriorRecord) {
          adjustments.delete(pair.foreground)
        } else {
          stored.ratioAfter = nudged.adjustment.ratioAfter
          stored.met = true
          stored.reason += `; ${backgroundRole} then moved to close the remaining gap`
        }
      }
    }
  }

  /**
   * Move the surface instead, one background at a time.
   *
   * Lightness first, because that is the axis the shade was derived on and
   * walking it back only shortens the offset. When lightness runs out -- a white
   * label on a mid-brand fill in dark mode has no lighter fill to sit on --
   * chroma takes over: it changes luminance without touching the lightness
   * coordinate, and hue, which is the brand, never moves at all.
   */
  const enforceSurfaces = (pair: GuaranteedPair): void => {
    const foreground = colors.get(pair.foreground)
    if (foreground === undefined) return
    const floor = pair.floor ?? CONTRAST_FLOOR
    const against = { path: pathOf(pair.foreground), color: foreground }

    for (const entry of backgroundsOf(pair.backgrounds)) {
      const nudged = enforceContrastOnBackground(entry.path, entry.color, against, floor)
      if (!nudged.adjustment) continue
      colors.set(entry.role, nudged.color)
      recordAdjustment(adjustments, entry.role, nudged.adjustment)

      if (nudged.adjustment.met) continue
      const saturated = enforceContrastByChroma(entry.path, nudged.color, against, floor)
      if (!saturated.adjustment) continue
      colors.set(entry.role, saturated.color)
      recordAdjustment(adjustments, entry.role, saturated.adjustment)
    }
  }

  for (const pair of BASE_PAIRS) enforceForeground(pair, pair.backgrounds)

  // Interaction and state shades are derived only now, after contrast
  // enforcement may have moved their base role, so a hover state never drifts
  // away from the colour it is a state of.
  for (const shade of deriveInteractionShades(
    assignments.map((assignment) => ({ ...assignment, color: colors.get(assignment.role) ?? assignment.color })),
    mode,
  )) {
    byRole.set(shade.role, shade)
    colors.set(shade.role, shade.color)
  }

  // Then guarantee the pairs those shades created. A foreground that already
  // cleared the page surfaces is re-enforced against the union of old and new
  // backgrounds, so closing the new gap can never reopen an old one.
  for (const pair of DERIVED_PAIRS) {
    if (pair.move === 'background') enforceSurfaces(pair)
    else {
      const base = BASE_PAIRS.find((entry) => entry.foreground === pair.foreground)
      enforceForeground(pair, [...(base?.backgrounds ?? []), ...pair.backgrounds])
    }
  }

  // A state the contrast walk just flattened is bought back on the chroma axis
  // before anything is reported: a hover the reviewer cannot see is a defect,
  // and the diagnostic is the answer only once the palette really has no room.
  // Every guarantee made above bounds the walk, so this can never reopen one.
  const guardsOf = (role: ColorRoleName): SeparationGuard[] => {
    const guards: SeparationGuard[] = []
    for (const pair of DERIVED_PAIRS) {
      if (!pair.backgrounds.includes(role)) continue
      const foreground = colors.get(pair.foreground)
      if (foreground !== undefined) guards.push({ color: foreground, floor: pair.floor ?? CONTRAST_FLOOR })
    }
    return guards
  }
  const rescues = new Map<ColorRoleName, string>()
  for (const rescue of restoreStateSeparation((role) => colors.get(role), guardsOf)) {
    colors.set(rescue.role, rescue.color)
    rescues.set(rescue.role, rescue.detail)

    // The walk that preceded the rescue is one record, and it now names a hex
    // and a ratio that are no longer the shipped ones. Amending it rather than
    // adding a second record keeps `design.md`'s "moved away from" table a
    // description of where the colour actually ended up.
    const adjustment = adjustments.get(rescue.role)
    if (adjustment === undefined) continue
    const guards = guardsOf(rescue.role)
    const ratioAfter = guards.reduce(
      (worst, guard) => Math.min(worst, contrastRatio(guard.color, rescue.color)),
      21,
    )
    adjustment.to = {
      hex: oklchToHex(rescue.color),
      oklch: formatOklch(rescue.color),
      lightness: round(rescue.color.l, 4),
    }
    adjustment.ratioAfter = ratioAfter
    adjustment.met = guards.every((guard) => contrastRatio(guard.color, rescue.color) >= guard.floor)
    adjustment.reason += `; the offset that bought was invisible, so chroma moved at fixed lightness to restore the state (${ratioAfter}:1)`
  }

  // --- final ratios ---------------------------------------------------------
  const contrast: ContrastPair[] = []
  const seenPairs = new Set<string>()
  for (const pair of [...BASE_PAIRS, ...DERIVED_PAIRS]) {
    const foreground = colors.get(pair.foreground)
    if (foreground === undefined) continue
    const floor = pair.floor ?? CONTRAST_FLOOR
    for (const backgroundRole of pair.backgrounds) {
      const background = colors.get(backgroundRole)
      if (background === undefined) continue
      const key = `${pair.foreground}|${backgroundRole}`
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const ratio = contrastRatio(foreground, background)
      contrast.push({
        foreground: pathOf(pair.foreground),
        background: pathOf(backgroundRole),
        ratio,
        floor,
        passes: ratio >= floor,
      })
    }
  }

  const collapsed = collapsedShades((role) => colors.get(role))
  if (collapsed.length > 0) {
    diagnostics.push({
      level: 'info',
      code: 'color.state-collapsed',
      path: 'color.roles',
      message:
        `${collapsedShadesSentence(collapsed)}. Holding the foreground at the contrast floor consumed the ` +
        'offset, and the palette had no chroma left to buy it back. The state exists in the token set but ' +
        'cannot be seen; distinguish it with something other than fill.',
    })
  }

  // Diagnostics are raised from the *final* ratios, so a foreground that could
  // not clear the floor on its own is not reported as a failure once the
  // background moved to meet it.
  const failingRoles = new Set(
    contrast
      .filter((pair) => !pair.passes)
      .flatMap((pair) => [pair.foreground, pair.background]),
  )
  for (const adjustment of adjustments.values()) {
    const unresolved = failingRoles.has(adjustment.role)
    diagnostics.push({
      level: unresolved ? 'warning' : 'info',
      code: unresolved ? 'color.contrast-unmet' : 'color.contrast-adjusted',
      path: adjustment.role,
      message: `${adjustment.role} vs ${adjustment.against.join(', ')}: ${adjustment.reason} (${adjustment.from.hex} -> ${adjustment.to.hex}).`,
    })
  }

  const roles: Partial<Record<ColorRoleName, ColorToken>> = {}
  for (const role of ROLE_ORDER) {
    const assignment = byRole.get(role)
    const color = colors.get(role)
    if (!assignment || color === undefined) continue
    roles[role] = colorToken(assignment, color, adjustments.get(role), rescues.get(role))
  }

  const roleOfCluster = new Map<string, ColorRoleName>()
  for (const role of ROLE_ORDER) {
    const assignment = byRole.get(role)
    if (assignment?.cluster && !roleOfCluster.has(assignment.cluster.id)) {
      roleOfCluster.set(assignment.cluster.id, role)
    }
  }

  const palette: ColorTokens['palette'] = clusters
    .map((cluster: ColorCluster) => ({
      hex: cluster.hex,
      oklch: formatOklch(cluster.oklch),
      count: cluster.count,
      channels: { ...cluster.channels },
      captureIds: cluster.captureIds,
      mergedFrom: cluster.members.map((member) => ({ hex: member.hex, count: member.count })),
      role: roleOfCluster.get(cluster.id) ?? null,
    }))
    .sort(chain((a, b) => byNumber(b.count, a.count), (a, b) => byString(a.hex, b.hex)))

  const unused = palette.filter((entry) => entry.role === null)
  if (unused.length > 0) {
    diagnostics.push({
      level: 'info',
      code: 'color.unassigned',
      path: 'color.palette',
      message: `${unused.length} captured colour(s) did not map to a role and are excluded from the kit: ${unused.map((entry) => entry.hex).sort(byString).join(', ')}.`,
    })
  }

  const backgroundRoleByCapture = new Map<string, ColorRoleName>()
  for (const cluster of clusters) {
    const role = roleOfCluster.get(cluster.id)
    if (role === undefined) continue
    for (const captureId of cluster.channelCaptureIds.background) {
      if (!backgroundRoleByCapture.has(captureId)) backgroundRoleByCapture.set(captureId, role)
    }
  }

  return { tokens: { mode, roles, contrast, palette }, backgroundRoleByCapture }
}

/**
 * Distil a validated capture set into a tokens document.
 *
 * The result is the *pristine* document -- what the captures said, with nothing
 * a reviewer decided in it. `tokens/documents.ts` says which question each
 * document class answers.
 *
 * Throws {@link import('./capture/validate').CaptureValidationError} if the set
 * does not satisfy the capture schema.
 */
export function distill(input: unknown): PristineTokens {
  const set: CaptureSet = validateCaptureSet(input)
  const captures = [...set.captures].sort((a, b) => byString(a.id, b.id))
  const diagnostics: Diagnostic[] = []

  const { tokens: color, backgroundRoleByCapture } = distillColor(captures, diagnostics)
  const spacing = distillSpacing(readSpacing(captures), diagnostics)
  const border = distillBorder(readBorderWidths(captures))
  const radius = distillRadius(readRadii(captures), diagnostics)
  const shadow = distillShadows(captures, diagnostics)
  const typography = distillTypography(captures, diagnostics)
  // Last, because a recipe is a sentence written in every scale above it.
  const components = distillComponents(
    captures,
    { color, backgroundRoleByCapture, spacing, border, radius, typography },
    diagnostics,
  )

  const originCounts = new Map<string, number>()
  for (const capture of captures) {
    const match = /^(https?:\/\/[^/]+)/.exec(capture.sourceUrl)
    const origin = match?.[1] ?? capture.sourceUrl
    originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1)
  }
  const origins = [...originCounts.entries()]
    .map(([origin, captureCount]) => ({ origin, captureCount }))
    .sort(chain((a, b) => byNumber(b.captureCount, a.captureCount), (a, b) => byString(a.origin, b.origin)))

  const typeCounts = new Map<string, number>()
  for (const capture of captures) {
    typeCounts.set(capture.componentType, (typeCounts.get(capture.componentType) ?? 0) + 1)
  }

  diagnostics.sort(
    chain<Diagnostic>(
      (a, b) => byNumber(a.level === 'warning' ? 0 : 1, b.level === 'warning' ? 0 : 1),
      (a, b) => byString(a.code, b.code),
      (a, b) => byString(a.message, b.message),
    ),
  )

  return asPristine({
    schemaVersion: TOKENS_SCHEMA_VERSION,
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
    source: {
      setId: set.id,
      name: set.name,
      description: set.description,
      captureCount: captures.length,
      origins,
      captureIds: captures.map((capture) => capture.id),
      componentTypes: [...typeCounts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort(chain((a, b) => byNumber(b.count, a.count), (a, b) => byString(a.type, b.type))),
    },
    color,
    spacing,
    border,
    radius,
    shadow,
    typography,
    components,
    diagnostics,
  })
}

/**
 * Serialise a tokens document to the exact bytes written to `tokens.json`:
 * two-space indent, trailing newline. Key order comes from insertion order,
 * which every builder above fixes explicitly.
 */
export function serializeTokens(document: TokensDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

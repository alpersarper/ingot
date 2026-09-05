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
import { assignRoles, deriveInteractionShades, detectMode } from './color/roles'
import type { RoleAssignment } from './color/roles'
import { CONTRAST_FLOOR, enforceContrast, enforceContrastOnBackground } from './color/contrast'
import type { ContrastAdjustment, ContrastPair } from './color/contrast'
import { contrastRatio, formatOklch, oklchToHex, roundOklch } from './color/space'
import type { Oklch } from './color/space'
import { decide, derive, provenance, tally } from './provenance'
import { distillSpacing } from './spacing/spacing'
import { distillBorder } from './border/border'
import { distillRadius } from './radius/radius'
import { distillShadows } from './shadow/shadow'
import { distillTypography } from './typography/typography'
import { ENGINE_NAME, ENGINE_VERSION } from './version'
import { TOKENS_SCHEMA_VERSION } from './tokens/types'
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
  'border',
  'text',
  'textMuted',
  'primary',
  'primaryHover',
  'primaryActive',
  'primaryForeground',
  'destructive',
  'destructiveForeground',
]

/**
 * Foreground/background pairs the engine guarantees meet {@link CONTRAST_FLOOR}.
 *
 * `text` and `textMuted` must clear both the page background and panel
 * surfaces, because a kit cannot control which one a component lands on.
 */
const GUARANTEED_PAIRS: ReadonlyArray<{ foreground: ColorRoleName; backgrounds: ColorRoleName[] }> = [
  { foreground: 'text', backgrounds: ['background', 'surface'] },
  { foreground: 'textMuted', backgrounds: ['background', 'surface'] },
  { foreground: 'primaryForeground', backgrounds: ['primary'] },
  { foreground: 'destructiveForeground', backgrounds: ['destructive'] },
]

function colorToken(assignment: RoleAssignment, color: Oklch, adjustment?: ContrastAdjustment): ColorToken {
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

  return {
    value,
    provenance: provenance(observed, decision),
    ...(adjustment ? { contrastAdjustment: adjustment } : {}),
  }
}

function distillColor(
  captures: readonly CaptureRecord[],
  diagnostics: Diagnostic[],
): ColorTokens {
  const observations = readColors(captures)
  const clusters = clusterColors(observations)
  const mode = detectMode(clusters)

  const assignments = assignRoles(clusters, mode)
  const withShades = [...assignments, ...deriveInteractionShades(assignments, mode)]

  const byRole = new Map<ColorRoleName, RoleAssignment>()
  for (const assignment of withShades) byRole.set(assignment.role, assignment)

  const colors = new Map<ColorRoleName, Oklch>()
  for (const [role, assignment] of byRole) colors.set(role, assignment.color)

  // --- contrast enforcement -------------------------------------------------
  // Foregrounds move first. Only when a foreground is already pinned at black
  // or white does the brand surface underneath it move instead.
  const adjustments = new Map<ColorRoleName, ContrastAdjustment>()
  for (const pair of GUARANTEED_PAIRS) {
    const foreground = colors.get(pair.foreground)
    if (foreground === undefined) continue
    const backgrounds = pair.backgrounds
      .map((role) => ({ path: `color.roles.${role}`, color: colors.get(role) }))
      .filter((entry): entry is { path: string; color: Oklch } => entry.color !== undefined)
    if (backgrounds.length === 0) continue

    const result = enforceContrast(`color.roles.${pair.foreground}`, foreground, backgrounds, CONTRAST_FLOOR)
    colors.set(pair.foreground, result.color)
    if (result.adjustment) adjustments.set(pair.foreground, result.adjustment)

    if (result.adjustment && !result.adjustment.met && backgrounds.length === 1) {
      const backgroundRole = pair.backgrounds[0] as ColorRoleName
      const backgroundColor = colors.get(backgroundRole)
      if (backgroundColor) {
        const nudged = enforceContrastOnBackground(
          `color.roles.${backgroundRole}`,
          backgroundColor,
          { path: `color.roles.${pair.foreground}`, color: result.color },
          CONTRAST_FLOOR,
        )
        colors.set(backgroundRole, nudged.color)
        if (nudged.adjustment) adjustments.set(backgroundRole, nudged.adjustment)

        if (nudged.adjustment?.met) {
          // The foreground had nowhere to go, so its own record would claim an
          // unmet floor that the background move has since closed. Drop the
          // no-op record; keep it only if the foreground genuinely moved.
          if (result.adjustment.deltaL === 0) {
            adjustments.delete(pair.foreground)
          } else {
            result.adjustment.ratioAfter = nudged.adjustment.ratioAfter
            result.adjustment.met = true
            result.adjustment.reason += `; ${backgroundRole} then moved to close the remaining gap`
          }
        }
      }
    }
  }

  // Interaction shades are recomputed after their base role may have moved, so
  // a hover state never drifts away from the colour it is a state of.
  for (const [shade, base, delta] of [
    ['surfaceHover', 'surface', 0.03],
    ['primaryHover', 'primary', 0.04],
    ['primaryActive', 'primary', 0.08],
  ] as ReadonlyArray<[ColorRoleName, ColorRoleName, number]>) {
    const baseColor = colors.get(base)
    const assignment = byRole.get(shade)
    if (!baseColor || !assignment) continue
    const direction = mode === 'dark' ? 1 : -1
    const next: Oklch = { ...baseColor, l: Math.min(1, Math.max(0, baseColor.l + direction * delta)) }
    colors.set(shade, next)
    assignment.detail = `${base} lightness ${direction > 0 ? '+' : '-'}${delta} (${mode} mode moves ${direction > 0 ? 'lighter' : 'darker'} on interaction), yielding ${oklchToHex(next)}`
  }

  // --- final ratios ---------------------------------------------------------
  const contrast: ContrastPair[] = []
  for (const pair of GUARANTEED_PAIRS) {
    const foreground = colors.get(pair.foreground)
    if (foreground === undefined) continue
    for (const backgroundRole of pair.backgrounds) {
      const background = colors.get(backgroundRole)
      if (background === undefined) continue
      const ratio = contrastRatio(foreground, background)
      contrast.push({
        foreground: `color.roles.${pair.foreground}`,
        background: `color.roles.${backgroundRole}`,
        ratio,
        floor: CONTRAST_FLOOR,
        passes: ratio >= CONTRAST_FLOOR,
      })
    }
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
    roles[role] = colorToken(assignment, color, adjustments.get(role))
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

  return { mode, roles, contrast, palette }
}

/**
 * Distil a validated capture set into a tokens document.
 *
 * Throws {@link import('./capture/validate').CaptureValidationError} if the set
 * does not satisfy the capture schema.
 */
export function distill(input: unknown): TokensDocument {
  const set: CaptureSet = validateCaptureSet(input)
  const captures = [...set.captures].sort((a, b) => byString(a.id, b.id))
  const diagnostics: Diagnostic[] = []

  const color = distillColor(captures, diagnostics)
  const spacing = distillSpacing(readSpacing(captures), diagnostics)
  const border = distillBorder(readBorderWidths(captures))
  const radius = distillRadius(readRadii(captures), diagnostics)
  const shadow = distillShadows(captures, diagnostics)
  const typography = distillTypography(captures, diagnostics)

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

  return {
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
    diagnostics,
  }
}

/**
 * Serialise a tokens document to the exact bytes written to `tokens.json`:
 * two-space indent, trailing newline. Key order comes from insertion order,
 * which every builder above fixes explicitly.
 */
export function serializeTokens(document: TokensDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Component recipes and interaction states.
 *
 * The scales above this module say which values exist. They do not say what a
 * button is -- and a consumer that is told "8px and 12px are both on the scale"
 * but not "a button is 8px by 12px" invents the answer, differently every time.
 * This module closes that gap: for each control the kit has to be able to
 * describe, it emits one height, one padding pair, one radius step, one type
 * step and one weight.
 *
 * Three sources of authority, kept apart in provenance so a reader can always
 * tell them apart:
 *
 *   - **observed** -- captured buttons and inputs already carry padding, font
 *     size, weight and radius, so those recipes are measured, not invented.
 *   - **derived** -- a select is a text field with a chevron, and a table cell
 *     is a text container at the same optical density; both take their geometry
 *     from a recipe that *was* observed.
 *   - **sanctioned default** -- nothing in a capture set describes a focus ring
 *     or a badge. Emitting a stated default is what stops two consumers of one
 *     kit shipping two different products; labelling it as a default is what
 *     stops a reader mistaking it for evidence.
 */
import { byNumber, byString, chain } from '../util/sort'
import { round } from '../util/num'
import { snapSpacing } from '../spacing/spacing'
import type { CaptureRecord } from '../capture/types'
import { parsePx } from '../capture/read'
import { parseColor, renderedDistance } from '../color/space'
import { AMBIENT_SEPARATION_MIN } from '../color/roles'
import { DISABLED_CONTRAST_FLOOR } from '../color/contrast'
import { decide, derive, provenance, sanction, tally } from '../provenance'
import type { Contribution, DominantChoice } from '../provenance'
import type {
  BorderTokens,
  ColorRoleName,
  ColorTokens,
  ComponentColors,
  ComponentRecipe,
  ComponentRecipeName,
  ComponentTokens,
  Diagnostic,
  ErrorSignalMode,
  RadiusStepName,
  RadiusTokens,
  SpacingTokens,
  Token,
  TypeStep,
  TypeStepName,
  TypographyTokens,
} from '../tokens/types'

/** Emission order, exported so the override replay can insert into it. */
export const RECIPE_ORDER: ComponentRecipeName[] = [
  'card',
  'button.primary',
  'button.secondary',
  'button.ghost',
  'button.destructive',
  'input',
  'select',
  'table.header',
  'table.row',
  'badge',
]

const RADIUS_ORDER: RadiusStepName[] = ['none', 'sm', 'md', 'lg', 'full']

const PADDING_Y = ['paddingTop', 'paddingBottom'] as const
const PADDING_X = ['paddingLeft', 'paddingRight'] as const
const CORNERS = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
] as const

/**
 * Heaviest weight a header or badge will reach for.
 *
 * A kit that captured a 900 display face should not set its table headers in
 * it; emphasis at this level is a semibold, not a black.
 */
const EMPHASIS_WEIGHT_MAX = 600

/**
 * Focus ring offset, in px.
 *
 * Nothing in a capture set records an outline, so this is a house value: one
 * hairline of daylight, enough to read as a ring around the control rather than
 * as part of its border.
 */
const FOCUS_RING_OFFSET = 2

/** Minimum focus ring width, in px. Below 2px a ring reads as a border. */
const FOCUS_RING_WIDTH_MIN = 2

/**
 * What the kit says out loud about how it signals an error.
 *
 * One owner, two callers: the distiller raises it, and the override replay
 * restates it after a reviewer nominates a colour or acknowledges the absence.
 * A second copy of this sentence is how a kit ends up warning that it cannot
 * signal errors on a screen where a reviewer already settled that it will.
 */
export function errorSignalDiagnostic(mode: ErrorSignalMode): Diagnostic | undefined {
  if (mode === 'color') return undefined
  if (mode === 'acknowledged') {
    return {
      level: 'info',
      code: 'color.no-destructive',
      path: 'components.states.error.mode',
      message:
        'This kit has no destructive colour and a reviewer acknowledged that it ships without one. A form here ' +
        'cannot signal an error in colour, so `design.md` prescribes the non-colour error language instead: ' +
        'an icon, the emphasis weight and an explicit `Error:` prefix on the message. The ' +
        'acknowledgment stands until a person clears it -- if a later capture set supplies a red, that is ' +
        'reported as a conflict rather than quietly taken.',
    }
  }
  return {
    level: 'warning',
    code: 'color.no-destructive',
    path: 'components.states.error.mode',
    message:
      'No captured colour in this set reads as a red, so this kit has no destructive colour -- and a brand ' +
      'decision is the one thing the engine will not default. The consequence is concrete: a form built ' +
      'against this kit cannot signal errors in colour. Either set an error colour on `color.roles.destructive`, or ' +
      'acknowledge that the kit ships without one so `design.md` can prescribe the non-colour error language ' +
      'instead of only stating the prohibition.',
  }
}

/**
 * The destructive button, built from the primary one.
 *
 * A destructive button is a primary button in another colour, and that rule has
 * two callers: the distiller, for a palette whose captures carried a red, and
 * the override replay, for a kit whose reviewer supplied the red the engine
 * refused to invent. Both take this, so the button a nomination produces is the
 * same button a capture would have produced -- same geometry, same borrowed
 * provenance, same sentence explaining where it came from.
 */
export function destructiveButtonFrom(primary: ComponentRecipe): ComponentRecipe {
  const detail = 'nothing described a button.destructive; took the button.primary value'
  const borrowed = (field: string, chosen: string): DominantChoice =>
    derive(chosen, { method: 'same-geometry-as', from: [`components.recipes.button.primary.${field}`], detail })
  return {
    name: 'button.destructive',
    purpose: 'Irreversible actions only. Never for emphasis.',
    colors: {
      surface: 'color.roles.destructive',
      foreground: 'color.roles.destructiveForeground',
      border: null,
      // This kit derives no hover shade for destructive; see the prose.
      hoverSurface: null,
    },
    ...(primary.height === undefined
      ? {}
      : { height: numberToken(primary.height.value, borrowed('height', `${primary.height.value}px`)) }),
    paddingY: numberToken(primary.paddingY.value, borrowed('paddingY', `${primary.paddingY.value}px`)),
    paddingX: numberToken(primary.paddingX.value, borrowed('paddingX', `${primary.paddingX.value}px`)),
    radius: stringToken(primary.radius.value, borrowed('radius', primary.radius.value)),
    typeStep: stringToken(primary.typeStep.value, borrowed('typeStep', primary.typeStep.value)),
    fontWeight: numberToken(
      primary.fontWeight.value,
      borrowed('fontWeight', String(primary.fontWeight.value)),
    ),
  }
}

/** True when a capture paints an opaque fill of its own. */
function hasOpaqueFill(capture: CaptureRecord): boolean {
  const raw = capture.styles.backgroundColor
  return raw !== undefined && parseColor(raw) !== undefined
}

function numberToken(value: number, decision: DominantChoice): Token<number> {
  return { value, provenance: { captureIds: [], observed: [], decision } }
}

function stringToken<T extends string>(value: T, decision: DominantChoice): Token<T> {
  return { value, provenance: { captureIds: [], observed: [], decision } }
}

/**
 * The dominant snapped length across a pool of captures, with the raw values it
 * absorbed. Mirrors the spacing module: `chosen` is the snapped value, which is
 * frequently not a string anybody wrote, so the summary restates the decision
 * in terms of what the step absorbed.
 */
function observedLength(
  pool: readonly CaptureRecord[],
  properties: readonly string[],
  snap: (value: number) => number,
): Token<number> | undefined {
  const contributions: Contribution[] = []
  const snappedCounts = new Map<number, number>()
  for (const capture of pool) {
    for (const property of properties) {
      const raw = (capture.styles as Record<string, string | undefined>)[property]
      const value = parsePx(raw)
      if (raw === undefined || value === undefined || value < 0) continue
      contributions.push({ value: raw, captureId: capture.id })
      const snapped = snap(value)
      snappedCounts.set(snapped, (snappedCounts.get(snapped) ?? 0) + 1)
    }
  }
  if (contributions.length === 0) return undefined

  const ranked = [...snappedCounts.entries()].sort(
    chain<[number, number]>((a, b) => byNumber(b[1], a[1]), (a, b) => byNumber(a[0], b[0])),
  )
  const winner = ranked[0] as [number, number]
  const px = winner[0]

  const observed = tally(contributions)
  const decision = decide('snapped-scale', `${px}px`, observed, { unit: 'length' })
  decision.chosenCount = winner[1]
  decision.totalCount = contributions.length
  decision.confidence = round(winner[1] / contributions.length, 3)
  decision.competitors = ranked
    .slice(1)
    .map(([value, count]) => ({ value: `${value}px`, count }))
  const rawList = observed
    .map((entry) => `${entry.value} x${entry.count}`)
    .sort(byString)
    .join(', ')
  decision.summary = `${winner[1]} of ${contributions.length} observed length(s) snapped to ${px}px (${rawList})`
  return { value: px, provenance: provenance(observed, decision) }
}

/**
 * The dominant value of a named-step property, voted once per capture.
 *
 * `order` is the scale the names live on, smallest first. A tie between two
 * steps resolves toward the smaller one rather than toward whichever name sorts
 * first alphabetically: a control should not come out rounder, larger or
 * heavier than half its evidence supports.
 */
function observedStep<T extends string>(
  pool: readonly CaptureRecord[],
  nameOf: (capture: CaptureRecord) => T | undefined,
  unit: string,
  order: readonly T[],
): Token<T> | undefined {
  const contributions: Contribution[] = []
  for (const capture of pool) {
    const name = nameOf(capture)
    if (name === undefined) continue
    contributions.push({ value: name, captureId: capture.id })
  }
  if (contributions.length === 0) return undefined

  const observed = tally(contributions)
  const rank = (value: string): number => {
    const index = order.indexOf(value as T)
    return index === -1 ? order.length : index
  }
  const winner = [...observed].sort(
    chain<{ value: string; count: number }>(
      (a, b) => byNumber(b.count, a.count),
      (a, b) => byNumber(rank(a.value), rank(b.value)),
      (a, b) => byString(a.value, b.value),
    ),
  )[0] as { value: string }

  return {
    value: winner.value as T,
    provenance: provenance(observed, decide('dominant-value', winner.value, observed, { unit })),
  }
}

export interface ComponentInputs {
  color: ColorTokens
  /** The role a capture's own background colour resolved to, when any. */
  backgroundRoleByCapture: ReadonlyMap<string, ColorRoleName>
  spacing: SpacingTokens
  border: BorderTokens
  radius: RadiusTokens
  typography: TypographyTokens
}

export function distillComponents(
  captures: readonly CaptureRecord[],
  inputs: ComponentInputs,
  diagnostics: Diagnostic[],
): ComponentTokens {
  const { color, backgroundRoleByCapture, spacing, border, radius, typography } = inputs
  const hasRole = (role: ColorRoleName): boolean => color.roles[role] !== undefined
  const path = (role: ColorRoleName): string => `color.roles.${role}`

  /**
   * The badge's fill.
   *
   * A badge is the only control in this kit that sits on another control's
   * *interactive* surface: a status pill lives inside a table row, and that row
   * changes colour under the pointer. The obvious quiet fill -- and what this
   * was -- is `surfaceHover`, which is also the row's own hover fill, so on a
   * hovered row the pill and the row became one colour and the pill was left to
   * be read off a 1.2:1 border. Both sides were prescribed here, so a consumer
   * following the kit could not fix it without leaving the system.
   *
   * So the fill is chosen rather than fixed: the first candidate that is
   * perceptibly distinct from the row at rest *and* from the row under the
   * pointer. `background` leads because it is the one neutral the row layer
   * never uses -- a recessed pill on a light kit, a sunken one on a dark kit --
   * and it clears the floor against both on every fixture set. The others are
   * there so a palette with no page/panel separation still gets a badge rather
   * than nothing, and the diagnostic says when that happened.
   */
  const badgeFill = (): { role: ColorRoleName; collides: boolean } => {
    const against: ColorRoleName[] = ['surface', 'surfaceHover']
    const colorOf = (role: ColorRoleName) => {
      const hex = color.roles[role]?.value.hex
      return hex === undefined ? undefined : parseColor(hex)?.oklch
    }
    const distinct = (role: ColorRoleName): boolean => {
      const fill = colorOf(role)
      if (fill === undefined) return false
      return against.every((other) => {
        const layer = colorOf(other)
        return layer === undefined || renderedDistance(fill, layer) >= AMBIENT_SEPARATION_MIN
      })
    }
    const candidates: ColorRoleName[] = ['background', 'surfaceHover', 'surface']
    const chosen = candidates.find(distinct)
    if (chosen !== undefined) return { role: chosen, collides: false }
    return { role: hasRole('surfaceHover') ? 'surfaceHover' : 'surface', collides: true }
  }
  const badgeSurface = badgeFill()
  if (badgeSurface.collides) {
    diagnostics.push({
      level: 'warning',
      code: 'components.badge-collides',
      path: 'components.recipes.badge',
      message:
        `No neutral in this palette is far enough from both \`surface\` and \`surfaceHover\` to fill a badge, ` +
        `so the pill takes \`${badgeSurface.role}\` and will disappear into a table row in at least one of its ` +
        'states. Give the badge its own fill, or draw it as an outline rather than a pill.',
    })
  }

  // --- scale lookups --------------------------------------------------------
  const stepPx = spacing.steps.map((step) => step.value.px).sort(byNumber)
  const smallestPositiveStep = stepPx.find((px) => px > 0) ?? spacing.baseUnit
  const stepAtLeast = (value: number): number => stepPx.find((px) => px >= value) ?? (stepPx[stepPx.length - 1] ?? value)

  const radiusNames = RADIUS_ORDER.filter((name) => radius.steps[name] !== undefined)
  const nearestRadius = (value: number): RadiusStepName => {
    const ranked = radiusNames
      .map((name) => ({ name, px: radius.steps[name]?.value ?? 0 }))
      .sort(
        chain<{ name: RadiusStepName; px: number }>(
          (a, b) => byNumber(Math.abs(a.px - value), Math.abs(b.px - value)),
          (a, b) => byNumber(RADIUS_ORDER.indexOf(a.name), RADIUS_ORDER.indexOf(b.name)),
        ),
      )
    return ranked[0]?.name ?? 'none'
  }
  const preferredRadius = (...candidates: RadiusStepName[]): RadiusStepName =>
    candidates.find((name) => radius.steps[name] !== undefined) ?? (radiusNames[0] ?? 'none')

  const typeSteps = typography.steps.map((step) => step.value)
  const nearestType = (value: number): TypeStepName => {
    const ranked = [...typeSteps].sort(
      chain<TypeStep>(
        (a, b) => byNumber(Math.abs(a.fontSize - value), Math.abs(b.fontSize - value)),
        (a, b) => byNumber(a.fontSize, b.fontSize),
        (a, b) => byString(a.name, b.name),
      ),
    )
    return ranked[0]?.name ?? 'base'
  }
  const typeStepOf = (name: TypeStepName): TypeStep =>
    typeSteps.find((step) => step.name === name) ??
    ({ name, fontSize: typography.baseSize, lineHeight: 1.5, fontWeight: 400 } as TypeStep)
  const typeNamesBySize: TypeStepName[] = [...typeSteps]
    .sort(chain<TypeStep>((a, b) => byNumber(a.fontSize, b.fontSize), (a, b) => byString(a.name, b.name)))
    .map((step) => step.name)
  const smallestType = [...typeSteps].sort(
    chain<TypeStep>((a, b) => byNumber(a.fontSize, b.fontSize), (a, b) => byString(a.name, b.name)),
  )[0]?.name ?? 'base'
  const baseStepName: TypeStepName = typeSteps.some((step) => step.name === 'base') ? 'base' : (typeSteps[0]?.name ?? 'base')
  const stepBelowBase: TypeStepName = (() => {
    const base = typeStepOf(baseStepName)
    const below = typeSteps
      .filter((step) => step.fontSize < base.fontSize)
      .sort(chain<TypeStep>((a, b) => byNumber(b.fontSize, a.fontSize), (a, b) => byString(a.name, b.name)))
    return below[0]?.name ?? baseStepName
  })()

  const weightValues = typography.weights.map((weight) => weight.value.value).sort(byNumber)
  const weightNames = weightValues.map(String)
  const bodyWeight = typeStepOf(baseStepName).fontWeight
  const emphasisWeight =
    [...weightValues].reverse().find((weight) => weight <= EMPHASIS_WEIGHT_MAX) ??
    weightValues[weightValues.length - 1] ??
    bodyWeight

  // --- capture pools --------------------------------------------------------
  const buttons = captures.filter((capture) => capture.componentType === 'button')
  const cards = captures.filter((capture) => capture.componentType === 'card')
  const inputsCaptured = captures.filter((capture) => capture.componentType === 'input')
  const primaryButtons = buttons.filter(
    (capture) => backgroundRoleByCapture.get(capture.id) === 'primary',
  )
  const ghostButtons = buttons.filter((capture) => !hasOpaqueFill(capture))
  const secondaryButtons = buttons.filter(
    (capture) => hasOpaqueFill(capture) && backgroundRoleByCapture.get(capture.id) !== 'primary',
  )

  /** Fall back through progressively broader pools; the last one may be empty. */
  const pool = (...candidates: ReadonlyArray<readonly CaptureRecord[]>): readonly CaptureRecord[] =>
    candidates.find((list) => list.length > 0) ?? []

  interface Draft {
    name: ComponentRecipeName
    purpose: string
    colors: ComponentColors
    captures: readonly CaptureRecord[]
    /**
     * Recipe to copy when this one has nothing of its own. A select is a text
     * field; a destructive button is a primary button in another colour.
     */
    like?: ComponentRecipeName
    /**
     * True for a box that wraps content rather than a control that wraps one
     * line of text. A container emits no `height`: see {@link ComponentRecipe}.
     */
    container?: boolean
    /**
     * Values this recipe states for itself. They beat `like` -- a table cell is
     * an input's padding but never an input's corner radius -- and observation
     * beats them.
     */
    fixed?: {
      paddingY?: number
      paddingX?: number
      paddingDetail?: string
      radius?: RadiusStepName
      typeStep?: TypeStepName
      fontWeight?: number
    }
  }

  const built = new Map<ComponentRecipeName, ComponentRecipe>()
  const defaulted: ComponentRecipeName[] = []

  const build = (draft: Draft): ComponentRecipe => {
    const source = draft.like ? built.get(draft.like) : undefined
    const fixed = draft.fixed ?? {}
    const borrowed = (field: string): string[] => [`components.recipes.${draft.like ?? ''}.${field}`]
    const borrow = `nothing described a ${draft.name}; took the ${draft.like ?? 'source'} value`
    const borderPx = draft.colors.border === null ? 0 : border.width.value
    const missing = (property: string): string =>
      draft.captures.length === 0
        ? `no ${draft.name} was captured`
        : `no captured ${draft.name} carried a ${property}`

    const lengthToken = (
      properties: readonly string[],
      field: 'paddingY' | 'paddingX',
      fixedValue: number | undefined,
      lastResort: number,
    ): Token<number> => {
      const observed = observedLength(draft.captures, properties, (value) => snapSpacing(value, spacing.baseUnit))
      if (observed) return observed
      if (fixedValue !== undefined) {
        return numberToken(
          fixedValue,
          sanction(`${fixedValue}px`, {
            method: 'component-default',
            from: ['spacing.steps'],
            detail: fixed.paddingDetail ?? `${missing('padding')}; used the ${fixedValue}px step`,
          }),
        )
      }
      const from = source?.[field].value
      if (from !== undefined) {
        return numberToken(
          from,
          derive(`${from}px`, { method: 'same-geometry-as', from: borrowed(field), detail: borrow }),
        )
      }
      return numberToken(
        lastResort,
        sanction(`${lastResort}px`, {
          method: 'component-default',
          from: ['spacing.steps'],
          detail: `${draft.captures.length === 0 ? `nothing in this kit describes a ${draft.name}` : `no captured ${draft.name} carried a padding`}; used the ${lastResort}px step`,
        }),
      )
    }

    const paddingY = lengthToken(PADDING_Y, 'paddingY', fixed.paddingY, smallestPositiveStep)
    const paddingX = lengthToken(PADDING_X, 'paddingX', fixed.paddingX, stepAtLeast(smallestPositiveStep * 2))

    const radiusToken =
      observedStep<RadiusStepName>(
        draft.captures,
        (capture) => {
          const corners = CORNERS.map((corner) => parsePx(capture.styles[corner]))
            .filter((value): value is number => value !== undefined)
            .sort(byNumber)
          if (corners.length === 0) return undefined
          return nearestRadius(corners[Math.floor(corners.length / 2)] as number)
        },
        'capture',
        radiusNames,
      ) ??
      (fixed.radius !== undefined
        ? stringToken(
            fixed.radius,
            sanction(fixed.radius, {
              method: 'component-default',
              from: ['radius.steps'],
              detail: `${missing('corner radius')}; \`${fixed.radius}\` is the step this system assigns to that job`,
            }),
          )
        : stringToken(
            source?.radius.value ?? (radiusNames[0] ?? 'none'),
            derive(source?.radius.value ?? 'none', {
              method: 'same-geometry-as',
              from: borrowed('radius'),
              detail: borrow,
            }),
          ))

    const typeStep =
      observedStep<TypeStepName>(
        draft.captures,
        (capture) => {
          const size = parsePx(capture.styles.fontSize)
          return size === undefined ? undefined : nearestType(size)
        },
        'capture',
        typeNamesBySize,
      ) ??
      (fixed.typeStep !== undefined
        ? stringToken(
            fixed.typeStep,
            sanction(fixed.typeStep, {
              method: 'component-default',
              from: ['typography.steps'],
              detail: `${missing('font size')}; set it at the \`${fixed.typeStep}\` step`,
            }),
          )
        : stringToken(
            source?.typeStep.value ?? baseStepName,
            derive(source?.typeStep.value ?? baseStepName, {
              method: 'same-geometry-as',
              from: borrowed('typeStep'),
              detail: borrow,
            }),
          ))

    const observedWeight = observedStep<string>(
      draft.captures,
      (capture) => {
        const raw = capture.styles.fontWeight?.trim()
        return raw !== undefined && /^\d{3}$/.test(raw) ? raw : undefined
      },
      'capture',
      weightNames,
    )
    const fontWeight: Token<number> = observedWeight
      ? { value: Number.parseInt(observedWeight.value, 10), provenance: observedWeight.provenance }
      : fixed.fontWeight !== undefined
        ? numberToken(
            fixed.fontWeight,
            sanction(String(fixed.fontWeight), {
              method: 'component-default',
              from: ['typography.weights'],
              detail: `${missing('usable font weight')}; used ${fixed.fontWeight}, which is in this system's weight set`,
            }),
          )
        : numberToken(
            source?.fontWeight.value ?? bodyWeight,
            derive(String(source?.fontWeight.value ?? bodyWeight), {
              method: 'same-geometry-as',
              from: borrowed('fontWeight'),
              detail: borrow,
            }),
          )

    const step = typeStepOf(typeStep.value)
    const lineBox = round(step.fontSize * step.lineHeight)
    const height = paddingY.value * 2 + lineBox + borderPx * 2
    const heightToken = numberToken(
      height,
      derive(`${height}px`, {
        method: 'box-model-sum',
        from: [
          `components.recipes.${draft.name}.paddingY`,
          `typography.steps.${typeStep.value}`,
          'border.width',
        ],
        detail:
          `${paddingY.value}px padding x 2 + a ${step.fontSize}px/${step.lineHeight} line box (${lineBox}px)` +
          ` + ${borderPx}px border x 2 = ${height}px`,
      }),
    )

    const geometry = [paddingY, paddingX, radiusToken, typeStep, fontWeight]
    if (geometry.every((token) => token.provenance.decision.strategy === 'sanctioned-default')) {
      defaulted.push(draft.name)
    }

    return {
      name: draft.name,
      purpose: draft.purpose,
      colors: draft.colors,
      ...(draft.container === true ? {} : { height: heightToken }),
      paddingY,
      paddingX,
      radius: radiusToken,
      typeStep,
      fontWeight,
    }
  }

  // --- the recipes ----------------------------------------------------------
  // A field reads as a well: in a light kit that is the page colour sitting in a
  // tinted panel, in a dark kit it is the panel colour sitting on the page.
  const fieldSurface: ColorRoleName = color.mode === 'dark' ? 'surface' : 'background'
  const controlRadius = preferredRadius('md', 'sm', 'lg')
  const fieldRadius = preferredRadius('sm', 'md')
  const flushRadius = preferredRadius('none')
  const buttonDefaults = { radius: controlRadius, typeStep: baseStepName, fontWeight: emphasisWeight }

  const drafts: Draft[] = [
    {
      // The box every other recipe is drawn inside, and the one that sets a
      // page's density. Every fixture set captures cards, so its padding and
      // radius are measured rather than invented -- the third of the card a
      // consumer used to have to guess, and the one a `design.md` reader felt
      // first.
      name: 'card',
      purpose: 'Panels, cards and any titled box that holds other components.',
      colors: {
        surface: path('surface'),
        foreground: path('text'),
        border: path('border'),
        hoverSurface: null,
      },
      captures: cards,
      container: true,
      fixed: { radius: preferredRadius('lg', 'md', 'sm'), typeStep: baseStepName, fontWeight: bodyWeight },
    },
    {
      name: 'button.primary',
      purpose: 'The one call to action on a screen.',
      colors: {
        surface: path('primary'),
        foreground: path('primaryForeground'),
        border: null,
        hoverSurface: hasRole('primaryHover') ? path('primaryHover') : null,
      },
      captures: pool(primaryButtons, buttons),
      fixed: buttonDefaults,
    },
    {
      name: 'button.secondary',
      purpose: 'Every other action that is not destructive.',
      colors: {
        surface: path('surface'),
        foreground: path('text'),
        border: path('border'),
        hoverSurface: hasRole('surfaceHover') ? path('surfaceHover') : null,
      },
      captures: pool(secondaryButtons, buttons),
      fixed: buttonDefaults,
    },
    {
      name: 'button.ghost',
      purpose: 'Toolbar and icon actions; transparent until hovered.',
      colors: {
        surface: null,
        foreground: path('text'),
        border: null,
        hoverSurface: hasRole('surfaceHover') ? path('surfaceHover') : null,
      },
      captures: pool(ghostButtons, buttons),
      fixed: buttonDefaults,
    },
    {
      name: 'input',
      purpose: 'Text fields and textareas.',
      colors: {
        surface: path(fieldSurface),
        foreground: path('text'),
        border: path('border'),
        hoverSurface: null,
      },
      captures: pool(inputsCaptured),
      // A set with no input capture still needs a field: borrow the secondary
      // button, which is the same box with the same border.
      ...(inputsCaptured.length > 0 ? {} : { like: 'button.secondary' as ComponentRecipeName }),
      fixed: { radius: fieldRadius, typeStep: baseStepName, fontWeight: bodyWeight },
    },
    {
      name: 'select',
      purpose: 'Native and custom selects. A text field with a chevron.',
      colors: {
        surface: path(fieldSurface),
        foreground: path('text'),
        border: path('border'),
        hoverSurface: null,
      },
      captures: [],
      like: 'input',
    },
    {
      name: 'table.header',
      purpose: 'Column headings. One rule underneath, never a filled band.',
      colors: {
        surface: path('surface'),
        foreground: path('textMuted'),
        border: path('border'),
        hoverSurface: null,
      },
      captures: [],
      // Padding from the field -- a cell is a text container at the same optical
      // density -- but a cell is flush, quieter and heavier than a field.
      like: 'input',
      fixed: { radius: flushRadius, typeStep: stepBelowBase, fontWeight: emphasisWeight },
    },
    {
      name: 'table.row',
      purpose: 'Data rows. Separated by a rule, highlighted on hover.',
      colors: {
        surface: path('surface'),
        foreground: path('text'),
        border: path('border'),
        hoverSurface: hasRole('surfaceHover') ? path('surfaceHover') : null,
      },
      captures: [],
      like: 'input',
      fixed: { radius: flushRadius, typeStep: baseStepName, fontWeight: bodyWeight },
    },
    {
      name: 'badge',
      purpose: 'Status pills inside tables and cards.',
      colors: {
        surface: path(badgeSurface.role),
        foreground: path('text'),
        border: path('border'),
        hoverSurface: null,
      },
      captures: [],
      fixed: {
        paddingY: smallestPositiveStep,
        paddingX: stepAtLeast(smallestPositiveStep * 2),
        paddingDetail:
          'no badge was captured; a status pill gets one spacing step of breathing room vertically and two horizontally',
        radius: preferredRadius('full', 'sm', 'md'),
        typeStep: smallestType,
        fontWeight: emphasisWeight,
      },
    },
  ]

  for (const draft of drafts) built.set(draft.name, build(draft))

  // The destructive button is assembled from `button.primary` by the one
  // function that knows how, because the distiller is not its only builder: a
  // reviewer who nominates the error colour the engine refused to invent gets
  // the same button, built the same way, during the override replay.
  const primaryButton = built.get('button.primary')
  if (primaryButton !== undefined && hasRole('destructive') && hasRole('destructiveForeground')) {
    built.set('button.destructive', destructiveButtonFrom(primaryButton))
  }
  const recipes = RECIPE_ORDER.map((name) => built.get(name)).filter(
    (recipe): recipe is ComponentRecipe => recipe !== undefined,
  )

  if (defaulted.length > 0) {
    diagnostics.push({
      level: 'info',
      code: 'components.defaulted',
      path: 'components.recipes',
      message: `Nothing in the captures or the rest of the kit described these controls: ${defaulted.sort(byString).join(', ')}. Each carries a sanctioned default rather than being omitted, and every defaulted value says so in its provenance.`,
    })
  }

  /**
   * How this kit signals an invalid field.
   *
   * The engine will not invent a brand colour, so a palette with no red gets no
   * `destructive` role -- and that used to be the end of it: `design.md` stated
   * the prohibition and a consumer built a form whose invalid field looked
   * exactly like a valid one. The absence is a *decision* now rather than a
   * silence: `unresolved` says the question is open and names the consequence,
   * and a reviewer answers it by nominating a colour or by acknowledging that
   * the kit ships without one. Neither answer is the engine's to make.
   */
  const errorState = (): ComponentTokens['states']['error'] => {
    if (hasRole('destructive')) {
      return {
        mode: stringToken(
          'color' as const,
          derive('color', {
            method: 'palette-has-destructive',
            from: [path('destructive')],
            detail: `this palette carries a destructive colour (${color.roles.destructive?.value.hex}), so an error state is drawn in it`,
          }),
        ),
        color: path('destructive'),
        foreground: hasRole('destructiveForeground') ? path('destructiveForeground') : null,
      }
    }
    const notice = errorSignalDiagnostic('unresolved')
    if (notice !== undefined) diagnostics.push(notice)
    return {
      mode: stringToken(
        'unresolved' as const,
        derive('unresolved', {
          method: 'palette-has-no-destructive',
          from: ['color.palette'],
          detail:
            'no captured colour reads as a red and the engine will not invent a brand colour, so how this kit ' +
            'signals an error is an open question a person has to answer',
        }),
      ),
      color: null,
      foreground: null,
    }
  }

  // --- states ---------------------------------------------------------------
  // The disabled ratio is read back out of the guarantee rather than recomputed
  // here, so the number this section reports and the number the contrast table
  // reports cannot drift apart.
  const disabledPair = color.contrast.find(
    (pair) =>
      pair.foreground === path('disabledForeground') && pair.background === path('disabledSurface'),
  )

  const ringWidth = Math.max(FOCUS_RING_WIDTH_MIN, border.width.value * 2)
  const states: ComponentTokens['states'] = {
    disabled: {
      surface: path('disabledSurface'),
      foreground: path('disabledForeground'),
      ratio: disabledPair?.ratio ?? 0,
      floor: disabledPair?.floor ?? DISABLED_CONTRAST_FLOOR,
    },
    selected: {
      surface: path('selectedSurface'),
      foreground: path('text'),
    },
    error: errorState(),
    focusRing: {
      colorRole: path('primary'),
      unit: 'px',
      width: numberToken(
        ringWidth,
        derive(`${ringWidth}px`, {
          method: 'double-border-width',
          from: ['border.width'],
          detail: `twice the ${border.width.value}px border width, floored at ${FOCUS_RING_WIDTH_MIN}px, so a ring reads as a ring and not as a thicker border`,
        }),
      ),
      offset: numberToken(
        FOCUS_RING_OFFSET,
        sanction(`${FOCUS_RING_OFFSET}px`, {
          method: 'component-default',
          from: [],
          detail: `no capture records an outline; ${FOCUS_RING_OFFSET}px of daylight separates the ring from the control it belongs to`,
        }),
      ),
    },
  }

  return { states, recipes }
}

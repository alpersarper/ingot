/**
 * `DESIGN.md` generator, targeting the Google Labs DESIGN.md format.
 *
 * The second export target, and the first one Ingot did not design. The format
 * is an open specification (Apache-2.0, `google-labs-code/design.md`) with an
 * official linter, and enough tools now read it that a distilled kit which
 * cannot be handed to one is a kit that stops at Ingot's own front door. So
 * this file answers a narrower question than `design-kit-md.ts` does: not
 * "everything a consumer needs to build against this kit", but "this kit,
 * stated in the vocabulary a stranger's agent already understands".
 *
 * Like its sibling it is the only layer that knows its target exists. Nothing
 * here reaches back into `tokens/types.ts`, and nothing in the token model
 * mentions the spec.
 *
 * Three consequences of the spec shape the output, and all three are
 * deliberate rather than incidental:
 *
 *   - **The spec's component sub-tokens are a closed list** -- `backgroundColor`,
 *     `textColor`, `typography`, `rounded`, `padding`, `size`, `height`,
 *     `width`. A recipe's border colour has nowhere to go in the front matter,
 *     so it is stated in the Components prose instead of being smuggled into an
 *     unrecognised key the linter would warn on and a reader would ignore.
 *   - **The spec's linter holds every component's `textColor`/`backgroundColor`
 *     pair to WCAG AA**, and Ingot holds the *disabled* pair to a lower floor
 *     on purpose ({@link DISABLED_CONTRAST_FLOOR}), because a disabled control
 *     that reads as ordinary body text is not disabled. WCAG agrees -- 1.4.3
 *     exempts inactive components from the minimum outright -- but the linter
 *     does not model the exemption, so `control-disabled` is the one component
 *     here that lints with a contrast warning. It is emitted anyway, once
 *     rather than per control, because that is the shape of Ingot's own model:
 *     one pair for every disabled control. Demoting it to prose would leave a
 *     consuming agent with no machine-readable disabled colours at all, and the
 *     thing it reaches for next is an opacity ramp -- which cannot be
 *     contrast-checked and measures 1:1 on a light kit. A stated warning beats
 *     a silence that gets filled in wrong.
 *   - **The spec has no group for shadows, focus rings or border colours.**
 *     They are prose in Elevation & Depth, Components and Shapes. A token group
 *     the spec does not define would be dropped by every conforming reader, and
 *     `colors.border` is consequently the one colour token here that no
 *     component can reference -- which the linter reports as an orphan.
 *
 * Determinism is the same contract as everywhere else in the engine: the bytes
 * are a function of the argument alone. Every map is emitted in a fixed order,
 * every number goes through {@link round}, and no sort runs without an explicit
 * comparator.
 */
import { COLOR_ROLE_ORDER } from '../tokens/types'
import { byNumber, byString, chain } from '../util/sort'
import { collapsedShades, collapsedShadesSentence } from '../color/roles'
import { CONTRAST_FLOOR, DISABLED_CONTRAST_FLOOR } from '../color/contrast'
import { errorSignalGuidance } from './error-signal'
import { finish, plural } from './markdown'
import { parseColor } from '../color/space'
import { round } from '../util/num'
import type {
  ColorRoleName,
  ComponentRecipe,
  RadiusStepName,
  ShadowStepName,
  TokensDocument,
  TypeStepName,
} from '../tokens/types'

/**
 * The schema version this generator emits, and the one it was verified against.
 *
 * It travels in the front matter's `version` key. The format is pre-1.0 and the
 * value is the spec's own, not Ingot's: bumping it is a statement that the
 * output was re-checked against a newer spec, so it changes only alongside a
 * run of the official linter at that version.
 */
export const DESIGN_MD_SPEC_VERSION = 'alpha'

/** Ingot's colour roles, in the token names this target gives them. */
const COLOR_TOKEN_NAMES: Readonly<Record<ColorRoleName, string>> = {
  background: 'background',
  surface: 'surface',
  surfaceHover: 'surface-hover',
  selectedSurface: 'surface-selected',
  border: 'border',
  text: 'text',
  textMuted: 'text-muted',
  primary: 'primary',
  primaryHover: 'primary-hover',
  primaryActive: 'primary-active',
  primaryForeground: 'primary-foreground',
  destructive: 'destructive',
  destructiveForeground: 'destructive-foreground',
  disabledSurface: 'disabled-surface',
  disabledForeground: 'disabled-foreground',
}

/**
 * What each role is for, in one clause.
 *
 * Written for the Colors prose rather than lifted from the shadcn table in
 * `design-kit-md.ts`: a reader of this file has not been told the kit targets
 * Tailwind, and "also --popover-foreground" would be a dangling reference to a
 * stack this document never names.
 */
const COLOR_PURPOSES: Readonly<Record<ColorRoleName, string>> = {
  background: 'the page behind everything',
  surface: 'cards, panels, popovers and anything raised off the page',
  surfaceHover: 'an interactive surface under the pointer',
  selectedSurface: 'a selected row, tab or nav item',
  border: 'every separator and control outline',
  text: 'default body and heading text',
  textMuted: 'captions, placeholders and metadata',
  primary: 'the brand fill: primary buttons and active states',
  primaryHover: 'a primary fill under the pointer',
  primaryActive: 'a primary fill being pressed',
  primaryForeground: 'text and icons drawn on a primary fill',
  destructive: 'irreversible actions and error states',
  destructiveForeground: 'text and icons drawn on a destructive fill',
  disabledSurface: 'the fill of a control that cannot be used',
  disabledForeground: 'the label of a control that cannot be used',
}

const RADIUS_ORDER: readonly RadiusStepName[] = ['none', 'sm', 'md', 'lg', 'full']
const SHADOW_ORDER: readonly ShadowStepName[] = ['none', 'sm', 'md', 'lg']
const TYPE_ORDER: readonly TypeStepName[] = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl']

/** `button.primary` -> `button-primary`, the spec's component key shape. */
function componentKey(name: string): string {
  return name.replace(/\./g, '-')
}

/**
 * Restate shared prose in this document's own names.
 *
 * `errorSignalGuidance` is the one owner of everything any Ingot artifact says
 * about drawing an error, and it is written for `design-kit.md`: recipe names
 * in the token model's dotted form (`button.destructive`) and cross-references
 * by section number (`see §2`). This document calls that control
 * `button-destructive` and numbers no sections at all, so the sentence arrives
 * pointing at two things the reader cannot find. Translating on the way out
 * keeps the single owner intact; forking the prose to fix the addressing would
 * not, and a forked copy is how the two documents would start describing two
 * different kits.
 */
const SECTION_NAMES: Readonly<Record<string, string>> = { '2': 'Colors', '7': 'Components' }

function inSpecNames(text: string): string {
  return text
    .replace(/`([a-z]+)\.([a-z]+)`/g, (whole, group: string, member: string) =>
      group === 'button' || group === 'table' ? `\`${group}-${member}\`` : whole,
    )
    .replace(/§(\d+)/g, (whole, number: string) => SECTION_NAMES[number] ?? whole)
}

/** `color.roles.primaryHover` -> `primary-hover`, or `undefined` for no role. */
function colorTokenFor(path: string | null): string | undefined {
  if (path === null) return undefined
  const role = path.startsWith('color.roles.') ? path.slice('color.roles.'.length) : path
  return COLOR_TOKEN_NAMES[role as ColorRoleName]
}

// --- YAML emission ----------------------------------------------------------
//
// Hand-rolled rather than pulled from a library, for the reason every other
// serialiser in the engine is: a dependency's idea of when to quote, how to
// fold a long line and what order to walk a map in is not a contract, and the
// front matter's bytes are part of a deterministic document. The three escapes
// below are the ones that would silently corrupt this particular output: a bare
// `#rrggbb` is a YAML comment, a bare `{colors.primary}` is a flow mapping, and
// an unescaped quote inside a font stack ends the scalar early.

/** A key, bare when it is unambiguous and quoted when it is not. */
function yamlKey(name: string): string {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? name : yamlString(name)
}

/** A double-quoted scalar. The only string form this file emits. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * A scalar that is already safe bare, or quoted when it is not.
 *
 * Dimensions (`12px`) and weights read better unquoted; colours and references
 * must be quoted or they parse as something else entirely.
 */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 .%_-]*$/.test(value) ? value : yamlString(value)
}

/** A token reference, which the spec writes in braces and YAML needs quoted. */
function ref(path: string): string {
  return yamlString(`{${path}}`)
}

/** `12px`, through the engine's one rounding helper like every other number. */
function px(value: number): string {
  return `${round(value, 2)}px`
}

export function renderSpecDesignMarkdown(tokens: TokensDocument): string {
  const { color, spacing, border, radius, shadow, typography, components, source } = tokens
  const out: string[] = []
  const push = (...lines: string[]): void => {
    out.push(...lines)
  }

  const roles = COLOR_ROLE_ORDER.filter((name) => color.roles[name] !== undefined)
  const hexOf = (name: ColorRoleName): string | undefined => color.roles[name]?.value.hex
  // One owner for everything any Ingot artifact says about drawing an error, so
  // this document and `design-kit.md` cannot describe two different kits to the
  // same reader in the same sitting.
  const errorSignal = errorSignalGuidance(tokens)

  const typeSteps = [...typography.steps]
    .map((step) => step.value)
    .sort((a, b) => byNumber(TYPE_ORDER.indexOf(a.name), TYPE_ORDER.indexOf(b.name)))
  const stepByName = new Map(typeSteps.map((step) => [step.name, step]))
  const weightNames = new Map(typography.weights.map((weight) => [weight.value.value, weight.value.name]))

  /**
   * The typography token a recipe's text is set in.
   *
   * A recipe carries its own weight, and roughly half of them differ from the
   * weight of the size step they sit on -- a button is the base step in medium,
   * a badge the small step in semibold. The spec's `typography` sub-token is a
   * reference to a whole composite, so pointing a button at `text-base` would
   * quietly restate it at the scale's weight and ship a kit whose buttons are
   * lighter than the kit says they are. The combinations recipes actually use
   * become tokens of their own instead, named for the step and the weight so a
   * reader can see which is which.
   */
  const controlTypeName = (stepName: TypeStepName, weight: number): string => {
    const step = stepByName.get(stepName)
    if (step !== undefined && step.fontWeight === weight) return `text-${stepName}`
    return `text-${stepName}-${weightNames.get(weight) ?? weight}`
  }

  /** Every control typography token the recipes reference, minus the scale's own. */
  const controlTypes = [
    ...new Map(
      components.recipes
        .map((recipe) => {
          const name = controlTypeName(recipe.typeStep.value, recipe.fontWeight.value)
          return [name, { name, step: recipe.typeStep.value, weight: recipe.fontWeight.value }] as const
        })
        .filter(([name]) => !name.startsWith('text-') || !stepByName.has(name.slice('text-'.length) as TypeStepName)),
    ).values(),
  ].sort(
    chain(
      (a, b) => byNumber(TYPE_ORDER.indexOf(a.step), TYPE_ORDER.indexOf(b.step)),
      (a, b) => byNumber(a.weight, b.weight),
      (a, b) => byString(a.name, b.name),
    ),
  )

  // --- front matter ---------------------------------------------------------
  push('---', `version: ${DESIGN_MD_SPEC_VERSION}`, `name: ${yamlString(source.name)}`)
  if (source.description !== '') push(`description: ${yamlString(source.description)}`)

  push('colors:')
  for (const name of roles) {
    push(`  ${yamlKey(COLOR_TOKEN_NAMES[name])}: ${yamlString(color.roles[name]?.value.hex ?? '')}`)
  }

  push('typography:')
  const family = typography.families.sans.value
  const emitType = (name: string, fontSize: number, lineHeight: number, fontWeight: number, letterSpacing?: number): void => {
    push(
      `  ${yamlKey(name)}:`,
      `    fontFamily: ${yamlString(family)}`,
      `    fontSize: ${px(fontSize)}`,
      `    fontWeight: ${fontWeight}`,
      `    lineHeight: ${round(lineHeight, 3)}`,
    )
    if (letterSpacing !== undefined) push(`    letterSpacing: ${px(letterSpacing)}`)
  }
  for (const step of typeSteps) {
    emitType(`text-${step.name}`, step.fontSize, step.lineHeight, step.fontWeight, step.letterSpacing)
  }
  for (const control of controlTypes) {
    const step = stepByName.get(control.step)
    if (step === undefined) continue
    emitType(control.name, step.fontSize, step.lineHeight, control.weight, step.letterSpacing)
  }

  // `rounded` and `spacing` are both scale groups the spec expects; a kit that
  // distilled neither says so in `omitted` rather than going quiet, which is
  // the same rule Ingot applies to its own documents.
  const radiusSteps = RADIUS_ORDER.filter((name) => radius.steps[name] !== undefined)
  if (radiusSteps.length > 0) {
    push('rounded:')
    for (const name of radiusSteps) push(`  ${name}: ${px(radius.steps[name]?.value ?? 0)}`)
  }

  const spacingSteps = [...spacing.steps].map((step) => step.value).sort((a, b) => byNumber(a.px, b.px))
  if (spacingSteps.length > 0) {
    push('spacing:')
    // Named for the multiplier, which is what the step *is* in this kit, and
    // quoted because a bare `4:` is a YAML integer key and the spec's reference
    // syntax addresses these by string.
    for (const step of spacingSteps) push(`  ${yamlKey(step.name)}: ${px(step.px)}`)
  }

  push('components:')
  for (const recipe of components.recipes) {
    push(`  ${yamlKey(componentKey(recipe.name))}:`)
    const surface = colorTokenFor(recipe.colors.surface)
    if (surface !== undefined) push(`    backgroundColor: ${ref(`colors.${surface}`)}`)
    const foreground = colorTokenFor(recipe.colors.foreground)
    // A foreground with no fill of its own -- a ghost button -- is drawn on
    // whatever it sits on, and the linter is right not to be able to check it.
    if (foreground !== undefined) push(`    textColor: ${ref(`colors.${foreground}`)}`)
    push(`    typography: ${ref(`typography.${controlTypeName(recipe.typeStep.value, recipe.fontWeight.value)}`)}`)
    if (radius.steps[recipe.radius.value] !== undefined) {
      push(`    rounded: ${ref(`rounded.${recipe.radius.value}`)}`)
    }
    // CSS shorthand, collapsed when the two agree: `padding: 16px 16px` is a
    // correct statement that reads as a bug.
    const padY = px(recipe.paddingY.value)
    const padX = px(recipe.paddingX.value)
    push(`    padding: ${yamlScalar(padY === padX ? padY : `${padY} ${padX}`)}`)
    if (recipe.height !== undefined) push(`    height: ${px(recipe.height.value)}`)

    // A state fill is a separate variant key, which is how the spec says a
    // state is expressed. The label stays put: Ingot contrast-checks every
    // foreground against the derived hover and pressed surfaces as well as the
    // base one, so every pair the linter measures here is a pair the engine
    // already enforced.
    const variant = (suffix: string, fill: string): void => {
      push(`  ${yamlKey(`${componentKey(recipe.name)}-${suffix}`)}:`, `    backgroundColor: ${ref(`colors.${fill}`)}`)
      if (foreground !== undefined) push(`    textColor: ${ref(`colors.${foreground}`)}`)
    }
    const hover = colorTokenFor(recipe.colors.hoverSurface)
    if (hover !== undefined) variant('hover', hover)
    // The pressed fill is not a field on a recipe: it is the `primaryActive`
    // shade, which the engine derives from `primary` and guarantees against the
    // same foreground. So a control *filled with* `primary` has one, and a
    // control filled with anything else does not -- which is the same rule
    // `design-kit.md` states in prose, read off the recipe rather than restated.
    if (recipe.colors.surface === 'color.roles.primary' && color.roles.primaryActive !== undefined) {
      variant('active', COLOR_TOKEN_NAMES.primaryActive)
    }
  }

  // Selection is a state of a row rather than a control of its own, so it is a
  // variant of the row recipe -- and the only place `surface-selected` can be
  // referenced at all, the spec having no group for interaction states.
  // Disabled is one pair for every control in Ingot's model rather than a
  // variant of each, so it is one pseudo-component rather than nine. See the
  // file header for why it is emitted at all, given that it lints warm.
  const disabledFill = colorTokenFor(components.states.disabled.surface)
  const disabledLabel = colorTokenFor(components.states.disabled.foreground)
  if (disabledFill !== undefined) {
    push('  control-disabled:', `    backgroundColor: ${ref(`colors.${disabledFill}`)}`)
    if (disabledLabel !== undefined) push(`    textColor: ${ref(`colors.${disabledLabel}`)}`)
  }

  const selectedFill = colorTokenFor(components.states.selected.surface)
  const selectedLabel = colorTokenFor(components.states.selected.foreground)
  if (selectedFill !== undefined) {
    const row = components.recipes.find((recipe) => recipe.name === 'table.row')
    push(
      `  ${yamlKey(row === undefined ? 'row-selected' : `${componentKey(row.name)}-selected`)}:`,
      `    backgroundColor: ${ref(`colors.${selectedFill}`)}`,
    )
    if (selectedLabel !== undefined) push(`    textColor: ${ref(`colors.${selectedLabel}`)}`)
  }

  const omitted: Array<{ section: string; reason: string }> = []
  if (radiusSteps.length === 0) {
    omitted.push({ section: 'rounded', reason: 'no captured component in this set drew a corner radius' })
  }
  if (spacingSteps.length === 0) {
    omitted.push({ section: 'spacing', reason: 'no captured component in this set reported padding or gap' })
  }
  if (omitted.length > 0) {
    push('omitted:')
    for (const entry of omitted) {
      push(`  - section: ${entry.section}`, `    reason: ${yamlString(entry.reason)}`)
    }
  }
  push('---', '')

  // --- prose ----------------------------------------------------------------
  push(
    `# ${source.name}`,
    '',
    '## Overview',
    '',
    `${source.description}`,
    '',
    `Distilled by ${tokens.engine.name} ${tokens.engine.version} from ${plural(source.captureCount, 'captured component')} across ${plural(source.origins.length, 'origin')}. Every value below was measured from those captures or derived from a value that was; where nothing in the evidence implied a value, the token's own record in \`tokens.json\` says so.`,
    '',
    `This is a **${color.mode}** system. Build against the tokens in the front matter and nothing else: when you need a value that is not here, compose it from the scales that are rather than introducing a new one. A kit with one more colour in it is a different kit.`,
    '',
  )

  push(
    '## Colors',
    '',
    `${plural(roles.length, 'role')}, and there are no other colours in this system. Roles rather than a numbered ramp: each name says what the colour is *for*, and two of them with the same hex is a fact about this kit rather than a mistake.`,
    '',
  )
  for (const name of roles) {
    push(`- **\`${COLOR_TOKEN_NAMES[name]}\` (${hexOf(name)}):** ${COLOR_PURPOSES[name]}.`)
  }
  push('')

  const collapsed = collapsedShades((name) => {
    const hex = hexOf(name)
    return hex === undefined ? undefined : parseColor(hex)?.oklch
  })
  if (collapsed.length > 0) {
    push(
      `**These states are not distinguishable on screen:** ${collapsedShadesSentence(collapsed)}. Signal them with the focus ring, a border or a transform — not with the fill.`,
      '',
    )
  }
  push(inSpecNames(errorSignal.colorRule), '')

  push(
    '## Typography',
    '',
    `One family, \`${family}\`, at a base size of ${px(typography.baseSize)} and a scale ratio of ${typography.scaleRatio}.`,
    '',
    `The \`text-*\` tokens are the size scale, each at the weight the captures set that size in. The \`text-*-<weight>\` tokens exist because controls do not always take their scale's weight — a button is the base step set in medium, a table header the small step set in semibold — and a component that referenced the plain step would render lighter than this kit specifies.`,
    '',
  )
  if (typography.weights.length > 0) {
    push(
      `Weights in use: ${typography.weights.map((weight) => `**${weight.value.name}** (${weight.value.value})`).join(', ')}. Do not introduce a weight that is not on this list.`,
      '',
    )
  }

  push(
    '## Layout',
    '',
    `Every length in this system is a multiple of a **${px(spacing.baseUnit)}** base unit. ${spacing.snappingRule}`,
    '',
    `${spacing.layoutRule}`,
    '',
    `Steps at or below ${plural(spacing.largestObservedMultiple, 'multiple')} of the base unit are *component* spacing — padding and gaps the captures actually reported. Anything above it is *layout* spacing, extrapolated to give page-level rhythm somewhere on-scale to live: ${round(spacing.fit * 100, 1)}% of the raw observations were already exact multiples of the base unit, which is the evidence that the scale fits.`,
    '',
  )

  const shadowSteps = SHADOW_ORDER.filter(
    (name) => shadow.steps[name] !== undefined && (shadow.steps[name]?.value.layers.length ?? 0) > 0,
  )
  push('## Elevation & Depth', '')
  if (shadowSteps.length === 0) {
    push(
      `This system conveys hierarchy **without shadows**. Nothing in the captures drew one, so depth is carried by the surface colours and the ${px(border.width.value)} \`border\` instead: a raised element sits on \`surface\` against \`background\`, and a separated one gets a border. Do not add a shadow to signal elevation — this kit has no value for one, and an invented shadow is a value this document does not define.`,
      '',
    )
  } else {
    push(
      'Elevation is drawn with shadows, ordered by how far off the page they read. The spec has no token group for shadows, so these are the canonical values and they are stated here in full:',
      '',
    )
    for (const name of shadowSteps) {
      push(`- **\`${name}\`:** \`box-shadow: ${shadow.steps[name]?.value.css}\``)
    }
    push('', 'Use one of these exactly. Do not interpolate between two steps.', '')
  }

  push(
    '## Shapes',
    '',
    radiusSteps.length === 0
      ? 'Nothing in the captures drew a corner radius, so this system specifies none. Draw square corners rather than picking a radius this document does not define.'
      : `Corners come from the \`rounded\` scale: ${radiusSteps.map((name) => `\`${name}\` at ${px(radius.steps[name]?.value ?? 0)}`).join(', ')}. Every control names one of these steps; none of them carries a radius of its own.`,
    '',
    `Every border in this system is **${px(border.width.value)}** and drawn in \`border\`. Width is not a variable here — a heavier line is not how this kit signals anything.`,
    '',
  )

  push('## Components', '')
  push(
    `${plural(components.recipes.length, 'control')}, each fully specified in the front matter, with its hover and pressed fills as \`*-hover\` and \`*-active\` variant keys beside it.`,
    '',
    `What follows is what the front matter cannot carry. The spec's component sub-tokens are a closed list — \`backgroundColor\`, \`textColor\`, \`typography\`, \`rounded\`, \`padding\`, \`size\`, \`height\`, \`width\` — so **which colour outlines a control has no key of its own**, and is stated below instead. Every border in this kit is \`border\` at ${px(border.width.value)}; the list says which controls draw one.`,
    '',
  )
  for (const recipe of components.recipes) {
    push(`- **\`${componentKey(recipe.name)}\`** — ${recipe.purpose}${borderClause(recipe)}`)
  }
  push('')

  const focus = components.states.focusRing
  push(
    '### States',
    '',
    `- **Focus.** A ${px(focus.width.value)} ring in \`${colorTokenFor(focus.colorRole) ?? 'primary'}\`, offset ${px(focus.offset.value)} from the control. Every interactive element gets it, and it is the one state signal that never depends on a fill.`,
    `- **Hover and pressed.** The \`*-hover\` component variants in the front matter. A control with no hover variant has no hover fill in this kit; use the ring.`,
    `- **Selected.** A selected row, tab or nav item is filled with \`${colorTokenFor(components.states.selected.surface) ?? 'surface-selected'}\` and keeps \`${colorTokenFor(components.states.selected.foreground) ?? 'text'}\` on top. Selection reads by hue and hover reads by lightness; do not swap them.`,
  )
  push(
    `- **Disabled.** The \`control-disabled\` component: fill \`${disabledFill ?? 'disabled-surface'}\`, label \`${disabledLabel ?? 'disabled-foreground'}\`, for every control rather than one of them. The pair measures **${components.states.disabled.ratio}:1**, held to a floor of ${round(components.states.disabled.floor, 1)}:1 rather than the ${round(CONTRAST_FLOOR, 1)}:1 this kit holds every other pair to — a disabled control that reads as ordinary body text is not disabled, and WCAG 1.4.3 exempts inactive components from the minimum for that reason. A conformance checker that does not model the exemption will flag this one pair; that is the intended reading and not a defect to fix. Never build the state out of \`opacity\` instead: an opacity ramp cannot be contrast-checked, and it measures 1:1 on a light kit.`,
    `- **Error.** ${inSpecNames(errorSignal.stateCell)}`,
  )
  for (const line of errorSignal.language) push(`  - ${inSpecNames(line)}`)
  push('')

  push(
    "## Do's and Don'ts",
    '',
    '- Do take every colour from the `colors` map. There are no other colours in this system.',
    `- Do compose a value the tokens do not name — a card's inner gap, a field label's size — from the scales above. Don't introduce a new token for it.`,
    `- Do keep every length a multiple of the ${px(spacing.baseUnit)} base unit.`,
    '- Do reference a component\'s `typography` token rather than restating its size and weight. The two drift.',
    `- Don't use \`primary\` as a text colour. It is a fill, and \`primary-foreground\` is what goes on top of it.`,
    `- Don't signal a disabled state with \`opacity\`. Use the two disabled colours above.`,
    `- ${inSpecNames(errorSignal.componentRule)}`,
    `- Don't add a weight, a radius or a shadow step that is not listed above. The absence of one is a decision this kit made.`,
    '',
  )

  return finish(out)

  /** The one thing a recipe carries that the spec's component keys cannot. */
  function borderClause(recipe: ComponentRecipe): string {
    const outline = colorTokenFor(recipe.colors.border)
    if (outline === undefined) return ' Draws no border.'
    return ` Outlined in \`${outline}\` at ${px(border.width.value)}.`
  }
}

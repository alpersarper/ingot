/**
 * Tokens to CSS custom properties.
 *
 * This is the seam the whole renderer hangs on: the canonical components have
 * no colours, sizes or radii of their own, only `var(--kit-*)` references, and
 * this file is the only thing that decides what those resolve to. Swapping the
 * kit is therefore swapping one style object -- which is what makes an override,
 * a theme swap and the static docs export all the same move.
 *
 * Names are flat and stack-agnostic (`--kit-color-primary`, not `--primary`),
 * so they cannot collide with the panel's own shadcn variables sitting in the
 * same document.
 *
 * ## Composed variables
 *
 * Some things a real screen needs have no token of their own: a card's radius,
 * the gap between sections, the size a field label is set at. The engine is
 * right not to invent them -- no capture measures "the gap between sections".
 * They are *composed* here, from steps the kit actually carries, which is
 * exactly what `design.md` tells a consumer to do when a value it needs is not
 * in the document. Composing them in one place has two consequences worth
 * having: `canonical.css` never needs a fallback literal, so the rule that
 * every visual value comes from a token holds without exception; and
 * {@link kitComposition} states each choice as data, so which step a
 * composition landed on is readable rather than buried in a selector.
 */
import { hoverSurfaceOf } from '@ingot/engine'
import type { RadiusStepName, TokensDocument, TypeStepName } from '@ingot/engine'

/** Every variable name this module can emit, so a consumer can be exhaustive. */
export type KitCssVariables = Record<string, string>

const ROLE_VARIABLE: Record<string, string> = {
  background: '--kit-color-background',
  surface: '--kit-color-surface',
  surfaceHover: '--kit-color-surface-hover',
  selectedSurface: '--kit-color-selected-surface',
  border: '--kit-color-border',
  text: '--kit-color-text',
  textMuted: '--kit-color-text-muted',
  primary: '--kit-color-primary',
  primaryHover: '--kit-color-primary-hover',
  primaryActive: '--kit-color-primary-active',
  primaryForeground: '--kit-color-primary-foreground',
  destructive: '--kit-color-destructive',
  destructiveForeground: '--kit-color-destructive-foreground',
  disabledSurface: '--kit-color-disabled-surface',
  disabledForeground: '--kit-color-disabled-foreground',
}

const RADIUS_ORDER: RadiusStepName[] = ['none', 'sm', 'md', 'lg', 'full']

/**
 * Resolve an engine token path to a CSS reference.
 *
 * Component recipes name their colours as paths (`"color.roles.primary"`)
 * rather than values, precisely so a consumer can bind them late. `transparent`
 * is the honest answer for a recipe whose surface or border is `null` -- a ghost
 * button really is transparent until it is hovered.
 */
export function cssForTokenPath(path: string | null): string {
  if (path === null) return 'transparent'
  const role = path.startsWith('color.roles.') ? path.slice('color.roles.'.length) : null
  const variable = role === null ? undefined : ROLE_VARIABLE[role]
  return variable === undefined ? 'transparent' : `var(${variable})`
}

/**
 * Which concrete step each composed variable resolved to.
 *
 * Kept as data rather than inlined into the variable builder so a reader -- or
 * a future docs panel -- can see that "card radius" is the kit's own `lg` and
 * not a number the panel made up.
 */
export interface KitComposition {
  radius: { card: RadiusStepName; control: RadiusStepName; pill: RadiusStepName }
  space: { tight: string; snug: string; comfy: string; section: string; page: string }
  type: { caption: TypeStepName; label: TypeStepName; body: TypeStepName; title: TypeStepName; display: TypeStepName }
}

/** The composition decisions, as data, so the CSS and the docs agree. */
export function kitComposition(tokens: TokensDocument): KitComposition {
  const radiusPresent = RADIUS_ORDER.filter((name) => tokens.radius.steps[name] !== undefined)
  const firstOf = (...preferred: RadiusStepName[]): RadiusStepName =>
    preferred.find((name) => radiusPresent.includes(name)) ?? (radiusPresent[0] ?? 'none')

  const steps = [...tokens.spacing.steps].sort((a, b) => a.value.px - b.value.px)
  const positive = steps.filter((step) => step.value.px > 0)
  const component = positive.filter((step) => step.value.band === 'component')
  const layout = positive.filter((step) => step.value.band === 'layout')
  const nameAt = (list: typeof steps, index: number): string =>
    list[Math.min(Math.max(index, 0), list.length - 1)]?.value.name ?? (positive[0]?.value.name ?? '0')

  const typeSteps = tokens.typography.steps.map((step) => step.value.name)
  const baseIndex = Math.max(typeSteps.indexOf('base'), 0)
  const stepAt = (index: number): TypeStepName =>
    typeSteps[Math.min(Math.max(index, 0), typeSteps.length - 1)] ?? 'base'

  return {
    radius: {
      // A card is the outer box, so it takes the largest radius the kit has;
      // controls nest inside it and take the middle; a pill is `full` when the
      // kit knows one, and otherwise stays a control rather than being invented.
      card: firstOf('lg', 'md', 'sm', 'none'),
      control: firstOf('md', 'sm', 'lg', 'none'),
      pill: firstOf('full', 'lg', 'md', 'sm'),
    },
    space: {
      tight: nameAt(positive, 0),
      snug: nameAt(positive, 1),
      // Component-internal padding stops where the evidence stops, which is
      // exactly what the component band means.
      comfy: nameAt(component.length > 0 ? component : positive, (component.length || positive.length) - 1),
      // Page rhythm comes from the layout band, which exists so that it does
      // not have to come from a component step.
      section: layout.length > 0 ? nameAt(layout, 0) : nameAt(positive, positive.length - 1),
      page: layout.length > 0 ? nameAt(layout, layout.length - 1) : nameAt(positive, positive.length - 1),
    },
    type: {
      caption: stepAt(0),
      label: stepAt(baseIndex - 1),
      body: stepAt(baseIndex),
      title: stepAt(baseIndex + 1),
      display: stepAt(typeSteps.length - 1),
    },
  }
}

/**
 * Build the whole variable set for one kit.
 *
 * Missing steps are simply absent from the `--kit-radius-*` / `--kit-shadow-*`
 * families rather than defaulted: the engine has already decided which steps a
 * kit has, and inventing an `lg` radius the kit never claimed would put a value
 * on screen that no `design.md` mentions. The composed variables below resolve
 * to steps that *do* exist, so the stylesheet never needs a fallback.
 */
export function kitCssVariables(tokens: TokensDocument): KitCssVariables {
  const variables: KitCssVariables = {}

  for (const [role, token] of Object.entries(tokens.color.roles)) {
    const variable = ROLE_VARIABLE[role]
    if (variable !== undefined && token !== undefined) variables[variable] = token.value.hex
  }
  // A kit without a captured red has no destructive role, and the components
  // that would use one are not drawn. The variables still have to resolve to
  // something for the stylesheet to parse, and `currentColor` is the honest
  // answer: it draws nothing new.
  if (tokens.color.roles.destructive === undefined) {
    variables['--kit-color-destructive'] = 'currentColor'
    variables['--kit-color-destructive-foreground'] = 'currentColor'
  }

  variables['--kit-space-unit'] = `${tokens.spacing.baseUnit}px`
  for (const step of tokens.spacing.steps) {
    variables[`--kit-space-${step.value.name}`] = `${step.value.px}px`
  }

  variables['--kit-border-width'] = `${tokens.border.width.value}px`

  for (const [name, token] of Object.entries(tokens.radius.steps)) {
    if (token !== undefined) variables[`--kit-radius-${name}`] = `${token.value}px`
  }

  for (const [name, token] of Object.entries(tokens.shadow.steps)) {
    if (token !== undefined) variables[`--kit-shadow-${name}`] = token.value.css
  }

  variables['--kit-font-sans'] = tokens.typography.families.sans.value
  variables['--kit-font-mono'] = tokens.typography.families.mono?.value ?? 'ui-monospace, monospace'
  for (const step of tokens.typography.steps) {
    const { name, fontSize, lineHeight, fontWeight, letterSpacing } = step.value
    variables[`--kit-text-${name}-size`] = `${fontSize}px`
    variables[`--kit-text-${name}-leading`] = String(lineHeight)
    variables[`--kit-text-${name}-weight`] = String(fontWeight)
    variables[`--kit-text-${name}-tracking`] = letterSpacing === undefined ? 'normal' : `${letterSpacing}px`
  }

  const ring = tokens.components.states.focusRing
  variables['--kit-ring-width'] = `${ring.width.value}px`
  variables['--kit-ring-offset'] = `${ring.offset.value}px`
  variables['--kit-ring-color'] = cssForTokenPath(ring.colorRole)

  for (const recipe of tokens.components.recipes) {
    const key = recipe.name.replace(/\./g, '-')
    variables[`--kit-${key}-height`] = `${recipe.height.value}px`
    variables[`--kit-${key}-padding-y`] = `${recipe.paddingY.value}px`
    variables[`--kit-${key}-padding-x`] = `${recipe.paddingX.value}px`
    variables[`--kit-${key}-radius`] = radiusReference(tokens, recipe.radius.value)
    variables[`--kit-${key}-text-size`] = `var(--kit-text-${recipe.typeStep.value}-size)`
    variables[`--kit-${key}-text-leading`] = `var(--kit-text-${recipe.typeStep.value}-leading)`
    variables[`--kit-${key}-weight`] = String(recipe.fontWeight.value)
    variables[`--kit-${key}-surface`] = cssForTokenPath(recipe.colors.surface)
    variables[`--kit-${key}-foreground`] = cssForTokenPath(recipe.colors.foreground)
    variables[`--kit-${key}-border`] = cssForTokenPath(recipe.colors.border)
    // A recipe with no hover fill keeps the one it has -- resolving to
    // `transparent` would make hovering a destructive button erase it. The rule
    // lives in the engine's `hoverSurfaceOf` so the preview, the docs view and
    // the per-component markdown cannot disagree about what hover looks like.
    variables[`--kit-${key}-hover-surface`] = cssForTokenPath(hoverSurfaceOf(recipe).path)
  }

  // A kit with no captured red has no destructive recipe either. The variables
  // resolve to the primary button's so the stylesheet parses; nothing draws a
  // destructive button, because `hasDestructive` gates it out of every surface.
  if (tokens.components.recipes.every((recipe) => recipe.name !== 'button.destructive')) {
    for (const suffix of [
      'height',
      'padding-y',
      'padding-x',
      'radius',
      'text-size',
      'text-leading',
      'weight',
      'surface',
      'foreground',
      'border',
      'hover-surface',
    ]) {
      variables[`--kit-button-destructive-${suffix}`] = `var(--kit-button-primary-${suffix})`
    }
  }

  const composition = kitComposition(tokens)
  variables['--kit-radius-card'] = `var(--kit-radius-${composition.radius.card})`
  variables['--kit-radius-control'] = `var(--kit-radius-${composition.radius.control})`
  variables['--kit-radius-pill'] = `var(--kit-radius-${composition.radius.pill})`
  for (const [role, step] of Object.entries(composition.space)) {
    variables[`--kit-space-${role}`] = `var(--kit-space-${step})`
  }
  for (const [role, step] of Object.entries(composition.type)) {
    variables[`--kit-type-${role}-size`] = `var(--kit-text-${step}-size)`
    variables[`--kit-type-${role}-leading`] = `var(--kit-text-${step}-leading)`
    variables[`--kit-type-${role}-weight`] = `var(--kit-text-${step}-weight)`
    variables[`--kit-type-${role}-tracking`] = `var(--kit-text-${step}-tracking)`
  }
  // Cards take the resting elevation when the kit has one and nothing when it
  // does not -- a kit that separates with borders must not grow a shadow here.
  variables['--kit-shadow-card'] = tokens.shadow.steps.sm === undefined ? 'none' : 'var(--kit-shadow-sm)'

  return variables
}

/** A radius step the kit actually has, falling back down the scale if it does not. */
function radiusReference(tokens: TokensDocument, step: string): string {
  const start = RADIUS_ORDER.indexOf(step as RadiusStepName)
  for (let index = start; index >= 0; index -= 1) {
    const name = RADIUS_ORDER[index]
    if (name !== undefined && tokens.radius.steps[name] !== undefined) {
      return `var(--kit-radius-${name})`
    }
  }
  return '0px'
}

/** Whether a kit carries a destructive brand colour. It never invents one. */
export function hasDestructive(tokens: TokensDocument): boolean {
  return tokens.color.roles.destructive !== undefined
}

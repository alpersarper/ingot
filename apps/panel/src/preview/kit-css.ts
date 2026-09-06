/**
 * Tokens to CSS custom properties.
 *
 * This is the seam the whole preview hangs on: the canonical components have no
 * colours, sizes or radii of their own, only `var(--kit-*)` references, and this
 * file is the only thing that decides what those resolve to. Swapping the kit
 * is therefore swapping one style object -- which is exactly what the panel's
 * eventual theme switching and token overriding need it to be.
 *
 * Names are flat and stack-agnostic (`--kit-color-primary`, not
 * `--primary`), so they cannot collide with the panel's own shadcn variables
 * sitting in the same document.
 */
import type { ColorRoleName, TokensDocument } from '@ingot/engine'

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

/** Round-trip a role name to its variable, for components that name a role directly. */
export function cssForRole(role: ColorRoleName): string {
  return cssForTokenPath(`color.roles.${role}`)
}

/**
 * Build the whole variable set for one kit.
 *
 * Missing steps are simply absent rather than defaulted here: the engine has
 * already decided which steps a kit has, and inventing an `lg` radius the kit
 * never claimed would put a value on screen that no `design.md` mentions. The
 * components fall back through the steps that do exist instead.
 */
export function kitCssVariables(tokens: TokensDocument): KitCssVariables {
  const variables: KitCssVariables = {}

  for (const [role, token] of Object.entries(tokens.color.roles)) {
    const variable = ROLE_VARIABLE[role]
    if (variable !== undefined && token !== undefined) variables[variable] = token.value.hex
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
  if (tokens.typography.families.mono !== undefined) {
    variables['--kit-font-mono'] = tokens.typography.families.mono.value
  }
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
    variables[`--kit-${key}-hover-surface`] = cssForTokenPath(recipe.colors.hoverSurface)
  }

  return variables
}

/** A radius step the kit actually has, falling back down the scale if it does not. */
function radiusReference(tokens: TokensDocument, step: string): string {
  const order = ['none', 'sm', 'md', 'lg', 'full']
  const start = order.indexOf(step)
  for (let index = start; index >= 0; index -= 1) {
    const name = order[index]
    if (name !== undefined && tokens.radius.steps[name as keyof typeof tokens.radius.steps] !== undefined) {
      return `var(--kit-radius-${name})`
    }
  }
  return '0px'
}

/** Whether a kit carries a destructive brand colour. It never invents one. */
export function hasDestructive(tokens: TokensDocument): boolean {
  return tokens.color.roles.destructive !== undefined
}

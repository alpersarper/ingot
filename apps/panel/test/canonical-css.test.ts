/**
 * The rule that keeps the preview honest, enforced by reading the stylesheets.
 *
 * Every visual property of the canonical components comes from a token. A
 * literal colour, length or font size in `canonical.css` or `docs.css` would put
 * a value on screen that the exported `design.md` never mentions -- which is the
 * one thing that makes a preview lie about the kit it is previewing.
 *
 * The check is deliberately mechanical rather than a code-review convention,
 * because the failure it prevents is invisible: a hardcoded `#fff` looks fine
 * in the panel and is simply absent from every export.
 *
 * What stays literal, and why it is not a visual value:
 *
 *   - **Structure**: `display`, `flex-direction`, `grid-template-columns` and
 *     friends. A design kit does not decide that a card is a column.
 *   - **Relative measures**: `ch`, `%`, `fr`, `deg`, `vh`. `68ch` is a reading
 *     measure in the kit's own type; `45deg` is the geometry of a drawn chevron.
 *     None of them is an absolute value the kit could own.
 *   - **Timing**: `120ms ease`. Nothing in a capture describes a transition.
 *   - **Breakpoints**: the preludes of `@container` rules. A breakpoint is a
 *     property of the window, not of the design system.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TokensDocument } from '@ingot/engine'
import { kitCssVariables } from '@/preview/kit-css'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const SHEETS = [
  ['preview/canonical.css', join(SRC, 'preview', 'canonical.css')],
  ['docs/docs.css', join(SRC, 'docs', 'docs.css')],
] as const

/** Absolute lengths a design kit is supposed to own. */
const ABSOLUTE_LENGTH = /(?:^|[\s(,:])-?\d+(?:\.\d+)?(px|rem|em|pt|pc|cm|mm|in)\b/
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(/
/** `transparent`, `currentColor` and `inherit` are absences, not colours. */
const NAMED_COLOUR = /\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal)\b/

interface Declaration {
  property: string
  value: string
  line: number
}

/** Every declaration in a stylesheet, with at-rule preludes and comments gone. */
function declarations(css: string): Declaration[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
  const out: Declaration[] = []
  let line = 1
  for (const chunk of withoutComments.split(/(?<=[;{}])/)) {
    const text = chunk.trim()
    line += (chunk.match(/\n/g) ?? []).length
    // Selectors, at-rule preludes and closing braces carry no declaration.
    if (text === '' || text.endsWith('{') || text === '}') continue
    const match = /^([-a-zA-Z]+)\s*:\s*([^;]*);?$/.exec(text.replace(/}$/, '').trim())
    if (match === null) continue
    out.push({ property: match[1] as string, value: (match[2] as string).trim(), line })
  }
  return out
}

/** What is left of a value once every `var(--kit-*)` reference is removed. */
function literalPart(value: string): string {
  let previous = ''
  let current = value
  // Nested `var()` calls unwrap from the inside out; the loop terminates
  // because each pass strictly shortens the string.
  while (current !== previous) {
    previous = current
    current = current.replace(/var\(\s*--kit-[a-z0-9-]+\s*\)/g, ' ')
  }
  return current
}

describe.each(SHEETS)('%s is token-driven', (name, file) => {
  const css = readFileSync(file, 'utf8')
  const parsed = declarations(css)

  it('has declarations to check', () => {
    expect(parsed.length).toBeGreaterThan(80)
    expect((css.match(/var\(--kit-/g) ?? []).length).toBeGreaterThan(80)
  })

  it('contains no hardcoded colour', () => {
    const offenders = parsed.filter((declaration) => {
      const rest = literalPart(declaration.value)
      return HEX_COLOUR.test(rest) || COLOUR_FUNCTION.test(rest) || NAMED_COLOUR.test(rest)
    })
    expect(offenders.map((entry) => `${name}:${entry.line} ${entry.property}: ${entry.value}`)).toEqual([])
  })

  it('contains no hardcoded absolute length', () => {
    const offenders = parsed.filter((declaration) => ABSOLUTE_LENGTH.test(literalPart(declaration.value)))
    expect(offenders.map((entry) => `${name}:${entry.line} ${entry.property}: ${entry.value}`)).toEqual([])
  })

  it('sets every font size, weight and line height from a token', () => {
    const typographic = parsed.filter((declaration) =>
      ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'font-family'].includes(declaration.property),
    )
    expect(typographic.length).toBeGreaterThan(10)
    for (const declaration of typographic) {
      const rest = literalPart(declaration.value).trim()
      // `inherit` is the one non-token answer a type declaration may give: it
      // takes the value from an ancestor that did read a token.
      expect(rest === '' || rest === 'inherit', `${name}:${declaration.line} ${declaration.property}: ${declaration.value}`).toBe(true)
    }
  })

  it('sets every colour property from a token', () => {
    const coloured = parsed.filter((declaration) =>
      ['color', 'background', 'background-color', 'border-color'].includes(declaration.property),
    )
    expect(coloured.length).toBeGreaterThan(10)
    for (const declaration of coloured) {
      const rest = literalPart(declaration.value).trim()
      expect(
        rest === '' || rest === 'transparent' || rest === 'inherit' || rest === 'currentColor',
        `${name}:${declaration.line} ${declaration.property}: ${declaration.value}`,
      ).toBe(true)
    }
  })
})

/**
 * The same rule, one file earlier.
 *
 * The stylesheets can only be as honest as the variables they read, so a
 * literal moved into `kit-css.ts` would put a value on screen that no
 * `design.md` mentions while both sheets still passed the checks above. This
 * runs the real builder against the committed kits and asks the same question
 * of what it emits: every value is either a reference to another kit variable,
 * a value the kit document actually carries, or a stated absence.
 */
const ROOT = join(SRC, '..', '..', '..')
const EXAMPLES = ['ghost-warm', 'linear-dark', 'messy-mixed', 'stripe-light'] as const

function exampleKit(name: string): TokensDocument {
  return JSON.parse(readFileSync(join(ROOT, 'examples', name, 'tokens.json'), 'utf8')) as TokensDocument
}

/** `transparent`, `currentColor` and `none` draw nothing; they claim nothing either. */
const ABSENCES = new Set(['transparent', 'currentColor', 'inherit', 'none', 'normal'])

/** Every value the kit document itself states, in the notation CSS wants it in. */
function valuesTheKitCarries(tokens: TokensDocument): Set<string> {
  const values = new Set<string>()
  const px = (value: number): void => void values.add(`${value}px`)

  for (const role of Object.values(tokens.color.roles)) if (role !== undefined) values.add(role.value.hex)
  values.add(tokens.typography.families.sans.value)
  const mono = tokens.typography.families.mono
  if (mono !== undefined) values.add(mono.value)

  px(tokens.spacing.baseUnit)
  for (const step of tokens.spacing.steps) px(step.value.px)
  px(tokens.border.width.value)
  for (const step of Object.values(tokens.radius.steps)) if (step !== undefined) px(step.value)
  for (const step of Object.values(tokens.shadow.steps)) if (step !== undefined) values.add(step.value.css)

  for (const step of tokens.typography.steps) {
    px(step.value.fontSize)
    values.add(String(step.value.lineHeight))
    values.add(String(step.value.fontWeight))
    if (step.value.letterSpacing !== undefined) px(step.value.letterSpacing)
  }

  px(tokens.components.states.focusRing.width.value)
  px(tokens.components.states.focusRing.offset.value)
  for (const recipe of tokens.components.recipes) {
    if (recipe.height !== undefined) px(recipe.height.value)
    px(recipe.paddingY.value)
    px(recipe.paddingX.value)
    values.add(String(recipe.fontWeight.value))
  }
  return values
}

describe.each(EXAMPLES)('the kit variables built from examples/%s', (name) => {
  const tokens = exampleKit(name)
  const variables = kitCssVariables(tokens)
  const carried = valuesTheKitCarries(tokens)

  it('emits a whole variable set to check', () => {
    expect(Object.keys(variables).length).toBeGreaterThan(50)
  })

  it('resolves every variable to a token value, another kit variable, or a stated absence', () => {
    const offenders = Object.entries(variables).filter(([, value]) => {
      const rest = literalPart(value).trim()
      if (rest === '') return false
      return !(ABSENCES.has(rest) || carried.has(value.trim()))
    })
    expect(offenders.map(([variable, value]) => `${name} ${variable}: ${value}`)).toEqual([])
  })
})

describe('a kit with no monospace family', () => {
  it('sets code in a stack the kit has rather than one nobody chose', () => {
    // linear-dark's captures showed no monospace face, so the kit has no mono
    // family -- and the docs still set token paths and code spans in
    // `--kit-font-mono`. Naming a stack of the panel's own here would render
    // the exported docs in a typeface `design.md` never mentions.
    const tokens = exampleKit('linear-dark')
    expect(tokens.typography.families.mono).toBeUndefined()
    expect(kitCssVariables(tokens)['--kit-font-mono']).toBe('var(--kit-font-sans)')
  })

  it('still uses the kit\'s own mono stack when it has one', () => {
    const tokens = exampleKit('ghost-warm')
    expect(kitCssVariables(tokens)['--kit-font-mono']).toBe(tokens.typography.families.mono?.value)
  })
})

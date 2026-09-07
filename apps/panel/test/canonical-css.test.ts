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

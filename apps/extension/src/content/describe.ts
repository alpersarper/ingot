/**
 * The only file that touches the page's DOM, and the only place to review what
 * the extension is allowed to look at.
 *
 * It does three things: it turns an element into the flat descriptor the type
 * guess and the boundary check read, it finds the nearest element that has a
 * visual boundary of its own, and it computes the structural path the capture id
 * is hashed from. All of them are shapes, not content. No `innerHTML`, no
 * attribute values beyond `role` and an input's `type`, no stylesheet access, no
 * text -- only how *long* the text is, because a leaf with words in it is
 * typography and a leaf without is a box.
 */
import { paints, paintsOwnSurface } from '../shared/boundary'
import type { ElementDescriptor, PaintedBackground } from '../shared/descriptor'

const BLOCKISH = new Set(['block', 'flex', 'grid', 'table', 'list-item', 'flow-root'])

/** Does this element have a child that occupies a line of its own? */
function hasBlockChildren(element: Element): boolean {
  for (const child of Array.from(element.children)) {
    const display = getComputedStyle(child).display
    if (BLOCKISH.has(display)) return true
  }
  return false
}

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const

/** The widest border the element actually draws, in px. 0 when it draws none. */
function drawnBorderWidth(style: CSSStyleDeclaration): number {
  let widest = 0
  for (const side of BORDER_SIDES) {
    const lineStyle = style.getPropertyValue(`border-${side}-style`).trim()
    if (lineStyle === '' || lineStyle === 'none' || lineStyle === 'hidden') continue
    const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`))
    if (Number.isFinite(width) && width > widest) widest = width
  }
  return widest
}

function paddingOf(style: CSSStyleDeclaration): [number, number, number, number] {
  return BORDER_SIDES.map((side) => {
    const value = Number.parseFloat(style.getPropertyValue(`padding-${side}`))
    return Number.isFinite(value) ? value : 0
  }) as [number, number, number, number]
}

/**
 * The background showing through a transparent element: the nearest ancestor
 * that paints one.
 *
 * This is the measurement a transparent capture used to be missing entirely, and
 * the reason five of seven captures off real sites carried `rgba(0, 0, 0, 0)` as
 * the component's colour.
 *
 * When nothing up the chain paints a background this returns `null` rather than
 * white. The browser's canvas *is* usually white, but "usually" is not a
 * measurement: a UA dark mode, a user stylesheet or a `color-scheme` on the root
 * all change it, and a capture record that asserted white would be the engine
 * distilling a value nobody chose. Not knowing is reported as not knowing.
 */
export function inheritedBackgroundOf(element: Element): PaintedBackground | null {
  let node = element.parentElement
  while (node !== null) {
    const value = getComputedStyle(node).backgroundColor
    if (paints(value)) return { color: value.trim(), inherited: true }
    node = node.parentElement
  }
  return null
}

export function describeElement(element: Element): ElementDescriptor {
  const style = getComputedStyle(element)
  const box = element.getBoundingClientRect()
  const shadow = style.boxShadow.trim()
  return {
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role')?.trim().toLowerCase() ?? null,
    inputType: element instanceof HTMLInputElement ? element.type.toLowerCase() : null,
    hasBlockChildren: hasBlockChildren(element),
    childElementCount: element.childElementCount,
    textLength: (element.textContent ?? '').trim().length,
    width: box.width,
    height: box.height,
    backgroundColor: style.backgroundColor.trim(),
    painted: paints(style.backgroundColor)
      ? { color: style.backgroundColor.trim(), inherited: false }
      : inheritedBackgroundOf(element),
    borderWidth: drawnBorderWidth(style),
    hasShadow: shadow !== '' && shadow !== 'none',
    padding: paddingOf(style),
    viewportWidth: window.innerWidth,
  }
}

/** How far out and in the search for a real boundary is willing to look. */
const SEARCH_DEPTH = 4
/** A cap on the work one hover can cause on a container with hundreds of children. */
const SEARCH_BUDGET = 96

/**
 * The nearest element that paints a visual boundary of its own.
 *
 * Descendants first, then ancestors, because of which mistake this is fixing:
 * the thing a cursor lands on is usually the transparent wrapper *around* a
 * component rather than a fragment inside it, so the component is below. Within
 * a level the largest candidate wins -- that is the outermost real box, not one
 * of the chips inside it.
 *
 * Bounded in both directions. An unbounded descendant walk on a page section is
 * a hover that reads a thousand computed styles, and an unbounded ancestor walk
 * always terminates in `<body>`, which is the wrapper problem again.
 */
export function nearestBoundary(element: Element): Element | null {
  let level = Array.from(element.children)
  let budget = SEARCH_BUDGET
  for (let depth = 0; depth < SEARCH_DEPTH && level.length > 0 && budget > 0; depth += 1) {
    const found: Element[] = []
    const next: Element[] = []
    for (const candidate of level) {
      if (budget-- <= 0) break
      if (hasOwnBoundary(candidate)) found.push(candidate)
      else next.push(...Array.from(candidate.children))
    }
    if (found.length > 0) return largest(found)
    level = next
  }

  let node = element.parentElement
  for (let depth = 0; depth < SEARCH_DEPTH && node !== null; depth += 1) {
    if (node === document.body || node === document.documentElement) break
    if (hasOwnBoundary(node)) return node
    node = node.parentElement
  }
  return null
}

/** A candidate has to paint something *and* be a box worth capturing. */
function hasOwnBoundary(element: Element): boolean {
  const box = element.getBoundingClientRect()
  if (box.width < 8 || box.height < 8) return false
  const style = getComputedStyle(element)
  const shadow = style.boxShadow.trim()
  return paintsOwnSurface({
    painted: paints(style.backgroundColor) ? { color: style.backgroundColor.trim(), inherited: false } : null,
    borderWidth: drawnBorderWidth(style),
    hasShadow: shadow !== '' && shadow !== 'none',
  })
}

function largest(elements: readonly Element[]): Element {
  return elements.reduce((best, candidate) => (area(candidate) > area(best) ? candidate : best))
}

function area(element: Element): number {
  const box = element.getBoundingClientRect()
  return box.width * box.height
}

/**
 * Where the element sits, as a string that is the same on every visit.
 *
 * Tag names and sibling positions only. It is hashed immediately (see
 * `identity.ts`) and the hash is what leaves; this string never does.
 */
export function structuralPath(element: Element): string {
  const steps: string[] = []
  let node: Element | null = element
  while (node !== null && node !== node.ownerDocument?.documentElement) {
    const parent: Element | null = node.parentElement
    if (parent === null) break
    const tag = node.tagName.toLowerCase()
    const sameTag = Array.from(parent.children).filter((child) => child.tagName === node?.tagName)
    steps.push(sameTag.length > 1 ? `${tag}:${sameTag.indexOf(node) + 1}` : tag)
    node = parent
  }
  steps.push('html')
  return steps.reverse().join('/')
}

/** Reads computed styles as the flat `(property) => value` the extractor wants. */
export function styleReaderFor(element: Element): (property: string) => string {
  const style = getComputedStyle(element)
  return (property) => (style[property as keyof CSSStyleDeclaration] as string | undefined) ?? ''
}

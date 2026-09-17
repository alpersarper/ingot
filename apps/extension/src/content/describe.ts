/**
 * The only file that touches the page's DOM, and the only place to review what
 * the extension is allowed to look at.
 *
 * It does two things: it turns an element into the flat descriptor the type
 * guess reads, and it computes the structural path the capture id is hashed
 * from. Both are shapes, not content. No `innerHTML`, no attribute values
 * beyond `role` and an input's `type`, no stylesheet access, no text -- only
 * how *long* the text is, because a leaf with words in it is typography and a
 * leaf without is a box.
 */
import type { ElementDescriptor } from '../shared/component-type'

const BLOCKISH = new Set(['block', 'flex', 'grid', 'table', 'list-item', 'flow-root'])

/** Does this element have a child that occupies a line of its own? */
function hasBlockChildren(element: Element): boolean {
  for (const child of Array.from(element.children)) {
    const display = getComputedStyle(child).display
    if (BLOCKISH.has(display)) return true
  }
  return false
}

/** A background, border or shadow of its own -- i.e. it paints something. */
function paintsSurface(style: CSSStyleDeclaration): boolean {
  const background = style.backgroundColor
  const opaque = background !== '' && background !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(background)
  const bordered = ['Top', 'Right', 'Bottom', 'Left'].some(
    (side) => Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0,
  )
  return opaque || bordered || (style.boxShadow !== '' && style.boxShadow !== 'none')
}

export function describeElement(element: Element): ElementDescriptor {
  const style = getComputedStyle(element)
  const box = element.getBoundingClientRect()
  return {
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role')?.trim().toLowerCase() ?? null,
    inputType: element instanceof HTMLInputElement ? element.type.toLowerCase() : null,
    hasBlockChildren: hasBlockChildren(element),
    childElementCount: element.childElementCount,
    textLength: (element.textContent ?? '').trim().length,
    hasSurface: paintsSurface(style),
    width: box.width,
    height: box.height,
  }
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

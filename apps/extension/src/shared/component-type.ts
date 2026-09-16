/**
 * Guessing which of the four component types an element is.
 *
 * The taxonomy is fixed at four (DECISIONS.md) and the guess is a starting
 * point, not an answer: the confirm popover puts all four in front of the
 * person who picked the element, because they can see what it is and this
 * function cannot. So the rules below are allowed to be wrong; what they are
 * not allowed to be is *surprising*, which is why they read semantics first
 * (tag, role, input type) and appearance only as a tie-break.
 *
 * It works on a flat descriptor rather than an `Element` so the rules are
 * testable without a DOM -- and so the picker stays the only file that touches
 * one.
 */
import type { ComponentType } from '@ingot/engine'

/**
 * The structural facts the guess is allowed to see.
 *
 * Deliberately small. Nothing here is class names or text content: the
 * extension does not read the page's markup, and a rule that keyed off
 * `.btn-primary` would be the first step towards reproduction-grade capture.
 */
export interface ElementDescriptor {
  /** Lowercase tag name. */
  tagName: string
  /** `role` attribute, lowercased, or null. */
  role: string | null
  /** `type` attribute of an `<input>`, lowercased, or null. */
  inputType: string | null
  /** Does the element contain another element that lays out as a block? */
  hasBlockChildren: boolean
  /** Number of element children. */
  childElementCount: number
  /** Length of the element's own trimmed text. Never its content. */
  textLength: number
  /** Does it draw a border, a shadow, or a background of its own? */
  hasSurface: boolean
  width: number
  height: number
}

const BUTTON_TAGS = new Set(['button'])
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image'])
const BUTTON_ROLES = new Set(['button', 'menuitem', 'tab'])

const FIELD_TAGS = new Set(['input', 'textarea', 'select'])
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'li', 'label', 'code', 'pre'])
const INLINE_TEXT_TAGS = new Set(['span', 'a', 'strong', 'em', 'small', 'b', 'i', 'time', 'abbr'])

/** The largest a leaf of text can be and still be read as typography, not a card. */
const TEXT_MAX_HEIGHT = 240

export function guessComponentType(element: ElementDescriptor): ComponentType {
  const { tagName, role, inputType } = element

  if (BUTTON_TAGS.has(tagName)) return 'button'
  if (tagName === 'input' && inputType !== null && BUTTON_INPUT_TYPES.has(inputType)) return 'button'
  if (role !== null && BUTTON_ROLES.has(role)) return 'button'

  if (FIELD_TAGS.has(tagName)) return 'input'
  if (role !== null && FIELD_ROLES.has(role)) return 'input'

  // A link styled as a call to action is the commonest button on the web and
  // has no tag or role that says so. Shape is the only evidence there is: a
  // short, self-contained link that paints its own surface and is control-sized.
  if (tagName === 'a' && element.hasSurface && !element.hasBlockChildren && element.height <= 72) return 'button'

  if (TEXT_TAGS.has(tagName) && !element.hasBlockChildren) return 'typography'

  // A leaf that is only text: no element children, something to read, and not
  // big enough to be a panel that happens to have no children yet.
  if (
    element.childElementCount === 0 &&
    element.textLength > 0 &&
    element.height <= TEXT_MAX_HEIGHT &&
    !element.hasSurface
  ) {
    return 'typography'
  }

  if (INLINE_TEXT_TAGS.has(tagName) && !element.hasBlockChildren && !element.hasSurface) return 'typography'

  return 'card'
}

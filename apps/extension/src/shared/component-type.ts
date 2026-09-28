/**
 * Guessing which of the four component types an element is.
 *
 * The taxonomy is fixed at four (DECISIONS.md) and the guess is a *starting
 * point that has to be confirmed*: the confirm popover puts all four in front of
 * the person who picked the element and will not save until one is chosen,
 * because they can see what it is and this function cannot. So the rules below
 * are allowed to be wrong; what they are not allowed to be is *surprising*,
 * which is why they read semantics first (tag, role, input type) and appearance
 * only as a tie-break.
 *
 * It works on an {@link ElementDescriptor} rather than an `Element` so the rules
 * are testable without a DOM -- and so `content/describe.ts` stays the only file
 * that touches one.
 */
import type { ComponentType } from '@ingot/engine'
import { isTextish, paintsOwnSurface } from './boundary'
import type { ElementDescriptor } from './descriptor'

export type { ElementDescriptor } from './descriptor'

const BUTTON_TAGS = new Set(['button', 'summary'])
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image'])
const BUTTON_ROLES = new Set(['button', 'menuitem', 'tab'])

const FIELD_TAGS = new Set(['input', 'textarea', 'select'])
/**
 * Roles that mean "a control the user puts a value into".
 *
 * A switch, a checkbox and a slider are not buttons: pressing a button does
 * something, and setting one of these records something. Of the four types
 * `input` is what that is.
 */
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'checkbox', 'radio', 'switch', 'slider'])

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'li', 'label', 'code', 'pre'])

/** The largest a run of text can be and still be read as typography, not a card. */
const TEXT_MAX_HEIGHT = 240

/** The tallest a link can be and still be a control rather than a linked panel. */
const CONTROL_MAX_HEIGHT = 72

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
  if (
    tagName === 'a' &&
    paintsOwnSurface(element) &&
    !element.hasBlockChildren &&
    element.height <= CONTROL_MAX_HEIGHT
  ) {
    return 'button'
  }

  if (TEXT_TAGS.has(tagName) && !element.hasBlockChildren) return 'typography'

  // Anything that paints nothing of its own and reads as one run of text is
  // type, whatever it is spelled as. A `<span>` of words, and a `<div>` whose
  // whole content is a sentence with a `<strong>` in it, are the same thing on
  // screen -- and neither is a card. It has to paint nothing: a filled box with
  // a word in it is a badge, and a tall one is a panel that happens to be empty.
  if (isTextish(element) && !paintsOwnSurface(element) && element.height <= TEXT_MAX_HEIGHT) return 'typography'

  return 'card'
}

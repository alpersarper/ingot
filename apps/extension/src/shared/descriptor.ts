/**
 * One element, flattened -- the only shape the extension's decisions see.
 *
 * `content/describe.ts` is the single place that reads a DOM, and everything it
 * learns arrives here. Two pure modules consume it: `component-type.ts` guesses
 * which of the four types the element is, and `boundary.ts` decides whether it
 * has a visual boundary a person would call a component at all.
 *
 * What is *not* here is the point of it. No class names, no selectors, no text
 * content, no attributes beyond `role` and an input's `type` -- only how *long*
 * the text is, because a leaf with words in it is typography and a leaf without
 * is a box. A rule that keyed off `.btn-primary` would be the first step
 * towards reproduction-grade capture, which DECISIONS.md rules out.
 */

/** A background as it will be recorded: the value, and whose value it is. */
export interface PaintedBackground {
  /** The computed colour, verbatim. */
  color: string
  /**
   * True when it came from an ancestor because the element itself is
   * transparent. It still travels in the record, marked, rather than being
   * silently presented as the element's own.
   */
  inherited: boolean
}

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
  width: number
  height: number

  /* -- appearance: what a reader can actually see of this box -------------- */

  /** The element's own computed background colour, verbatim. */
  backgroundColor: string
  /**
   * The background actually painted behind it: its own when that paints
   * anything, otherwise the nearest ancestor that does. `null` when nothing up
   * the chain paints one -- see `paintedBackgroundOf` for why that is left as
   * "not measured" rather than assumed to be white.
   */
  painted: PaintedBackground | null
  /** The widest border the element actually draws, in px. 0 when it draws none. */
  borderWidth: number
  hasShadow: boolean
  /** Top, right, bottom and left padding, in px. */
  padding: readonly [number, number, number, number]
  /** The viewport's width, so a full-bleed layout box is recognisable as one. */
  viewportWidth: number
}

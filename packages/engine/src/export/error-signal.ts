/**
 * What a kit tells a consumer about drawing an error.
 *
 * One owner, three readers: `design.md`'s colour rules, `design.md`'s state
 * table, and the per-component docs for the field a form actually invalidates.
 * They have to agree, because they are read by the same LLM in the same sitting
 * and a document that forbids a red in one section and prescribes one in
 * another is worse than a document that says nothing.
 *
 * The three modes are three different documents, not three phrasings of one:
 *
 *   - `color` -- the kit has a destructive colour and the state is ordinary.
 *   - `unresolved` -- it has none and nobody has decided. The prohibition is
 *     stated and the consequence is named, and no substitute is prescribed,
 *     because prescribing one would settle a question the reviewer has not.
 *   - `acknowledged` -- a reviewer read the consequence and chose to ship
 *     without a colour. *Now* the substitute is prescribed, in full, so a
 *     consuming LLM still renders a usable error state instead of a message
 *     that looks exactly like a field label.
 */
import type { ErrorSignalMode, TokensDocument } from '../tokens/types'

/** Everything a surface needs to state one kit's error language. */
export interface ErrorSignalGuidance {
  mode: ErrorSignalMode
  /** The §2 colour rule, as one bullet. */
  colorRule: string
  /** The §7 component rule about the destructive button, as one bullet. */
  componentRule: string
  /** The `error` row of the state table. */
  stateCell: string
  /** The non-colour recipe, as imperative bullets. Empty unless acknowledged. */
  language: string[]
}

/**
 * The heaviest weight the kit will set an emphasised string in.
 *
 * Read off the badge recipe, which is the kit's own emphasis control, so the
 * number an error message is set at is a number the kit already ships rather
 * than one this file picked.
 */
function emphasisWeight(tokens: TokensDocument): number {
  const badge = tokens.components.recipes.find((recipe) => recipe.name === 'badge')
  const body = tokens.components.recipes.find((recipe) => recipe.name === 'input')
  return badge?.fontWeight.value ?? body?.fontWeight.value ?? 600
}

export function errorSignalGuidance(tokens: TokensDocument): ErrorSignalGuidance {
  // A palette that has a red describes itself as having one, whatever a
  // standing acknowledgment says. The acknowledgment answered an absence; when
  // the absence goes, the two disagree -- and that disagreement is *reported*,
  // as `override.conflict` on this path, rather than settled here by a document
  // that would otherwise tell a consumer not to use a colour it also lists.
  const mode: ErrorSignalMode =
    tokens.color.roles.destructive === undefined ? tokens.components.states.error.mode.value : 'color'
  const hex = tokens.color.roles.destructive?.value.hex
  const weight = emphasisWeight(tokens)
  const bodyStep = tokens.typography.steps.find((step) => step.value.name === 'base')?.value.fontSize

  if (mode === 'color') {
    return {
      mode,
      colorRule:
        '`destructive` is reserved for irreversible actions and error states. Never use it for emphasis. It is contrast-checked as a text colour as well as a fill, so error copy may be set in it.',
      componentRule:
        '`button.destructive` has no derived hover fill in this kit. Keep its fill constant on hover and use the focus ring for feedback rather than inventing a darker red.',
      stateCell: `Message and field border in \`destructive\` (${hex ?? 'n/a'}). Keep the message text at the base step; the colour carries the signal.`,
      language: [],
    }
  }

  if (mode === 'acknowledged') {
    return {
      mode,
      colorRule:
        'This system deliberately ships **without** an error colour. A reviewer was shown the consequence — a form built from this kit cannot signal an error in colour — and accepted it. Do not add a red from outside the system; signal errors the way §7 prescribes instead.',
      componentRule:
        'There is no destructive button in this kit, because this kit deliberately has no destructive colour. Use `button.secondary` for a destructive action and make the *label* carry the weight ("Delete account"), never a colour you brought with you.',
      stateCell:
        'This kit has no error colour, on purpose. Draw the state with the three non-colour signals below — all three, not one of them.',
      language: [
        'Prefix the message with `Error: `. The words are the signal, so it has to survive being read aloud and being read by someone who cannot see the hue.',
        `Set the message at weight **${weight}** in \`text\`, never \`textMuted\`${bodyStep === undefined ? '' : ` and never below the ${bodyStep}px base step`}. An error must not be quieter than the label above it.`,
        'Put an icon immediately before the message, at the message\'s own line-box size, drawn in `text`. An icon is the one error signal that is neither colour nor typography, and it is what makes the state readable at a glance.',
        'Leave the field\'s border at `border`. This kit names no error border colour, and varying it would put a colour on screen that this document never defines.',
      ],
    }
  }

  return {
    mode,
    colorRule:
      'This system has no destructive colour, and **how it signals an error is undecided**. The consequence is concrete: a form built from this kit cannot signal an error in colour. Do not reach for an arbitrary red — add one to the system explicitly, or decide deliberately to ship without one.',
    componentRule:
      'There is no destructive button in this kit, because there is no destructive colour (see §2). Do not add one from outside the system.',
    stateCell:
      '**Undecided.** This kit has no error colour and no decision to ship without one, so it cannot tell you how to draw this state. Do not invent a red.',
    language: [],
  }
}

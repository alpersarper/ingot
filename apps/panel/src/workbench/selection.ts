/**
 * Selection arithmetic, kept out of the component that draws it.
 *
 * Everything here is a pure function of what the panel already holds, which is
 * what lets the selection bar's two claims -- how many captures, and of what --
 * be tested without rendering anything.
 */
import { surfaceTone } from '@ingot/engine'
import type { CaptureSummary, GroupSummary } from '@/lib/api'

/**
 * Component types in the order the summary names them.
 *
 * Fixed rather than derived from the data: the same selection must read the
 * same way every time, and "3 cards · 4 buttons" one moment and
 * "4 buttons · 3 cards" the next is a summary nobody trusts. It mirrors the
 * engine's own `COMPONENT_TYPES` order.
 */
const TYPE_ORDER = ['button', 'card', 'input', 'typography'] as const

/**
 * What each type is called in the summary.
 *
 * `typography` is "type" because that is what it is on screen -- a scale, not a
 * component -- and "3 typographies" is not a phrase anybody says.
 */
const TYPE_LABEL: Record<string, { one: string; many: string }> = {
  button: { one: 'button', many: 'buttons' },
  card: { one: 'card', many: 'cards' },
  input: { one: 'input', many: 'inputs' },
  typography: { one: 'type', many: 'type' },
}

/**
 * "4 buttons · 3 cards · 2 inputs · 3 type".
 *
 * The point of the bar is that a kit distilled from nine buttons is a different
 * thing from one distilled from a mix, and the user should be able to see which
 * they have before they spend a generation on it. An unknown component type --
 * one a newer extension sends that this panel does not know the word for -- is
 * named by its own type rather than dropped.
 */
export function typeMix(captures: readonly CaptureSummary[]): string {
  const counts = new Map<string, number>()
  for (const capture of captures) {
    counts.set(capture.componentType, (counts.get(capture.componentType) ?? 0) + 1)
  }

  const known = TYPE_ORDER.filter((type) => counts.has(type))
  const unknown = [...counts.keys()].filter((type) => !(TYPE_ORDER as readonly string[]).includes(type)).sort(compare)

  return [...known, ...unknown]
    .map((type) => {
      const count = counts.get(type) ?? 0
      const label = TYPE_LABEL[type] ?? { one: type, many: `${type}s` }
      return `${count} ${count === 1 ? label.one : label.many}`
    })
    .join(' · ')
}

/** Locale-independent, like every comparator in this product. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The sizing guidance, in one line.
 *
 * It sits next to the generate affordances because that is the moment it is
 * actionable, and it is one line because the workbench is not a tutorial. A kit
 * is a small system: the distillation gets *better* when the evidence is a
 * coherent mix rather than a pile.
 */
export const SIZING_GUIDANCE =
  'Around 8-15 captures with a mix of types distils best -- a kit is a small system, not a catalogue.'

/* --------------------------------------------------------- what will hurt -- */

/**
 * Something true about this set of captures that will make the kit worse, and
 * what to do instead.
 *
 * It is a warning and never a block. The reviewer may know exactly what they are
 * doing -- a deliberately button-only kit is a legitimate thing to want -- and a
 * workbench that refuses to distil what it was pointed at is a workbench that
 * gets worked around. What it must not do is stay quiet: both of these are
 * invisible on screen and expensive to discover, because the symptom is a kit
 * that looks fine and is thin.
 */
export interface SelectionWarning {
  /** Stable key. Also what a test names. */
  id: 'one-type' | 'mixed-tone'
  /** What is true about these captures. */
  text: string
  /** The way out. Concrete, and never "don't". */
  remedy: string
}

/**
 * Below this many captures, a single type is not yet a finding.
 *
 * Two of a kind is what a selection looks like halfway through being made, and a
 * warning that fires there is one the reviewer learns to ignore before it is
 * ever true.
 */
const ONE_TYPE_MIN = 3

export function selectionWarnings(captures: readonly CaptureSummary[]): SelectionWarning[] {
  const warnings: SelectionWarning[] = []

  const types = new Set(captures.map((capture) => capture.componentType))
  const only = [...types][0]
  if (captures.length >= ONE_TYPE_MIN && types.size === 1 && only !== undefined) {
    const label = TYPE_LABEL[only] ?? { one: only, many: `${only}s` }
    warnings.push({
      id: 'one-type',
      text: `All ${captures.length} of these are ${label.many}.`,
      remedy:
        'The engine has no evidence for the other three, so it states sanctioned defaults instead -- an input\'s padding, the type scale, a card\'s surface. Capture a few of each and the kit stops guessing.',
    })
  }

  // Deliberately counted rather than merely detected: "4 light, 2 dark" tells the
  // reviewer which way the split falls, and so which group is the odd one out.
  const light = captures.filter((capture) => surfaceTone(capture.record) === 'light').length
  const dark = captures.filter((capture) => surfaceTone(capture.record) === 'dark').length
  if (light > 0 && dark > 0) {
    warnings.push({
      id: 'mixed-tone',
      text: `These mix light and dark surfaces (${light} light, ${dark} dark).`,
      remedy:
        'One kit is one theme: a single background is chosen and every contrast pair is held against it, so whichever side loses gets re-derived rather than kept. Group them separately and distil one kit each.',
    })
  }

  return warnings
}

/**
 * A slug for a group the user is naming, unique against the ones that exist.
 *
 * The slug becomes `tokens.source.setId`, so it is held to the engine's rule
 * here rather than after a round trip. Disambiguation is done against the group
 * list the panel already holds instead of by retrying the server until it stops
 * saying no: a retry loop hides a real collision, and this way the name the
 * dialog shows is the name that gets created.
 */
export function groupSlug(name: string, existing: readonly GroupSummary[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'group'
  const taken = new Set(existing.map((group) => group.slug))
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}

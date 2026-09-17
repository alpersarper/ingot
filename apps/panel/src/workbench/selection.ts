/**
 * Selection arithmetic, kept out of the component that draws it.
 *
 * Everything here is a pure function of what the panel already holds, which is
 * what lets the selection bar's two claims -- how many captures, and of what --
 * be tested without rendering anything.
 */
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

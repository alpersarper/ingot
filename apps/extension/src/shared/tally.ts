/**
 * How many of each type this browser has captured, and the nudge that follows.
 *
 * A kit is distilled from evidence, and evidence of one kind is not evidence of
 * a system: seven cards tell the engine nothing about a button's height, its
 * padding, or which colour its fill is, so it states sanctioned defaults instead
 * and the resulting kit is thin in a way the reviewer only discovers afterwards.
 * The cheapest moment to fix that is *while capturing*, which is why the tally
 * rides in the confirm popover rather than only in the panel.
 *
 * It counts captures the extension accepted -- delivered or buffered -- and not
 * ones it refused, because a refused capture is not in the library and the line
 * would otherwise claim evidence that is not there.
 *
 * Storage is the same injected key-value interface the buffer uses, so the whole
 * thing is testable in Node.
 */
import type { ComponentType } from '@ingot/engine'
import type { KeyValueStore } from './queue'

export const TALLY_KEY = 'ingot.tally'

/** Captures accepted so far, per type. Every type present, zeros included. */
export type TypeTally = Record<ComponentType, number>

/**
 * What each type is called in the line. Mirrors the panel's own wording.
 *
 * `Record<ComponentType, ...>` is the exhaustiveness check: a fifth type added to
 * the engine's taxonomy fails to compile here until it is given a word. The four
 * are spelled out rather than imported as a value because the confirm popover
 * shows this line, and the popover is in a content script -- importing a runtime
 * value from the engine would pull its colour maths into a bundle injected into
 * other people's pages.
 */
const LABEL: Record<ComponentType, { one: string; many: string }> = {
  button: { one: 'button', many: 'buttons' },
  card: { one: 'card', many: 'cards' },
  input: { one: 'input', many: 'inputs' },
  typography: { one: 'type', many: 'type' },
}

const TYPES = Object.keys(LABEL) as ComponentType[]

export function emptyTally(): TypeTally {
  return { button: 0, card: 0, input: 0, typography: 0 }
}

/**
 * The tally as stored, repaired on the way out.
 *
 * `chrome.storage.local` holds whatever an older version of this extension put
 * there, so every field is checked rather than trusted: a missing or corrupt
 * count reads as zero instead of turning the popover's nudge into `NaN`.
 */
export async function readTally(store: KeyValueStore): Promise<TypeTally> {
  const raw = (await store.get([TALLY_KEY]))[TALLY_KEY]
  const tally = emptyTally()
  if (typeof raw !== 'object' || raw === null) return tally
  const candidate = raw as Record<string, unknown>
  for (const type of TYPES) {
    const value = candidate[type]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) tally[type] = Math.floor(value)
  }
  return tally
}

/** Count one accepted capture. Returns the tally as it now stands. */
export async function bumpTally(store: KeyValueStore, type: ComponentType): Promise<TypeTally> {
  const tally = await readTally(store)
  tally[type] += 1
  await store.set({ [TALLY_KEY]: tally })
  return tally
}

/**
 * "5 cards · 0 buttons · 0 inputs · 0 type -- grab some buttons and inputs next."
 *
 * Every type is named including the zeros, because the zeros are the whole
 * point: a line that listed only what had been captured would read as a tidy
 * summary of good progress. The advice is appended only when something is
 * actually missing, and it names what to go and get.
 */
export function tallyLine(tally: TypeTally): string {
  const counts = TYPES.map((type) => {
    const count = tally[type]
    return `${count} ${count === 1 ? LABEL[type].one : LABEL[type].many}`
  }).join(' · ')

  const missing = TYPES.filter((type) => tally[type] === 0)
  if (missing.length === 0 || missing.length === TYPES.length) return counts

  const wanted = missing.map((type) => LABEL[type].many)
  const list = wanted.length === 1 ? wanted[0] : `${wanted.slice(0, -1).join(', ')} and ${wanted[wanted.length - 1]}`
  return `${counts} -- grab some ${list} next.`
}

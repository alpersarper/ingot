/**
 * The running type mix, and the nudge it produces.
 *
 * The case it is built for is the one that happened: seven captures, every one
 * of them a card, and nothing anywhere said so until a kit had been generated
 * from them. The line has to name the zeros, because the zeros are the finding.
 */
import { describe, expect, it } from 'vitest'
import { TALLY_KEY, bumpTally, emptyTally, readTally, tallyLine } from '../src/shared/tally'
import type { KeyValueStore } from '../src/shared/queue'

function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial }
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])),
    set: async (items) => {
      Object.assign(data, items)
    },
  }
}

describe('readTally', () => {
  it('starts every type at zero', async () => {
    expect(await readTally(memoryStore())).toEqual({ button: 0, card: 0, input: 0, typography: 0 })
  })

  it('repairs whatever an older version left in storage', async () => {
    // `chrome.storage.local` survives updates, so the stored shape is untrusted
    // input. A corrupt count has to read as zero rather than as NaN in a line a
    // person is shown.
    const store = memoryStore({ [TALLY_KEY]: { card: 3, button: 'lots', input: -2, typography: 1.7, ghost: 9 } })
    expect(await readTally(store)).toEqual({ button: 0, card: 3, input: 0, typography: 1 })
  })
})

describe('bumpTally', () => {
  it('counts one capture and persists it', async () => {
    const store = memoryStore()
    expect(await bumpTally(store, 'card')).toEqual({ button: 0, card: 1, input: 0, typography: 0 })
    await bumpTally(store, 'card')
    await bumpTally(store, 'button')
    expect(await readTally(store)).toEqual({ button: 1, card: 2, input: 0, typography: 0 })
  })
})

describe('tallyLine', () => {
  it('names the zeros and says what to go and get', async () => {
    const store = memoryStore()
    for (let index = 0; index < 5; index += 1) await bumpTally(store, 'card')
    expect(tallyLine(await readTally(store))).toBe(
      '0 buttons · 5 cards · 0 inputs · 0 type -- grab some buttons, inputs and type next.',
    )
  })

  it('asks for one missing type in the singular', () => {
    expect(tallyLine({ button: 4, card: 3, input: 2, typography: 0 })).toBe(
      '4 buttons · 3 cards · 2 inputs · 0 type -- grab some type next.',
    )
  })

  it('says nothing more once every type is represented', () => {
    expect(tallyLine({ button: 1, card: 1, input: 1, typography: 1 })).toBe(
      '1 button · 1 card · 1 input · 1 type',
    )
  })

  it('gives no advice before the first capture', () => {
    // Everything is missing, so "grab some buttons, cards, inputs and type" is
    // just the four types again. The first capture is not the moment to lecture.
    expect(tallyLine(emptyTally())).toBe('0 buttons · 0 cards · 0 inputs · 0 type')
  })
})

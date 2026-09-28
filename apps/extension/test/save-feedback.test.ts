/**
 * What the person who pressed Save is told.
 *
 * Every other test in this suite asserts on state: the queue holds three, the
 * panel received two, the rejected list names the reason. That is exactly the
 * blind spot this file exists to close. The extension once passed a full
 * end-to-end acceptance run -- thirty-two checks in a real Chrome against a
 * real server -- while answering a capture the panel had just refused with a
 * green "Captured" and an empty badge, because every check read the queue
 * directly and none of them read the page. The queue was right. The sentence
 * was a lie, and the lie is what the user had to act on.
 *
 * So these run the *real* modules -- `createQueue`, `createTransport`,
 * `saveCapture`, `saveMessage` -- against a panel that refuses, one that is
 * down and one that answers 422, and assert on the message and the badge.
 *
 * The governing rule, and it has no exceptions:
 *
 *   **A capture that is not in the panel is never reported in the success
 *   tone, and the reason is always in the text.**
 */
import { describe, expect, it } from 'vitest'
import { validateCaptureRecord } from '@ingot/engine'
import type { CaptureRecord } from '@ingot/engine'
import { createQueue } from '../src/shared/queue'
import type { KeyValueStore, QueueCounts } from '../src/shared/queue'
import { saveCapture } from '../src/shared/save'
import { saveMessage } from '../src/shared/outcome'
import type { SaveResult } from '../src/shared/outcome'
import type { SendOutcome, Transport } from '../src/shared/transport'

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>()
  return {
    async get(keys) {
      const out: Record<string, unknown> = {}
      for (const key of keys) if (data.has(key)) out[key] = data.get(key)
      return out
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value))
    },
  }
}

/** A minimal record the engine's own validator accepts. */
function record(id: string): CaptureRecord {
  return validateCaptureRecord({
    schemaVersion: 1,
    id,
    componentType: 'button',
    sourceUrl: 'https://example.com/pricing',
    capturedAt: '2026-02-11T09:14:22.000Z',
    screenshot: null,
    styles: { backgroundColor: 'rgb(99, 91, 255)', color: 'rgb(255, 255, 255)' },
  })
}

/** A panel with one scripted answer, so each case is one outcome exactly. */
function panelThat(outcome: SendOutcome): Transport {
  return {
    async send() {
      return outcome
    },
    async check() {
      return outcome.kind === 'sent' ? { ok: true } : { ok: false, message: outcome.message }
    },
  }
}

/** Press Save once against a panel that answers this way, and read the screen. */
async function save(outcome: SendOutcome): Promise<{ result: SaveResult; badge: QueueCounts }> {
  const store = memoryStore()
  let badge: QueueCounts = { pending: 0, rejected: 0 }
  const queue = createQueue({
    store,
    transport: async () => panelThat(outcome),
    onCount: (counts) => {
      badge = counts
    },
    now: () => '2026-02-11T09:20:00.000Z',
  })
  const result = await saveCapture(
    { queue, drain: () => queue.drain() },
    () => record('example-com-1a2b3c'),
    null,
    '2026-02-11T09:14:22.000Z',
  )
  return { result, badge }
}

describe('what the capture popover says', () => {
  it('says Captured, plainly, only when the panel actually took it', async () => {
    const { result, badge } = await save({ kind: 'sent' })

    expect(saveMessage(result)).toEqual({ text: 'Captured', tone: 'ok' })
    expect(badge).toEqual({ pending: 0, rejected: 0 })
  })

  /*
   * The regression this whole file was written for. Reproduced against a real
   * panel first: the capture was parked, the queue emptied, the badge cleared,
   * and the page said "Captured" in green. The one case where data had been
   * dropped was the one case with no signal of any kind.
   */
  it('never reports a capture the panel refused outright as a success', async () => {
    const { result, badge } = await save({
      kind: 'rejected',
      message: '422 -- the capture does not satisfy the capture schema: styles.color: not a colour',
    })

    const shown = saveMessage(result)
    expect(shown.tone).toBe('error')
    expect(shown.text).not.toBe('Captured')
    // The panel's own words, and where the capture went.
    expect(shown.text).toContain('422')
    expect(shown.text).toContain("this extension's options")
    // And the badge says so too, for after the toast is gone.
    expect(badge).toEqual({ pending: 0, rejected: 1 })
  })

  it('names the wrong token rather than counting the captures it stopped', async () => {
    const { result, badge } = await save({
      kind: 'refused',
      message: '401 -- this panel is not paired with you; send the pairing token in the x-ingot-token header',
    })

    const shown = saveMessage(result)
    expect(shown.tone).toBe('error')
    expect(shown.text).toContain('401')
    expect(shown.text).toContain('pairing token')
    // Held, not lost -- and it says both.
    expect(shown.text).toContain('held')
    expect(badge).toEqual({ pending: 1, rejected: 0 })
  })

  it('says the panel is down, and how to send once it is back', async () => {
    const { result, badge } = await save({ kind: 'unreachable', message: 'Failed to fetch' })

    const shown = saveMessage(result)
    expect(shown.tone).toBe('error')
    expect(shown.text).toContain('Failed to fetch')
    expect(shown.text).toContain('Sync now')
    expect(badge).toEqual({ pending: 1, rejected: 0 })
  })

  it('reports a capture the schema refuses without pretending it was buffered', async () => {
    const store = memoryStore()
    const queue = createQueue({
      store,
      transport: async () => panelThat({ kind: 'sent' }),
      now: () => '2026-02-11T09:20:00.000Z',
    })
    const result = await saveCapture(
      { queue, drain: () => queue.drain() },
      () => validateCaptureRecord({ schemaVersion: 1, id: 'broken' }),
      null,
      '2026-02-11T09:14:22.000Z',
    )

    expect(result.ok).toBe(false)
    expect(saveMessage(result).tone).toBe('error')
    expect(saveMessage(result).text).toContain('invalid capture')
    expect((await queue.counts()).pending).toBe(0)
  })

  it('never answers in the success tone while a failure is attached', () => {
    // The rule itself, over every shape that can reach the page, so a future
    // branch in `saveMessage` cannot quietly re-open the hole.
    for (const kind of ['unreachable', 'refused', 'rejected'] as const) {
      for (const pending of [0, 1, 7]) {
        for (const ok of [true, false]) {
          const shown = saveMessage({ ok, pending, rejected: 1, failure: { kind, message: 'whatever the panel said' } })
          expect(shown.tone, `${kind}/${pending}/${String(ok)}`).toBe('error')
        }
      }
    }
  })
})

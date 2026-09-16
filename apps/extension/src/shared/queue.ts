/**
 * The buffer: what makes a capture survive a panel that is not running.
 *
 * Every capture goes through here, online or not. That is the design decision
 * worth stating, because the obvious alternative -- try the network first and
 * fall back to the queue -- gives you two code paths, one of which is only
 * exercised when something is already broken, and it loses the ordering
 * guarantee the moment a send is slow rather than failed.
 *
 * So: enqueue, then drain. The drain is strictly FIFO and stops at the first
 * capture it could not send, which is what keeps "in order" true rather than
 * approximately true. The one exception is a capture the panel will never
 * accept; that is moved aside (see `transport.ts`) so one bad record cannot
 * hold every later one hostage.
 *
 * Storage is injected rather than imported so the whole lifecycle is testable
 * without a browser -- and because `chrome.storage.local` is the only store
 * here that survives a browser restart, which is the other half of the promise.
 */
import type { CaptureRecord } from '@ingot/engine'
import type { QueuedCapture, QueueStatus, RejectedCapture, ScreenshotBlob } from './protocol'
import type { Transport } from './transport'

export const PENDING_KEY = 'ingot.queue.pending'
export const REJECTED_KEY = 'ingot.queue.rejected'
export const STATE_KEY = 'ingot.queue.state'

/**
 * What the buffer will hold, in captures and in bytes.
 *
 * Both, because neither alone is honest. `chrome.storage.local` gives an
 * extension 10MB without the `unlimitedStorage` permission, and a screenshot of
 * a card can be a few hundred kilobytes -- so a hundred button captures fit
 * easily and a hundred card captures do not. Checking before the write is what
 * turns the failure into "the buffer is full, start the panel", a sentence a
 * person can act on, rather than a quota error thrown inside a drain nobody is
 * watching.
 */
export const MAX_PENDING = 100
export const MAX_PENDING_BYTES = 8_000_000

/** The subset of `chrome.storage.local` this module needs. */
export interface KeyValueStore {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

/** Surfaces the pending count. In the extension this is the toolbar badge. */
export type CountSink = (pending: number) => void | Promise<void>

interface QueueState {
  lastError: string | null
  lastAttemptAt: string | null
}

export interface Queue {
  enqueue(record: CaptureRecord, screenshot: ScreenshotBlob | null, queuedAt: string): Promise<number>
  /** Send what is waiting, oldest first. Returns how many got through. */
  drain(): Promise<{ sent: number; pending: number; error: string | null }>
  status(): Promise<QueueStatus>
  clearRejected(): Promise<void>
  pendingCount(): Promise<number>
}

export class QueueFullError extends Error {
  constructor(reason: string) {
    super(`the capture buffer is full (${reason}) -- start the panel, or sync from the options page`)
    this.name = 'QueueFullError'
  }
}

export interface QueueOptions {
  store: KeyValueStore
  /** Built per drain, so a settings change takes effect without a reload. */
  transport: () => Promise<Transport>
  onCount?: CountSink
  /** Injected so the queue has no clock of its own to disagree with. */
  now: () => string
}

export function createQueue(options: QueueOptions): Queue {
  const { store, onCount, now } = options

  /**
   * Every read-modify-write of a storage key runs on this one chain. The
   * service worker is single-threaded, so the hazard is interleaving, not
   * parallelism: an enqueue that lands while a send is awaited must not race
   * the drain's own write, or one of the two writes acts on a snapshot the
   * other has already made stale.
   */
  let chain: Promise<unknown> = Promise.resolve()

  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function readPending(): Promise<QueuedCapture[]> {
    const raw = (await store.get([PENDING_KEY]))[PENDING_KEY]
    return Array.isArray(raw) ? (raw as QueuedCapture[]) : []
  }

  async function readRejected(): Promise<RejectedCapture[]> {
    const raw = (await store.get([REJECTED_KEY]))[REJECTED_KEY]
    return Array.isArray(raw) ? (raw as RejectedCapture[]) : []
  }

  async function readState(): Promise<QueueState> {
    const raw = (await store.get([STATE_KEY]))[STATE_KEY]
    if (typeof raw === 'object' && raw !== null) return raw as QueueState
    return { lastError: null, lastAttemptAt: null }
  }

  async function writePending(pending: QueuedCapture[]): Promise<void> {
    await store.set({ [PENDING_KEY]: pending })
    await onCount?.(pending.length)
  }

  /**
   * Remove one sent (or parked) entry from what storage holds *now* -- never
   * from a list read before the send was awaited. Matching `queuedAt` as well
   * as the id means a re-capture that replaced the entry mid-send stays in the
   * buffer and travels on the next pass, instead of being deleted unsent.
   */
  async function removePending(entry: QueuedCapture): Promise<void> {
    const pending = await readPending()
    await writePending(
      pending.filter((item) => !(item.record.id === entry.record.id && item.queuedAt === entry.queuedAt)),
    )
  }

  /**
   * Only one drain at a time.
   *
   * A drain is read-modify-write over a single storage key, and the service
   * worker can be woken by an alarm, a toolbar click and the options page at
   * once. Two overlapping drains would each read the same queue and the second
   * write would resurrect what the first had already sent.
   */
  let inFlight: Promise<{ sent: number; pending: number; error: string | null }> | null = null

  async function runDrain(): Promise<{ sent: number; pending: number; error: string | null }> {
    const transport = await options.transport()
    let sent = 0
    let error: string | null = null

    for (;;) {
      const head = (await serialized(readPending))[0]
      if (head === undefined) break
      const outcome = await transport.send(head.record, head.screenshot)

      if (outcome.kind === 'sent') {
        sent += 1
        await serialized(() => removePending(head))
        continue
      }

      if (outcome.kind === 'rejected') {
        error = `${head.record.id}: ${outcome.message}`
        await serialized(async () => {
          const rejected = await readRejected()
          rejected.push({ record: head.record, reason: outcome.message, rejectedAt: now() })
          await store.set({ [REJECTED_KEY]: rejected })
          await removePending(head)
        })
        continue
      }

      // `unreachable` or `refused`: the capture is fine, the world is not.
      // Leave it at the head and stop, so order survives.
      error = outcome.message
      break
    }

    const pending = await serialized(readPending)
    await store.set({ [STATE_KEY]: { lastError: error, lastAttemptAt: now() } satisfies QueueState })
    return { sent, pending: pending.length, error }
  }

  return {
    async enqueue(record, screenshot, queuedAt) {
      return serialized(async () => {
        const pending = await readPending()
        if (pending.length >= MAX_PENDING) throw new QueueFullError(`${MAX_PENDING} waiting`)
        // Replace rather than append when the same element is captured twice:
        // the id is stable by design, and the panel upserts on it, so two rows in
        // the buffer would mean sending the same capture twice for no reason.
        const existing = pending.findIndex((item) => item.record.id === record.id)
        const entry: QueuedCapture = { record, screenshot, queuedAt }
        if (existing === -1) pending.push(entry)
        else pending[existing] = entry

        const bytes = JSON.stringify(pending).length
        if (bytes > MAX_PENDING_BYTES) {
          throw new QueueFullError(`${Math.round(bytes / 100_000) / 10}MB of screenshots waiting`)
        }

        await writePending(pending)
        return pending.length
      })
    },

    async drain() {
      if (inFlight !== null) return inFlight
      inFlight = runDrain().finally(() => {
        inFlight = null
      })
      return inFlight
    },

    async status() {
      const [pending, rejected, state] = await Promise.all([readPending(), readRejected(), readState()])
      return {
        pending: pending.length,
        rejected,
        lastError: state.lastError,
        lastAttemptAt: state.lastAttemptAt,
      }
    },

    async clearRejected() {
      await serialized(async () => {
        await store.set({ [REJECTED_KEY]: [] })
      })
    },

    async pendingCount() {
      return (await readPending()).length
    },
  }
}

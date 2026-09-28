/**
 * One capture's whole journey, from the Save button to an answer.
 *
 * It lives here rather than in the service worker because of what it has to
 * promise: *whatever happens, the page is told the truth about it*. That is a
 * rule with three failure branches and a success branch, and a rule with
 * branches wants a test. In the service worker it could not have one -- that
 * module touches `chrome.action` and `chrome.storage` at import time, so no
 * Node test can load it, which is precisely how the version that answered
 * `{ ok: true }` to a capture the panel had just refused survived a full
 * end-to-end acceptance run.
 *
 * So the worker keeps the parts that are genuinely Chrome (the badge, the
 * screenshot, the messaging) and the decision lives here, next to
 * `saveMessage`, which turns the result into the sentence a person reads.
 */
import { CaptureValidationError } from '@ingot/engine'
import type { CaptureRecord } from '@ingot/engine'
import { QueueFullError } from './queue'
import type { DrainReport, Queue } from './queue'
import type { ScreenshotBlob } from './protocol'
import type { SaveResult } from './outcome'

export interface SaveDeps {
  queue: Pick<Queue, 'enqueue' | 'counts'>
  /**
   * Send what is waiting. Injected rather than taken from the queue because the
   * worker's drain also reschedules the retry alarm, and a save must go through
   * the same one -- a second drain path is how a capture ends up buffered with
   * nothing ever waking up to send it.
   */
  drain: () => Promise<DrainReport>
}

/**
 * Validate, buffer, deliver -- and report every one of those honestly.
 *
 * `build` is a thunk rather than a record so the engine's validator runs inside
 * the one place that is obliged to turn a failure into an answer. A capture
 * that could never be accepted fails here, in front of the person who picked
 * it, rather than as a 422 inside a drain hours later.
 */
export async function saveCapture(
  deps: SaveDeps,
  build: () => CaptureRecord,
  screenshot: ScreenshotBlob | null,
  queuedAt: string,
): Promise<SaveResult> {
  let record: CaptureRecord
  try {
    record = build()
  } catch (error) {
    return refusal(deps, `invalid capture: ${describe(error)}`)
  }

  try {
    await deps.queue.enqueue(record, screenshot, queuedAt)
  } catch (error) {
    // Anything from here -- the buffer's own cap, or `chrome.storage.local`
    // refusing the write -- has to come back as an answer. A thrown error would
    // leave the confirm popover saying "Saving..." for ever, which is the one
    // outcome worse than losing the capture.
    const message = error instanceof QueueFullError ? error.message : `could not buffer this capture: ${describe(error)}`
    return refusal(deps, message)
  }

  const report = await deps.drain()
  return {
    ok: true,
    pending: report.pending,
    rejected: report.rejected,
    // The line this whole file exists for. The drain knows exactly why the
    // capture is not in the panel, and that reason now travels back to the
    // page instead of being dropped on the way out of the worker.
    ...(report.failure === null ? {} : { failure: report.failure }),
  }
}

/** The capture never entered the buffer. Report the counts as they stand. */
async function refusal(deps: SaveDeps, message: string): Promise<SaveResult> {
  return { ok: false, ...(await deps.queue.counts()), failure: { kind: 'refused', message } }
}

function describe(error: unknown): string {
  if (error instanceof CaptureValidationError) return error.issues.join('; ')
  return error instanceof Error ? error.message : String(error)
}

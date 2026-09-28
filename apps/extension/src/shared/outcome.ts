/**
 * What a capture's fate is called, and what the person who took it is told.
 *
 * This file exists because the sentence shown in the page is a *product*
 * decision and was, until now, an accident of which value happened to be in
 * scope. The service worker drained the queue, learned exactly why a capture
 * had not reached the panel, and then threw that away and answered
 * `{ ok: true }`; the picker, having nothing else, said "Captured". A capture
 * the panel had refused outright was reported as a success, in the success
 * tone, with an empty badge -- which is the one failure mode this product's
 * rules forbid outright (AGENTS.md: it never goes quiet).
 *
 * So the vocabulary and the wording live here, in one pure module with no
 * `chrome` and no `fetch` in it, for three reasons:
 *
 *  - the content script can import it without dragging the transport (and its
 *    `fetch`) into a bundle that is injected into other people's pages;
 *  - `transport.ts` names its outcomes from the same union, so a fourth kind
 *    cannot be added there without the compiler asking what to say about it;
 *  - and {@link saveMessage} is a function of a value, so "a refused capture
 *    never produces a success message" is a test rather than a hope.
 */

/**
 * The three ways a send can fail, and the one way it can succeed.
 *
 * The distinction is not cosmetic -- it decides whether the capture is held,
 * parked or gone, and it decides what the person has to *do*. See the header of
 * `transport.ts` for which status codes land where.
 */
export type SendKind = 'sent' | 'unreachable' | 'refused' | 'rejected'

/** A failure carried far enough to be explained, rather than only counted. */
export interface DrainFailure {
  kind: Exclude<SendKind, 'sent'>
  /** What the panel (or the network) actually said. Never paraphrased away. */
  message: string
}

/**
 * The failure, plus the thing to do about it.
 *
 * Every one of these names a place and an action, because "422 unprocessable"
 * on its own tells a person nothing they can act on. The panel's own words are
 * kept in front, because they are the evidence and ours is only the advice.
 */
export function adviceFor(failure: DrainFailure): string {
  switch (failure.kind) {
    case 'unreachable':
      return `the panel did not answer (${failure.message}) -- start it, then press Sync now in this extension's options`
    case 'refused':
      return `the panel would not accept this (${failure.message}) -- check the panel address and pairing token in this extension's options`
    case 'rejected':
      return `the panel refused this capture (${failure.message}) -- it is set aside under "Refused by the panel" in this extension's options`
  }
}

/** What the service worker answers the page after a save. */
export interface SaveResult {
  /**
   * The capture was taken and is in the buffer.
   *
   * False only when it could not be buffered at all -- a record the schema
   * refuses, or a full buffer. It is deliberately **not** "reached the panel":
   * a capture that is waiting is a capture that is safe.
   */
  ok: boolean
  /** Captures still waiting, so the page can say how many. */
  pending: number
  /** Captures the panel refused outright and will refuse again. */
  rejected: number
  /** Why it is not in the panel: the buffer's own refusal, or the drain's. */
  failure?: DrainFailure
}

/** A line of text and the tone to say it in. */
export interface UserMessage {
  text: string
  tone: 'ok' | 'error'
}

/**
 * The one place a `SaveResult` becomes something a person reads.
 *
 * The rule it encodes, and the rule `test/save-feedback.test.ts` enforces:
 * **a capture that is not in the panel is never reported in the success
 * tone.** "Waiting" is the single exception and it is not an exception to the
 * rule so much as the other half of it -- the buffer's whole promise is that a
 * waiting capture is not a lost one -- so it says so, with the reason, rather
 * than only with a count.
 */
export function saveMessage(result: SaveResult): UserMessage {
  if (!result.ok) {
    return { text: result.failure?.message ?? 'could not save this capture', tone: 'error' }
  }
  if (result.failure !== undefined) {
    const waiting = result.pending > 0 ? `Captured and held (${result.pending} waiting)` : 'Captured'
    return { text: `${waiting} -- ${adviceFor(result.failure)}`, tone: 'error' }
  }
  if (result.pending > 0) {
    // No failure and still pending is the ordinary race: another capture is
    // mid-flight, or the alarm has not run yet. Nothing is wrong, so nothing
    // is claimed to be.
    return { text: `Captured -- ${result.pending} waiting for the panel`, tone: 'ok' }
  }
  return { text: 'Captured', tone: 'ok' }
}

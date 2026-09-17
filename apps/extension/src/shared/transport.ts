/**
 * The one place the extension talks to the network.
 *
 * Two calls, both already on the panel's API: `POST /api/captures` stores the
 * record and `PUT /api/captures/:id/screenshot` puts the image on the volume.
 * Both carry the pairing token in `x-ingot-token`, and both go to the address
 * the user configured -- there is no other destination in this codebase, which
 * is the whole of the privacy posture in one file.
 *
 * The interesting part is the classification. A drain has to tell three
 * situations apart, because they want three different behaviours:
 *
 *   - `unreachable`  the panel is down. Keep the capture, keep the order, try
 *                    later. This is the buffering case and it must never lose
 *                    anything.
 *   - `refused`      a server answered, and said no in a way a person has to
 *                    fix: a wrong token, an origin it will not accept, or a
 *                    mistyped address where some other server happens to
 *                    listen. Also keeps the capture -- fixing the setting makes
 *                    it work -- but stops the drain, because every other item
 *                    will fail the same way.
 *   - `rejected`     the panel answered and will never accept *this* capture:
 *                    a 422 from the capture validator, a 400, and nothing
 *                    else. Parking it is the only honest move; leaving it at
 *                    the head of the queue would wedge every capture behind it
 *                    forever.
 */
import type { CaptureRecord } from '@ingot/engine'
import type { ScreenshotBlob, Settings } from './protocol'

export type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'rejected'; message: string }

export interface Transport {
  /** Send one capture and, when there is one, its screenshot. */
  send(record: CaptureRecord, screenshot: ScreenshotBlob | null): Promise<SendOutcome>
  /** Does the address answer as an Ingot panel, and is the token accepted? */
  check(): Promise<{ ok: true } | { ok: false; message: string }>
}

/** Strip a trailing slash so `${panelUrl}/api/...` never doubles one. */
export function normalisePanelUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** Read the error the server actually sent, rather than guessing from a status. */
async function describe(response: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: unknown; details?: unknown } }
    if (typeof body.error?.message === 'string') detail = body.error.message
    if (Array.isArray(body.error?.details)) detail += `: ${body.error.details.join('; ')}`
  } catch {
    detail = ''
  }
  return detail === '' ? `${response.status} ${response.statusText}` : `${response.status} -- ${detail}`
}

/**
 * Which bucket a status code falls in.
 *
 * `rejected` means 400 and 422 only: the panel read this capture and will
 * never accept it, whatever the reviewer does. Every other answer is
 * *configuration* a person fixes, and the buffering contract is that captures
 * are never lost to one of those. 401 and 403 are a wrong token; 404 and 405
 * are a server that answered but has no such route -- a mistyped panel address
 * with some other local server on it -- and discarding queued screenshots
 * because that server said 404 would be data loss from a recoverable mistake.
 * Both hold the queue, so a corrected setting self-heals: the user who fixes
 * it expects the queue they watched pile up to drain, not to have been thrown
 * away while they looked.
 */
function classify(status: number, message: string): SendOutcome {
  if (status === 400 || status === 422) return { kind: 'rejected', message }
  if (status === 429 || status >= 500) return { kind: 'unreachable', message }
  return { kind: 'refused', message }
}

/** Turn a data URL back into bytes, so the image is uploaded as an image. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const binary = atob(comma === -1 ? dataUrl : dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function createTransport(settings: Settings): Transport {
  const base = normalisePanelUrl(settings.panelUrl)
  const headers = { 'x-ingot-token': settings.token }

  async function call(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  }

  return {
    async send(record, screenshot) {
      let response: Response
      try {
        response = await call('/api/captures', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `{ record }` rather than the bare record: the route accepts both,
          // and the wrapped form leaves room for `groupId` without a second
          // shape. The record itself is sent exactly as it was validated.
          body: JSON.stringify({ record }),
        })
      } catch (error) {
        return { kind: 'unreachable', message: error instanceof Error ? error.message : String(error) }
      }
      if (!response.ok) return classify(response.status, await describe(response))

      if (screenshot === null) return { kind: 'sent' }

      let shot: Response
      try {
        shot = await call(`/api/captures/${encodeURIComponent(record.id)}/screenshot`, {
          method: 'PUT',
          headers: { 'content-type': screenshot.contentType },
          body: dataUrlToBytes(screenshot.dataUrl) as unknown as BodyInit,
        })
      } catch (error) {
        // The record is stored but the image is not. Retrying the whole item is
        // safe: the captures route upserts on the record's own id, so a second
        // attempt updates the row it already wrote rather than adding one.
        return { kind: 'unreachable', message: error instanceof Error ? error.message : String(error) }
      }
      if (!shot.ok) return classify(shot.status, `screenshot: ${await describe(shot)}`)

      return { kind: 'sent' }
    },

    async check() {
      let response: Response
      try {
        response = await fetch(`${base}/api/pairing/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: settings.token }),
        })
      } catch (error) {
        return { ok: false, message: `cannot reach ${base}: ${error instanceof Error ? error.message : String(error)}` }
      }
      if (response.ok) return { ok: true }
      return { ok: false, message: await describe(response) }
    },
  }
}

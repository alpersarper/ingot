/**
 * The network edge, against a fetch the test controls.
 *
 * What is worth pinning here is the classification: which answers park a
 * capture for ever and which hold it for a person to fix. The loss path is a
 * mistyped panel address where some other local server answers 404 -- before
 * the `refused` bucket covered that, the drain parked every queued capture as
 * permanently rejected and dropped the screenshots, so correcting the address
 * afterwards could not bring them back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureRecord } from '@ingot/engine'
import { createQueue } from '../src/shared/queue'
import type { KeyValueStore } from '../src/shared/queue'
import { createTransport } from '../src/shared/transport'
import type { ScreenshotBlob } from '../src/shared/protocol'

function record(id: string): CaptureRecord {
  return {
    schemaVersion: 1,
    id,
    componentType: 'button',
    sourceUrl: 'https://example.com/pricing',
    capturedAt: '2026-02-11T09:14:22.000Z',
    screenshot: null,
    styles: { backgroundColor: 'rgb(99, 91, 255)' },
  }
}

const SHOT: ScreenshotBlob = {
  contentType: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  width: 120,
  height: 40,
}

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>()
  return {
    async get(keys) {
      const out: Record<string, unknown> = {}
      for (const key of keys) if (data.has(key)) out[key] = structuredClone(data.get(key))
      return out
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value))
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('classifying what a server answered', () => {
  const buckets: Array<[number, 'rejected' | 'refused' | 'unreachable']> = [
    [400, 'rejected'],
    [422, 'rejected'],
    [401, 'refused'],
    [403, 'refused'],
    [404, 'refused'],
    [405, 'refused'],
    [429, 'unreachable'],
    [500, 'unreachable'],
    [503, 'unreachable'],
  ]

  for (const [status, kind] of buckets) {
    it(`treats a ${status} as ${kind}`, async () => {
      vi.stubGlobal('fetch', async () => new Response(null, { status }))
      const transport = createTransport({ panelUrl: 'http://localhost:4310', token: 'secret' })
      const outcome = await transport.send(record('a'), null)
      expect(outcome.kind).toBe(kind)
    })
  }
})

describe('a mistyped panel address', () => {
  it('holds the queue on a 404, and drains it with screenshots intact once corrected', async () => {
    // Some other local server on the saved address answers 404. The captures
    // must stay pending -- not parked as rejected, which drops the screenshot
    // and makes the mistake unrecoverable -- so that fixing the address is
    // enough to get everything through.
    const receivedRecords: string[] = []
    const receivedShots: Array<{ id: string; bytes: number }> = []

    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('http://localhost:4310/')) {
        return new Response(null, { status: 404, statusText: 'Not Found' })
      }
      const shot = url.match(/\/api\/captures\/([^/]+)\/screenshot$/)
      if (shot !== null) {
        receivedShots.push({
          id: decodeURIComponent(shot[1] ?? ''),
          bytes: (init?.body as Uint8Array).byteLength,
        })
        return new Response('{}', { status: 200 })
      }
      const body = JSON.parse(String(init?.body)) as { record: CaptureRecord }
      receivedRecords.push(body.record.id)
      return new Response('{}', { status: 201 })
    })

    let address = 'http://localhost:5000'
    const queue = createQueue({
      store: memoryStore(),
      transport: async () => createTransport({ panelUrl: address, token: 'secret' }),
      now: () => '2026-02-11T09:20:00.000Z',
    })

    for (const id of ['a', 'b']) await queue.enqueue(record(id), SHOT, '2026-02-11T09:14:22.000Z')

    const wrong = await queue.drain()
    expect(wrong.sent).toBe(0)
    expect(wrong.pending).toBe(2)
    expect(wrong.error).toContain('404')
    expect((await queue.status()).rejected).toEqual([])
    expect(await queue.pendingCount()).toBe(2)

    address = 'http://localhost:4310'
    const corrected = await queue.drain()

    expect(corrected).toEqual({ sent: 2, pending: 0, error: null })
    expect(receivedRecords).toEqual(['a', 'b'])
    expect(receivedShots.map((shot) => shot.id)).toEqual(['a', 'b'])
    for (const shot of receivedShots) expect(shot.bytes).toBeGreaterThan(0)
  })
})

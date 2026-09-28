/**
 * The request log: enough to diagnose, never enough to leak.
 *
 * Both halves are load-bearing and they pull against each other, which is why
 * they are asserted together.
 *
 * The *enough to diagnose* half exists because of a real failure. A panel had
 * been answering an extension's captures with 401 for days; `docker logs` held
 * eight lines, all of them the startup banner. From outside, "nothing ever
 * reached the server" and "everything that reached it was refused" were
 * indistinguishable -- and they are opposite problems with opposite fixes. So a
 * refused request must produce a line, which means the log sits outside both
 * guards rather than behind them.
 *
 * The *never enough to leak* half is why there was no log to begin with. This
 * process holds the pairing token and up to two API keys, and an access log is
 * the classic place for one of them to end up. The rule is that headers,
 * bodies and query *values* are never read -- so the leak is impossible rather
 * than merely redacted -- and the finished line goes through `redact` anyway.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, TEST_TOKEN, body } from './harness'
import type { Harness } from './harness'
import { loggablePath } from '../src/logging'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.close()
})

describe('the request log', () => {
  it('writes one line per request, with the method, the path and the status', async () => {
    await harness.call('/api/captures')

    expect(harness.requestLogs).toHaveLength(1)
    expect(harness.requestLogs[0]).toMatch(/^\[ingot] GET \/api\/captures 200 \d+ms$/)
  })

  /*
   * The line that would have answered the original question in seconds.
   */
  it('logs a request the pairing guard refused, so a silent 401 is visible', async () => {
    await harness.raw('/api/captures')

    expect(harness.requestLogs[0]).toContain('GET /api/captures 401')
  })

  it('logs a request the CORS lock refused, for the same reason', async () => {
    await harness.raw('/api/captures', { headers: { origin: 'https://somewhere.example' } })

    expect(harness.requestLogs[0]).toContain('GET /api/captures 403')
  })

  it('logs the panel and the extension alike, whatever the verb', async () => {
    await harness.call('/api/captures/import', body({ set: { id: 'x', name: 'x', description: 'x', captures: [] } }))

    expect(harness.requestLogs.at(-1)).toMatch(/POST \/api\/captures\/import \d{3}/)
  })

  it('never carries the pairing token, which rides in a header', async () => {
    await harness.call('/api/captures')
    await harness.raw('/api/pairing/verify', body({ token: TEST_TOKEN }))

    expect(harness.requestLogs).not.toHaveLength(0)
    for (const line of harness.requestLogs) expect(line).not.toContain(TEST_TOKEN)
  })

  it('logs which query parameters were used, never what they were set to', async () => {
    await harness.call('/api/captures?componentType=button&tag=hero%20cta')

    const line = harness.requestLogs[0] ?? ''
    expect(line).toContain('/api/captures?componentType&tag')
    expect(line).not.toContain('button')
    expect(line).not.toContain('hero')
  })

  it('is silent when the deployment asks it to be', async () => {
    const quiet = await createHarness({ env: { INGOT_REQUEST_LOG: '0' } })
    try {
      await quiet.call('/api/captures')
      expect(quiet.requestLogs).toEqual([])
    } finally {
      await quiet.close()
    }
  })
})

describe('a screenshot the volume has lost', () => {
  it('is a 404 that names the file, not a 500 that names this server', async () => {
    await harness.call('/api/captures', {
      method: 'POST',
      body: JSON.stringify({
        record: {
          schemaVersion: 1,
          id: 'gone-one',
          componentType: 'button',
          sourceUrl: 'https://example.com/',
          capturedAt: '2026-02-11T09:14:22.000Z',
          screenshot: null,
          styles: { backgroundColor: 'rgb(99, 91, 255)' },
        },
      }),
    })
    await harness.store.captures.update('gone-one', { screenshotPath: 'gone-one.png' })

    const response = await harness.call('/api/captures/gone-one/screenshot')

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('gone-one.png')
  })
})

describe('loggablePath', () => {
  it('keeps the path and drops every value', () => {
    expect(loggablePath('http://localhost:4310/api/captures?tag=secret-project')).toBe('/api/captures?tag')
  })

  it('names each parameter once, in a stable order', () => {
    expect(loggablePath('http://localhost:4310/api/captures?tag=a&groupId=g&tag=b')).toBe('/api/captures?groupId&tag')
  })

  /*
   * The case this function is really for. Nothing in this API puts a secret in
   * a query string today; the point is that adding one later cannot log it.
   */
  it('cannot leak a secret somebody later puts in a query string', () => {
    expect(loggablePath('http://localhost:4310/api/kits?token=super-secret-value')).toBe('/api/kits?token')
  })

  it('says so rather than throwing when the url will not parse', () => {
    expect(loggablePath('not a url')).toBe('(unparseable url)')
  })
})

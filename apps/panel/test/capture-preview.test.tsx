/**
 * The library shows the picture.
 *
 * Capture in this product is reference-grade by decision -- computed values
 * *and* an image of the component -- and for a while the panel rendered only
 * half of that. The extension took the screenshot, the server stored it on the
 * volume and served it back, and the collection column listed
 * `ghost-btn-primary` in monospace. `apps/panel/src` held no `<img>` at all and
 * nothing read `hasScreenshot`, so a reviewer with twenty captures from three
 * sites was being asked to curate from memory. The person who found this said
 * it in four words: *cannot see captures as previews*.
 *
 * Against the real server, like the rest of the panel suite, because the thing
 * most likely to break here is not the markup -- it is the *fetch*. Every call
 * to this server carries the pairing token in a header, an `<img src>` cannot
 * send a header, and a fake that answered any URL would happily prove a
 * `src` works that a real panel would get a 401 for.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, TEST_TOKEN } from '../../server/test/harness'
import type { Harness } from '../../server/test/harness'
import { App } from '@/App'

function repositoryRoot(): string {
  let candidate = process.cwd()
  while (!existsSync(join(candidate, 'fixtures', 'ghost-warm', 'set.json'))) {
    const parent = dirname(candidate)
    if (parent === candidate) throw new Error('could not find the repository root from ' + process.cwd())
    candidate = parent
  }
  return candidate
}

const ROOT = repositoryRoot()
const CAPTURE_SET = JSON.parse(readFileSync(join(ROOT, 'fixtures/ghost-warm/set.json'), 'utf8')) as unknown

/** A one-pixel PNG. The bytes matter only in that they are a real image. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

let harness: Harness

function serveFromTheRealServer(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return harness.app.fetch(new Request(`http://localhost:4310${url.replace(/^https?:\/\/[^/]+/, '')}`, init))
  })
}

beforeEach(async () => {
  harness = await createHarness()
  serveFromTheRealServer()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await harness.close()
})

/** Import ghost-warm, then give one capture a screenshot the way the extension does. */
async function libraryWithOneScreenshot(): Promise<void> {
  await harness.call('/api/captures/import', { method: 'POST', body: JSON.stringify({ set: CAPTURE_SET }) })
  const stored = await harness.call('/api/captures/ghost-btn-primary/screenshot', {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: PNG,
  })
  expect(stored.status).toBe(200)
}

async function reachTheLibrary(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.type(await screen.findByLabelText('Pairing token'), TEST_TOKEN)
  await user.click(screen.getByRole('button', { name: 'Pair' }))
  await user.click(await screen.findByRole('button', { name: /Continue without a key/ }))
  await waitFor(() => expect(screen.getByText('ghost-btn-primary')).toBeTruthy())
}

describe('the capture list', () => {
  it('shows the screenshot the extension took, fetched through the pairing token', async () => {
    await libraryWithOneScreenshot()
    await reachTheLibrary(userEvent.setup())

    const thumb = await screen.findByAltText('button captured as ghost-btn-primary')
    // An object URL, which is the only way an authenticated image can reach an
    // <img>: a bare `src` could not have carried the token.
    expect(thumb.getAttribute('src')).toMatch(/^blob:/)
  })

  it('asks the server for nothing when a capture has no screenshot', async () => {
    await libraryWithOneScreenshot()
    await reachTheLibrary(userEvent.setup())
    await screen.findByAltText('button captured as ghost-btn-primary')

    // Nine of the ten ghost-warm captures carry no image, and a capture
    // without one is a capture, not an error: it gets the empty frame.
    expect(screen.queryByAltText('card captured as ghost-card-post')).toBeNull()
    expect(screen.getAllByTitle('this capture has no screenshot')).toHaveLength(9)
  })

  it('still renders the row when the stored screenshot cannot be read', async () => {
    await libraryWithOneScreenshot()
    // The row says the file is gone; it does not take the column down with it.
    await harness.store.captures.update('ghost-btn-primary', { screenshotPath: 'gone.png' })
    await reachTheLibrary(userEvent.setup())

    await waitFor(() =>
      expect(screen.getByTitle('this capture’s screenshot could not be loaded')).toBeTruthy(),
    )
    expect(screen.getByText('ghost-btn-primary')).toBeTruthy()
  })
})

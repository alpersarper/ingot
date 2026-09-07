/**
 * The panel, end to end: pair, import, generate, review, override, export.
 *
 * There is no fake server here, deliberately. `fetch` is pointed at the real
 * Hono app from `apps/server`, on an in-memory database, so every request the
 * panel makes is answered by the routes it ships against: the real pairing
 * guard, the real import, the real `distill`, the real override boundary with
 * its own idea of which document each question is asked of.
 *
 * A hand-written double is what let three separate defects through review --
 * each time, the fake reproduced the route's mistake and agreed with it. A fake
 * cannot disagree with the thing it was copied from, so this one is gone: a
 * divergence between panel and server is now a failing test rather than two
 * copies of the same wrong answer.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokensDocument } from '@ingot/engine'
import { createHarness, TEST_TOKEN } from '../../server/test/harness'
import type { Harness } from '../../server/test/harness'
import { App } from '@/App'

/**
 * The repository root. `import.meta.url` is an http URL under jsdom, so the
 * committed examples are found by walking up from the working directory
 * instead.
 */
function repositoryRoot(): string {
  let candidate = process.cwd()
  while (!existsSync(join(candidate, 'examples', 'ghost-warm', 'tokens.json'))) {
    const parent = dirname(candidate)
    if (parent === candidate) throw new Error('could not find the repository root from ' + process.cwd())
    candidate = parent
  }
  return candidate
}

const ROOT = repositoryRoot()

/**
 * The kit the server will distil from this fixture set.
 *
 * `examples/` is the committed byte contract for exactly that -- the server's
 * own determinism test holds it to these bytes -- so it is where the expected
 * values come from, while the document under test is the one the real engine
 * produces during the run.
 */
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'examples/ghost-warm/tokens.json'), 'utf8')) as TokensDocument
const CAPTURE_SET = JSON.parse(readFileSync(join(ROOT, 'fixtures/ghost-warm/set.json'), 'utf8')) as {
  captures: Array<{ id: string }>
}

let harness: Harness
let calls: Array<{ path: string; method: string; token: string | null }>

/** Point the browser's `fetch` at the real app, with no request rewritten. */
function serveFromTheRealServer(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const headers = new Headers(init.headers)
    calls.push({ path, method: init.method ?? 'GET', token: headers.get('x-ingot-token') })
    return harness.app.fetch(new Request(`http://localhost:4310${path}`, init))
  })
}

beforeEach(async () => {
  harness = await createHarness()
  calls = []
  serveFromTheRealServer()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await harness.close()
})

/** The scope the panel is reviewing: the group the import created. */
async function importedGroupId(): Promise<string> {
  const { groups } = await harness.json<{ groups: Array<{ id: string }> }>('/api/groups')
  const group = groups[0]
  if (group === undefined) throw new Error('nothing has been imported yet')
  return group.id
}

/** The document a consumer would be handed, straight from the server. */
async function designMarkdown(): Promise<string> {
  const groupId = await importedGroupId()
  const { kit } = await harness.json<{ kit: { id: string } }>(
    `/api/kits/latest?groupId=${encodeURIComponent(groupId)}`,
  )
  return (await harness.call(`/api/kits/${kit.id}/design.md`)).text()
}

/** The overrides the server is actually holding for the reviewed scope. */
async function storedOverrides(): Promise<Array<{ path: string; value: string; note: string; baseValue: string }>> {
  return harness.store.reviews.overrides(await importedGroupId())
}

/** Pair, import and generate: the state every review test starts from. */
async function reachTheWorkbench(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.type(await screen.findByLabelText('Pairing token'), TEST_TOKEN)
  await user.click(screen.getByRole('button', { name: 'Pair' }))
  await user.click(await screen.findByRole('button', { name: /Continue without a key/ }))
  await screen.findByRole('heading', { name: 'Collection' })

  await user.click(screen.getByRole('button', { name: /Paste a capture set/ }))
  // Set the textarea directly: typing a 20KB document keystroke by keystroke
  // would take minutes and prove nothing extra.
  fireEvent.change(screen.getByLabelText('Capture set JSON'), { target: { value: JSON.stringify(CAPTURE_SET) } })
  await user.click(screen.getByRole('button', { name: 'Import set' }))
  await waitFor(() => expect(screen.getByText('ghost-btn-primary')).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /Generate kit/ }))
  await screen.findByLabelText('Live preview')
}

describe('the panel, end to end', () => {
  it('pairs, imports a set, generates a kit, previews it and downloads design.md', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    // The preview renders the canonical components from the kit's tokens...
    const preview = screen.getByLabelText('Live preview')
    const publish = within(preview).getAllByRole('button', { name: 'Publish kit' })[0]
    expect(publish?.dataset['variant']).toBe('primary')

    // ...through CSS variables carrying real token values, not hardcoded ones.
    const surface = preview.querySelector<HTMLElement>('.kit-surface')
    expect(surface?.style.getPropertyValue('--kit-color-primary')).toBe(TOKENS.color.roles.primary?.value.hex)
    expect(surface?.style.getPropertyValue('--kit-space-unit')).toBe(`${TOKENS.spacing.baseUnit}px`)

    // The system panel reports the kit the preview is showing.
    const system = screen.getByRole('complementary', { name: 'System' })
    await user.click(within(system).getByRole('tab', { name: 'Export' }))
    expect(within(system).getByText('ghost-warm')).toBeTruthy()
    expect(within(system).getByText('v1')).toBeTruthy()

    // And design.md downloads, with the pairing token on the request.
    await user.click(within(system).getByRole('button', { name: 'design.md' }))
    await waitFor(() => {
      const download = calls.find((call) => call.path.endsWith('/design.md'))
      expect(download?.token).toBe(TEST_TOKEN)
    })
  })

  it('refuses a wrong pairing token and says where the right one is', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Pairing token'), 'not-the-token')
    await user.click(screen.getByRole('button', { name: 'Pair' }))

    expect(await screen.findByText(/does not match/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Collection' })).toBeNull()
  })

  it('sends the user back to pairing when the server stops recognising the token', async () => {
    window.localStorage.setItem('ingot.pairingToken', 'stale-token')
    render(<App />)

    // The stale token fails the very first call, so the shell must not pretend
    // to be usable.
    expect(await screen.findByLabelText('Pairing token')).toBeTruthy()
  })
})

describe('the review loop', () => {
  it('overrides a token and turns the preview, the docs and design.md together', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    const system = screen.getByRole('complementary', { name: 'System' })

    await user.click(within(system).getByRole('tab', { name: 'Tokens' }))
    // The radius group lists `md`; clicking its value opens the editor.
    const value = within(system).getByTitle('Override radius.steps.md')
    expect(value.textContent).toBe(`${TOKENS.radius.steps.md?.value}px`)
    await user.click(value)

    const field = within(system).getByLabelText('New value for radius.steps.md')
    fireEvent.change(field, { target: { value: '10px' } })
    fireEvent.change(within(system).getByLabelText('Reason for overriding radius.steps.md'), {
      target: { value: 'the captured radius reads timid' },
    })
    await user.click(within(system).getByRole('button', { name: 'Override' }))

    // The preview's variable set turns immediately...
    await waitFor(() => {
      const surface = screen.getByLabelText('Live preview').querySelector<HTMLElement>('.kit-surface')
      expect(surface?.style.getPropertyValue('--kit-radius-md')).toBe('10px')
    })

    // ...the token is marked as the reviewer's, not as evidence...
    await waitFor(() => expect(within(system).getAllByText('yours').length).toBeGreaterThan(0))

    // ...the docs view shows the same value with the same label...
    await user.click(within(screen.getByLabelText('Live preview')).getByRole('tab', { name: 'Docs' }))
    const preview = screen.getByLabelText('Live preview')
    await waitFor(() => expect(within(preview).getAllByText('user override').length).toBeGreaterThan(0))

    // ...and design.md carries it, with the reason.
    const design = await designMarkdown()
    expect(design).toContain('## 10. User overrides')
    expect(design).toContain('the captured radius reads timid')
  })

  it('reports a conflict as a card and lets the reviewer take the new evidence', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    const system = screen.getByRole('complementary', { name: 'System' })
    const engineRadius = `${TOKENS.radius.steps.md?.value}px`

    // A standing override whose recorded engine answer no longer matches: the
    // shape a regeneration produces when the captures have moved. Written
    // straight to the store, because that is where a carried-forward decision
    // lives once the evidence underneath it has changed.
    await harness.store.reviews.setOverride(await importedGroupId(), {
      path: 'radius.steps.md',
      value: '10px',
      baseValue: '4px',
      note: '',
    })
    await user.click(within(system).getByRole('button', { name: /Regenerate/ }))

    const card = await within(system).findByText(/Your value and the new evidence disagree/)
    expect(card).toBeTruthy()
    expect(within(system).getByText(/the engine now says/)).toBeTruthy()

    // Taking what the engine now says clears the override rather than storing
    // it as a new one -- an override that agrees with the engine is not an
    // override, and the server refuses one.
    await user.click(within(system).getByRole('button', { name: `Revert to the engine (${engineRadius})` }))
    await waitFor(() => {
      const surface = screen.getByLabelText('Live preview').querySelector<HTMLElement>('.kit-surface')
      expect(surface?.style.getPropertyValue('--kit-radius-md')).toBe(engineRadius)
    })
    // The decision is gone from the store, so the conflict cannot come back.
    expect(await storedOverrides()).toEqual([])
    await waitFor(() =>
      expect(within(system).queryByText(/Your value and the new evidence disagree/)).toBeNull(),
    )
  })

  it('records a reason typed onto an override that already exists', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    const system = screen.getByRole('complementary', { name: 'System' })
    await user.click(within(system).getByRole('tab', { name: 'Tokens' }))

    await user.click(within(system).getByTitle('Override radius.steps.md'))
    fireEvent.change(within(system).getByLabelText('New value for radius.steps.md'), {
      target: { value: '10px' },
    })
    await user.click(within(system).getByRole('button', { name: 'Override' }))
    await waitFor(async () => expect((await storedOverrides())[0]?.value).toBe('10px'))

    // Re-open the editor and change only the reason. The value is unchanged, so
    // an early return on "the value did not move" would drop the justification
    // on the floor while the editor closed as though it had saved.
    await user.click(within(system).getByTitle('Override radius.steps.md'))
    fireEvent.change(within(system).getByLabelText('Reason for overriding radius.steps.md'), {
      target: { value: 'the captured radius reads timid' },
    })
    await user.click(within(system).getByRole('button', { name: 'Override' }))

    await waitFor(async () => expect((await storedOverrides())[0]?.note).toBe('the captured radius reads timid'))
    // ...and it reaches the document the reviewer hands to a consumer.
    expect(await designMarkdown()).toContain('the captured radius reads timid')
  })

  it('keeps the reason when a conflict is answered from its card', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    const system = screen.getByRole('complementary', { name: 'System' })

    // The reviewer overrides a value and says why. design.md prints that reason.
    await user.click(within(system).getByRole('tab', { name: 'Tokens' }))
    await user.click(within(system).getByTitle('Override radius.steps.md'))
    fireEvent.change(within(system).getByLabelText('New value for radius.steps.md'), {
      target: { value: '10px' },
    })
    fireEvent.change(within(system).getByLabelText('Reason for overriding radius.steps.md'), {
      target: { value: 'brand asked for rounder corners' },
    })
    await user.click(within(system).getByRole('button', { name: 'Override' }))
    await waitFor(async () => expect((await storedOverrides())[0]?.note).toBe('brand asked for rounder corners'))

    // The evidence then moves under it, which is what raises the conflict.
    const groupId = await importedGroupId()
    const standing = (await storedOverrides())[0]
    if (standing === undefined) throw new Error('the override the reviewer just made is missing')
    await harness.store.reviews.setOverride(groupId, { ...standing, baseValue: '4px' })
    await user.click(within(system).getByRole('button', { name: /Regenerate/ }))
    await user.click(within(system).getByRole('tab', { name: /^Review/ }))
    await within(system).findByText(/Your value and the new evidence disagree/)

    // Answering it from the card is a value change, not a retraction of the
    // reason: the card sends no reason, and the standing one has to survive.
    fireEvent.change(within(system).getByLabelText('Override radius.steps.md'), { target: { value: '8px' } })
    await user.click(within(system).getByRole('button', { name: 'Set' }))

    await waitFor(async () => expect((await storedOverrides())[0]?.value).toBe('8px'))
    expect((await storedOverrides())[0]?.note).toBe('brand asked for rounder corners')
    const design = await designMarkdown()
    expect(design).toContain('## 10. User overrides')
    expect(design).toContain('brand asked for rounder corners')
  })

  it('counts only the overrides the exports actually carry', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    const system = screen.getByRole('complementary', { name: 'System' })
    const groupId = await importedGroupId()

    // One override the engine applies, and one it refuses because this kit has
    // no such slot -- the shape a regeneration leaves when a step disappears.
    await harness.store.reviews.setOverride(groupId, {
      path: 'radius.steps.md',
      value: '10px',
      baseValue: `${TOKENS.radius.steps.md?.value}px`,
      note: '',
    })
    await harness.store.reviews.setOverride(groupId, {
      path: 'radius.steps.full',
      value: '999px',
      baseValue: '999px',
      note: '',
    })
    await user.click(within(system).getByRole('button', { name: /Regenerate/ }))
    await user.click(within(system).getByRole('tab', { name: 'Export' }))

    // The refused one is in none of the files, so the count must not claim it.
    expect(within(system).getByText(/carries your 1 override,/)).toBeTruthy()
    expect(within(system).queryByText(/carries your 2 overrides/)).toBeNull()
    // ...and it is named rather than hidden.
    expect(within(system).getByText(/could not be applied to this kit/)).toBeTruthy()
    expect(within(system).getByText('radius.steps.full')).toBeTruthy()
  })

  it('accepts a decision card and remembers it', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    const system = screen.getByRole('complementary', { name: 'System' })

    // ghost-warm distils cleanly, so its only cards are close calls; the radius
    // decision is one (16 of 28 corners, runner-up 12px).
    const closeCalls = await within(system).findAllByText(/close call/)
    await user.click(closeCalls[0] as HTMLElement)
    await user.click(within(system).getAllByRole('button', { name: 'Accept' })[0] as HTMLElement)

    await waitFor(async () =>
      expect(await harness.store.reviews.decisions(await importedGroupId())).toHaveLength(1),
    )
    expect(within(system).getAllByText('accepted').length).toBeGreaterThan(0)
  })
})

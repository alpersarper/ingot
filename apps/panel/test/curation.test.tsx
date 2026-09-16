/**
 * Curation, end to end: select, group, distil, delete, start over.
 *
 * Against the real server, for the same reason the smoke test is -- a fake
 * cannot disagree with the route it was copied from. What is under test here is
 * the *model*: the library is a pool, groups are non-exclusive curations within
 * it, and a kit is generated from a scope that may be the whole library, a
 * group, or an ad-hoc selection. Every destructive path is asserted to ask
 * first and to name what survives, because the one thing that must never be
 * true of this column is that something disappeared and nobody said so.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/** Pair and import ghost-warm: ten captures, four types, in one group. */
async function reachTheLibrary(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.type(await screen.findByLabelText('Pairing token'), TEST_TOKEN)
  await user.click(screen.getByRole('button', { name: 'Pair' }))
  await user.click(await screen.findByRole('button', { name: /Continue without a key/ }))
  await screen.findByRole('heading', { name: 'Collection' })

  await user.click(screen.getByRole('button', { name: /Paste a capture set/ }))
  fireEvent.change(screen.getByLabelText('Capture set JSON'), { target: { value: JSON.stringify(CAPTURE_SET) } })
  await user.click(screen.getByRole('button', { name: 'Import set' }))
  await waitFor(() => expect(screen.getByText('ghost-btn-primary')).toBeTruthy())
}

/** Tick captures by their ids. */
async function select(user: ReturnType<typeof userEvent.setup>, ...ids: string[]): Promise<void> {
  for (const id of ids) await user.click(screen.getByLabelText(`Select ${id}`))
}

function collection(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Collection' })
}

describe('selecting captures', () => {
  it('reports how many are selected and what they are made of', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)

    // Nothing selected: the bar is not there to be ignored.
    expect(screen.queryByRole('region', { name: 'Selection' })).toBeNull()

    await select(user, 'ghost-btn-primary', 'ghost-btn-secondary', 'ghost-card-post', 'ghost-input-email')

    const bar = screen.getByRole('region', { name: 'Selection' })
    expect(within(bar).getByText('4 selected')).toBeTruthy()
    // The mix is the part that says whether this is evidence worth distilling.
    expect(within(bar).getByTestId('type-mix').textContent).toBe('2 buttons · 1 card · 1 input')
    // ...and the sizing guidance sits with it, once, quietly.
    expect(within(bar).getByText(/8-15 captures/)).toBeTruthy()
  })

  it('drops the selection when the scope changes, rather than acting on rows nobody can see', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)
    await select(user, 'ghost-btn-primary')
    expect(screen.getByRole('region', { name: 'Selection' })).toBeTruthy()

    await user.click(within(collection()).getByRole('button', { name: /Whole library/ }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selection' })).toBeNull())
  })
})

describe('grouping a selection', () => {
  it('makes a new group from what is ticked and opens it', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)
    await select(user, 'ghost-btn-primary', 'ghost-card-post')

    await user.click(screen.getByRole('button', { name: 'Group selection' }))
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Warm controls' } })
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(async () => {
      const { groups } = await harness.json<{ groups: Array<{ slug: string; name: string; captureCount: number }> }>(
        '/api/groups',
      )
      expect(groups.map((group) => group.slug)).toContain('warm-controls')
    })
    const { groups } = await harness.json<{ groups: Array<{ id: string; slug: string; captureCount: number }> }>(
      '/api/groups',
    )
    const made = groups.find((group) => group.slug === 'warm-controls')
    expect(made?.captureCount).toBe(2)

    // The user lands in what they just curated, and the list narrows to it.
    await waitFor(() => expect(screen.queryByText('ghost-input-email')).toBeNull())
    expect(screen.getByText('ghost-btn-primary')).toBeTruthy()
  })

  it('adds to an existing group without taking the captures out of the first one', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)

    // One group made from a selection...
    await select(user, 'ghost-btn-primary')
    await user.click(screen.getByRole('button', { name: 'Group selection' }))
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Buttons' } })
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(within(collection()).getByText('buttons')).toBeTruthy())

    // ...and the same capture added to a second. Groups are curations, not
    // containers: membership of one is not membership of nothing else.
    await user.click(within(collection()).getByRole('button', { name: /Whole library/ }))
    await screen.findByText('ghost-input-email')
    await select(user, 'ghost-btn-primary')
    await user.click(screen.getByRole('button', { name: 'Group selection' }))
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Brand' } })
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(async () => {
      const { groups } = await harness.json<{ groups: Array<{ slug: string }> }>('/api/groups')
      expect(groups.map((group) => group.slug).sort()).toEqual(['brand', 'buttons', 'ghost-warm'])
    })
    const { groups } = await harness.json<{ groups: Array<{ id: string; slug: string }> }>('/api/groups')
    for (const slug of ['brand', 'buttons', 'ghost-warm']) {
      const group = groups.find((candidate) => candidate.slug === slug)
      if (group === undefined) throw new Error(`group ${slug} is missing`)
      expect(await harness.store.groups.captureIds(group.id)).toContain('ghost-btn-primary')
    }
  })
})

describe('generating from a selection', () => {
  it('distils exactly what is ticked and says the kit is a one-off', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)
    await user.click(within(collection()).getByRole('button', { name: /Whole library/ }))
    await screen.findByText('ghost-input-email')

    await select(user, 'ghost-btn-primary', 'ghost-card-post', 'ghost-input-email', 'ghost-type-page-title')
    await user.click(screen.getByRole('button', { name: 'Generate from selection' }))

    await screen.findByLabelText('Live preview')
    const system = screen.getByRole('complementary', { name: 'System' })
    // The kit states what it is rather than passing as the library's.
    expect(await within(system).findByText(/One-off kit/)).toBeTruthy()
    expect(within(system).getByText(/4 selected captures/)).toBeTruthy()

    const { kit } = await harness.json<{ kit: { scope: string; captureIds: string[] } }>('/api/kits/latest')
    expect(kit.scope).toBe('selection')
    expect(kit.captureIds).toEqual(['ghost-btn-primary', 'ghost-input-email', 'ghost-card-post', 'ghost-type-page-title'])
  })

  it('files an override made on a one-off under the library, even while a group is still open', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)

    // The group scope has a kit of its own, so a misfiled write would have a
    // real document to land on rather than failing loudly.
    const system = screen.getByRole('complementary', { name: 'System' })
    await user.click(within(system).getByRole('button', { name: /Generate kit/ }))
    await waitFor(() => expect(screen.getByLabelText('Live preview').querySelector('.kit-surface')).toBeTruthy())

    await select(user, 'ghost-btn-primary', 'ghost-card-post', 'ghost-input-email', 'ghost-type-page-title')
    await user.click(screen.getByRole('button', { name: 'Generate from selection' }))
    expect(await within(system).findByText(/One-off kit/)).toBeTruthy()

    await user.click(within(system).getByRole('tab', { name: 'Tokens' }))
    await user.click(within(system).getByTitle('Override radius.steps.md'))
    fireEvent.change(within(system).getByLabelText('New value for radius.steps.md'), { target: { value: '10px' } })
    await user.click(within(system).getByRole('button', { name: 'Override' }))

    // The write lands where the one-off's notice says it does: on the
    // library's review state, not on the group still open on the left.
    await waitFor(async () =>
      expect(await harness.store.reviews.overrides(null)).toEqual([
        expect.objectContaining({ path: 'radius.steps.md', value: '10px' }),
      ]),
    )
    const { groups } = await harness.json<{ groups: Array<{ id: string }> }>('/api/groups')
    const groupId = groups[0]?.id
    if (groupId === undefined) throw new Error('the imported group is missing')
    expect(await harness.store.reviews.overrides(groupId)).toEqual([])

    // ...and the kit on screen is still the one-off, not the group's kit
    // quietly swapped in by the write's response.
    expect(within(system).getByText(/One-off kit/)).toBeTruthy()
  })

  it('offers the generate button in the empty middle column, where the user is looking', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)

    // No kit yet, so the middle is the empty state -- and it carries the action
    // rather than pointing at one in another column.
    const middle = screen.getByLabelText('Live preview')
    await user.click(within(middle).getByRole('button', { name: 'Generate kit' }))
    await waitFor(() => expect(screen.getByLabelText('Live preview').querySelector('.kit-surface')).toBeTruthy())
  })
})

describe('deleting', () => {
  it('asks before deleting one capture, and says what survives', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)

    await user.click(screen.getByLabelText('Delete ghost-card-callout'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete this capture?')).toBeTruthy()
    expect(within(dialog).getByText(/Kits you have already generated keep the evidence/)).toBeTruthy()

    // Cancelling really cancels.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('ghost-card-callout')).toBeTruthy()

    await user.click(screen.getByLabelText('Delete ghost-card-callout'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete capture' }))
    await waitFor(() => expect(screen.queryByText('ghost-card-callout')).toBeNull())
    expect(await harness.store.captures.get('ghost-card-callout')).toBeNull()
  })

  it('keeps the on-screen kit through a delete, and quietly notes deleted evidence', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)

    // A one-off on screen while the imported group is still open on the left:
    // the exact shape in which the old re-read swapped or blanked the kit.
    await select(user, 'ghost-btn-primary', 'ghost-card-post', 'ghost-input-email', 'ghost-type-page-title')
    await user.click(screen.getByRole('button', { name: 'Generate from selection' }))
    const system = screen.getByRole('complementary', { name: 'System' })
    expect(await within(system).findByText(/One-off kit/)).toBeTruthy()

    // Deleting a capture that did not feed the kit changes nothing about it.
    await user.click(screen.getByLabelText('Delete ghost-card-callout'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete capture' }))
    await waitFor(() => expect(screen.queryByText('ghost-card-callout')).toBeNull())
    expect(within(system).getByText(/One-off kit/)).toBeTruthy()
    expect(screen.getByLabelText('Live preview').querySelector('.kit-surface')).toBeTruthy()
    expect(within(system).queryByText(/deleted since this kit was generated/)).toBeNull()

    // Deleting a contributing capture leaves the kit exactly as it is -- the
    // group scope has no kit of its own, so the old behaviour blanked the
    // middle column here -- and the kit says what is gone.
    await user.click(screen.getByLabelText('Delete ghost-btn-primary'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete capture' }))
    await waitFor(() => expect(screen.queryByText('ghost-btn-primary')).toBeNull())
    expect(within(system).getByText(/One-off kit/)).toBeTruthy()
    expect(within(system).getByText(/4 selected captures/)).toBeTruthy()
    expect(screen.getByLabelText('Live preview').querySelector('.kit-surface')).toBeTruthy()
    await waitFor(() =>
      expect(within(system).getByText(/One contributing capture was deleted since this kit was generated/)).toBeTruthy(),
    )
  })

  it('deletes a whole selection behind one confirmation', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)
    await select(user, 'ghost-btn-primary', 'ghost-btn-secondary')

    await user.click(screen.getByRole('button', { name: /Delete 2 selected captures/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete 2 captures?')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 captures' }))

    await waitFor(async () => expect(await harness.store.captures.get('ghost-btn-primary')).toBeNull())
    expect(await harness.store.captures.get('ghost-btn-secondary')).toBeNull()
    // The bar goes with the selection it was describing.
    expect(screen.queryByRole('region', { name: 'Selection' })).toBeNull()
  })

  it('states honestly that deleting a group keeps its captures and its kits', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)
    const system = screen.getByRole('complementary', { name: 'System' })
    await user.click(within(system).getByRole('button', { name: /Generate kit/ }))
    await screen.findByLabelText('Live preview')

    await user.click(within(collection()).getByRole('button', { name: /Actions for Ghost-like warm editorial UI/ }))
    await user.click(screen.getByRole('button', { name: 'Delete group...' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/10 captures stay in the library/)).toBeTruthy()
    // The kit-protection law, in the words of the thing that enforces it.
    expect(within(dialog).getByText(/Its 1 kit is kept too/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Delete group' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(async () => expect(await harness.store.groups.list()).toEqual([]))
    // Captures survive...
    expect(await harness.store.captures.list()).toHaveLength(10)
    // ...and so does the kit, orphaned rather than deleted.
    const kits = await harness.store.kits.list()
    expect(kits).toHaveLength(1)
    expect(kits[0]).toEqual(expect.objectContaining({ scope: 'group', groupId: null }))
  })

  it('renames a group in place', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)

    await user.click(within(collection()).getByRole('button', { name: /Actions for Ghost-like warm editorial UI/ }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Rename Ghost-like warm editorial UI'), {
      target: { value: 'Warm editorial' },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const groups = await harness.store.groups.list()
      expect(groups[0]?.name).toBe('Warm editorial')
    })
    // The slug is identity and does not follow the name: it is the set id every
    // exported file is named after.
    expect((await harness.store.groups.list())[0]?.slug).toBe('ghost-warm')
  })
})

describe('starting over', () => {
  it('names everything it will destroy and refuses until the word is typed', async () => {
    const user = userEvent.setup()
    await reachTheLibrary(user)
    const system = screen.getByRole('complementary', { name: 'System' })
    await user.click(within(system).getByRole('button', { name: /Generate kit/ }))
    await screen.findByLabelText('Live preview')

    await user.click(within(collection()).getByRole('button', { name: 'Collection menu' }))
    await user.click(screen.getByRole('button', { name: 'Start over...' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/every capture and screenshot, every group, every kit/)).toBeTruthy()
    expect(within(dialog).getByText(/only action in Ingot that deletes a kit/)).toBeTruthy()
    expect(within(dialog).getByText(/pairing stays/)).toBeTruthy()

    // The button is inert until the confirmation is typed.
    const confirm = within(dialog).getByRole('button', { name: 'Destroy this library' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Type reset to confirm'), { target: { value: 'reset' } })
    expect(confirm.hasAttribute('disabled')).toBe(false)

    await user.click(confirm)
    await waitFor(async () => expect(await harness.store.captures.list()).toEqual([]))
    expect(await harness.store.groups.list()).toEqual([])
    expect(await harness.store.kits.list()).toEqual([])
    // The panel is back to an empty library, still paired...
    expect(await screen.findByText(/Nothing captured yet/)).toBeTruthy()
    expect(screen.queryByLabelText('Pairing token')).toBeNull()
    // ...and the question is not still being asked about a library that is
    // already gone.
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/**
 * The assistant in the panel: setup, suggestion, acceptance, dismissal.
 *
 * Same discipline as `panel.smoke.test.tsx` and for the same reason: `fetch`
 * points at the real Hono app, so every assertion below is about the panel and
 * the server agreeing. The only thing faked is the model's answer, scripted
 * through `harness.llm` -- the engine's guardrail check, the override write
 * path, the provenance and the rate limiter are all the real ones.
 *
 * The two properties worth having a test at this level for are the ones a
 * server test cannot see: that a proposal is visibly a *suggestion* rather than
 * a finding, and that with no key the rest of the column still works.
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

const CAPTURE_SET = JSON.parse(readFileSync(join(repositoryRoot(), 'fixtures/ghost-warm/set.json'), 'utf8')) as unknown

/** A key shaped like a real one, so no shape warning muddies a test. */
const KEY = 'sk-ant-api03-PANELKEYPANELKEYPANELKEY'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return harness.app.fetch(new Request(`http://localhost:4310${url.replace(/^https?:\/\/[^/]+/, '')}`, init))
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  await harness.close()
})

async function reachTheWorkbench(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.type(await screen.findByLabelText('Pairing token'), TEST_TOKEN)
  await user.click(screen.getByRole('button', { name: 'Pair' }))
  await user.click(await screen.findByRole('button', { name: /Continue without a key/ }))
  await screen.findByRole('heading', { name: 'Collection' })

  await user.click(screen.getByRole('button', { name: /Paste a capture set/ }))
  fireEvent.change(screen.getByLabelText('Capture set JSON'), { target: { value: JSON.stringify(CAPTURE_SET) } })
  await user.click(screen.getByRole('button', { name: 'Import set' }))
  await waitFor(() => expect(screen.getByText('ghost-btn-primary')).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /Generate kit/ }))
  await screen.findByLabelText('Live preview')
}

function systemPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: 'System' })
}

/**
 * The scope the panel is reviewing.
 *
 * Importing lands the user in the group they just imported, so that -- not the
 * library -- is the scope every proposal and override below belongs to.
 */
async function reviewedScope(): Promise<string> {
  const { groups } = await harness.json<{ groups: Array<{ id: string }> }>('/api/groups')
  const group = groups[0]
  if (group === undefined) throw new Error('nothing has been imported yet')
  return group.id
}

describe('the assistant with no key', () => {
  it('shows the setup path, including the thing everyone gets wrong', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    await user.click(within(systemPanel()).getByRole('tab', { name: 'Assistant' }))

    // The distinction a Claude subscriber will otherwise discover by failing.
    expect(within(systemPanel()).getByText(/does not include API usage/)).toBeTruthy()
    // Where to go, and what it costs, rather than a shrug.
    expect(within(systemPanel()).getByRole('link', { name: /console\.anthropic\.com/ })).toBeTruthy()
    expect(within(systemPanel()).getByText(/\$0\.03/)).toBeTruthy()
    expect(within(systemPanel()).getByText(/\$5 of credit is ample/)).toBeTruthy()
  })

  it('leaves the rest of the column working', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    // Review, Tokens and Export are all reachable and populated with no key.
    await user.click(within(systemPanel()).getByRole('tab', { name: 'Tokens' }))
    expect(within(systemPanel()).getByText('Colour roles')).toBeTruthy()
    await user.click(within(systemPanel()).getByRole('tab', { name: 'Export' }))
    expect(within(systemPanel()).getByText('ghost-warm')).toBeTruthy()
  })
})

describe('the proposal loop', () => {
  async function setUpAssistant(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await reachTheWorkbench(user)
    await user.click(within(systemPanel()).getByRole('tab', { name: 'Assistant' }))
    await user.type(within(systemPanel()).getByLabelText('Anthropic API key'), KEY)
    await user.click(within(systemPanel()).getByRole('button', { name: 'Save key' }))
    // The tab turns over to its working state once the key is stored.
    await screen.findByRole('button', { name: /Fill the gaps/ })
  }

  it('turns a suggestion into a card that reads as a suggestion, and applies it on accept', async () => {
    const user = userEvent.setup()
    await setUpAssistant(user)

    harness.llm.reply({
      proposals: [
        {
          path: 'border.width',
          value: '2px',
          title: 'Thicken the hairline',
          rationale: 'The kit is warm and editorial; a hairline disappears against sand.',
        },
      ],
    })
    await user.click(within(systemPanel()).getByRole('button', { name: /Fill the gaps/ }))

    // It lands in the Review queue, not in a panel of its own.
    await waitFor(() => expect(within(systemPanel()).getByText(/1 suggestion waiting/)).toBeTruthy())
    await user.click(within(systemPanel()).getByRole('tab', { name: /^Review/ }))

    const card = await waitFor(() => {
      const found = systemPanel().querySelector<HTMLElement>('[data-card-kind="proposal"]')
      if (found === null) throw new Error('no proposal card')
      return found
    })

    // It is visibly a suggestion rather than an engine finding: the label says
    // so, and the attribution says which model and which prompt version.
    expect(within(card).getByText('Assistant suggestion')).toBeTruthy()
    expect(within(card).getByText(/claude-sonnet-5/)).toBeTruthy()
    expect(within(card).getByText('Thicken the hairline')).toBeTruthy()
    // The engine's own answer is on the card beside the proposed one.
    expect(within(card).getByText(/the engine says 1px/)).toBeTruthy()

    // Nothing has changed in the kit yet.
    expect(await harness.store.reviews.overrides(await reviewedScope())).toEqual([])

    await user.click(within(card).getByRole('button', { name: /Accept \(2px\)/ }))

    // Accepting writes an ordinary override, recorded as one the assistant
    // proposed -- and the preview turns with it.
    await waitFor(async () => {
      const [override] = await harness.store.reviews.overrides(await reviewedScope())
      expect(override?.path).toBe('border.width')
      expect(override?.value).toBe('2px')
      expect(override?.suggestedBy).toBe('assistant')
    })
    await waitFor(() => {
      const surface = screen.getByLabelText('Live preview').querySelector<HTMLElement>('.kit-surface')
      expect(surface?.style.getPropertyValue('--kit-border-width')).toBe('2px')
    })
  })

  it('writes nothing to the kit when a suggestion is dismissed', async () => {
    const user = userEvent.setup()
    await setUpAssistant(user)

    harness.llm.reply({
      proposals: [{ path: 'border.width', value: '2px', title: 'Thicker', rationale: 'Reads better on paper.' }],
    })
    await user.click(within(systemPanel()).getByRole('button', { name: /Fill the gaps/ }))
    await waitFor(() => expect(within(systemPanel()).getByText(/1 suggestion waiting/)).toBeTruthy())

    await user.click(within(systemPanel()).getByRole('tab', { name: /^Review/ }))
    const card = await waitFor(() => {
      const found = systemPanel().querySelector<HTMLElement>('[data-card-kind="proposal"]')
      if (found === null) throw new Error('no proposal card')
      return found
    })
    await user.click(within(card).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      const settled = systemPanel().querySelector<HTMLElement>('[data-card-kind="proposal"]')
      expect(settled?.dataset['cardState']).toBe('dismissed')
    })
    expect(await harness.store.reviews.overrides(await reviewedScope())).toEqual([])
  })

  it('reports a failed assistant call as a notice and leaves everything else usable', async () => {
    const user = userEvent.setup()
    await setUpAssistant(user)

    harness.llm.fail(new Error(`503 upstream is down (x-api-key: ${KEY})`))
    await user.click(within(systemPanel()).getByRole('button', { name: /Fill the gaps/ }))

    const notice = await within(systemPanel()).findByRole('alert')
    expect(notice.textContent ?? '').not.toBe('')
    // The key is not in what the panel was told, because it was never in what
    // the server said.
    expect(document.body.textContent ?? '').not.toContain(KEY)

    // And the rest of the column is untouched by an advisory layer failing.
    await user.click(within(systemPanel()).getByRole('tab', { name: 'Tokens' }))
    expect(within(systemPanel()).getByText('Colour roles')).toBeTruthy()
  })

  it('offers to draft a reason only where an override has none, and never sends it', async () => {
    const user = userEvent.setup()
    await setUpAssistant(user)

    // Override a token by hand, leaving the reason empty: the gap the draft is
    // offered for.
    await user.click(within(systemPanel()).getByRole('tab', { name: 'Tokens' }))
    await user.click(within(systemPanel()).getByTitle('Override border.width'))
    const value = within(systemPanel()).getByLabelText('New value for border.width')
    await user.clear(value)
    await user.type(value, '3px')
    await user.click(within(systemPanel()).getByRole('button', { name: 'Override' }))

    await user.click(await within(systemPanel()).findByTitle('Override border.width'))
    const drafter = await within(systemPanel()).findByRole('button', { name: /Draft a reason/ })

    harness.llm.reply({ reason: 'A hairline vanishes against this palette, so the rule is a shade heavier.' })
    await user.click(drafter)

    // It fills the box and stops there: the stored override still has no reason
    // until the reviewer presses Override themselves.
    const reason = await within(systemPanel()).findByLabelText('Reason for overriding border.width')
    await waitFor(() => expect((reason as HTMLInputElement).value).toContain('hairline vanishes'))
    expect((await harness.store.reviews.overrides(await reviewedScope()))[0]?.note).toBe('')

    await user.click(within(systemPanel()).getByRole('button', { name: 'Override' }))
    await waitFor(async () => {
      expect((await harness.store.reviews.overrides(await reviewedScope()))[0]?.note).toContain('hairline vanishes')
    })

    // And with a reason now standing, the offer is gone: there is no gap left.
    await user.click(await within(systemPanel()).findByTitle('Override border.width'))
    expect(within(systemPanel()).queryByRole('button', { name: /Draft a reason/ })).toBeNull()
  })

  it('answers a question with the citations the server resolved', async () => {
    const user = userEvent.setup()
    await setUpAssistant(user)

    harness.llm.reply({
      answer: 'Every capture that drew a line drew a hairline, so the kit has one.',
      citations: ['border.width'],
    })
    await user.type(within(systemPanel()).getByLabelText(/Ask the assistant/), 'why is the border 1px?')
    await user.click(within(systemPanel()).getByRole('button', { name: 'Ask' }))

    expect(await within(systemPanel()).findByText(/Every capture that drew a line/)).toBeTruthy()
    // The citation carries the token's own value and dominant-choice record, so
    // the panel shows the evidence rather than the model's summary of it.
    expect(within(systemPanel()).getByText(/border\.width/)).toBeTruthy()
  })
})

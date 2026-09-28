/**
 * The connection picker, in the panel, against the real server.
 *
 * Two properties are worth a test at this level, and neither is visible from a
 * server test.
 *
 * **A machine with Claude Code signed in has a working assistant and is never
 * asked for a key.** That is the whole point of the feature, and the way it
 * would regress is not an error -- it is the setup screen quietly appearing for
 * somebody who did not need it.
 *
 * **A connection this runtime cannot reach is disabled and explained, not
 * hidden.** Hiding it reads as "Ingot does not have that". The panel has to say
 * "that one is for the local run", and it has to say it while still showing the
 * connections that do work here.
 *
 * `fetch` points at the real Hono app throughout, as in the other panel suites,
 * so every assertion is about the panel and the server agreeing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { body, createHarness, put, TEST_TOKEN } from '../../server/test/harness'
import type { Harness, HarnessOptions } from '../../server/test/harness'
import type { CliProbe } from '../../server/src/assistant/claude-cli'
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

const SIGNED_IN: CliProbe = {
  available: true,
  version: '2.1.236',
  signedIn: true,
  auth: 'subscription',
  detail: '2.1.236 and signed in',
}

let harness: Harness | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  await harness?.close()
  harness = undefined
})

/** Build the world this test needs, then point the panel's `fetch` at it. */
async function serve(options: HarnessOptions): Promise<void> {
  harness = await createHarness(options)
  const app = harness.app
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return app.fetch(new Request(`http://localhost:4310${url.replace(/^https?:\/\/[^/]+/, '')}`, init))
  })
}

function systemPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: 'System' })
}

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

  await user.click(within(systemPanel()).getByRole('button', { name: /Generate kit/ }))
  await screen.findByLabelText('Live preview')
  await user.click(within(systemPanel()).getByRole('tab', { name: 'Assistant' }))
}

describe('a machine with the Claude CLI signed in', () => {
  it('is working with no key, and is never shown the Anthropic errand', async () => {
    await serve({ cli: SIGNED_IN })
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    // The working state, reached without anybody typing a key.
    await screen.findByRole('button', { name: /Fill the gaps/ })
    // And the twenty-minute errand is not on screen.
    expect(within(systemPanel()).queryByText(/does not include API usage/)).toBeNull()

    const chosen = within(systemPanel()).getByRole('radio', { name: /Local Claude Code CLI/ })
    expect(chosen.getAttribute('aria-checked')).toBe('true')
  })

  it('names the key its chrome button is about, so a keyless CLI is not called keyless in general', async () => {
    await serve({ cli: SIGNED_IN })
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    await screen.findByRole('button', { name: /Fill the gaps/ })

    // The Topbar button writes the Anthropic key and only ever knew about that
    // one. With two keys in the product, its tooltip must say which one is
    // absent: an endpoint bearer token may well be stored.
    const button = screen.getByRole('button', { name: /Add LLM key/ })
    expect(button.title).toContain('without an Anthropic key')
    expect(button.title).toContain('Assistant tab')
  })

  it('switches to the Anthropic connection and shows its setup, on one click', async () => {
    await serve({ cli: SIGNED_IN })
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    await screen.findByRole('button', { name: /Fill the gaps/ })

    await user.click(within(systemPanel()).getByRole('radio', { name: /Anthropic API key/ }))

    // Chosen but not ready, so the tab falls back to its setup state -- and
    // that is where the sentence everybody is surprised by lives.
    await screen.findByLabelText('Anthropic API key')
    expect(within(systemPanel()).getByText(/does not include API usage/)).toBeTruthy()
  })

  it('does not carry the Claude model over to an endpoint that has no model yet', async () => {
    await serve({ cli: SIGNED_IN })
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    await screen.findByRole('button', { name: /Fill the gaps/ })
    expect((within(systemPanel()).getByLabelText('Assistant model') as HTMLInputElement).value).toBe('claude-sonnet-5')

    // Each connection has its own default model: the two Claude connections
    // start on claude-sonnet-5, the endpoint deliberately on nothing, because
    // the server cannot know what an Ollama or OpenRouter endpoint serves.
    await user.click(within(systemPanel()).getByRole('radio', { name: /OpenAI-compatible endpoint/ }))
    await screen.findByLabelText('Endpoint URL')
    expect((within(systemPanel()).getByLabelText('Assistant model') as HTMLInputElement).value).toBe('')

    await user.click(within(systemPanel()).getByRole('radio', { name: /Anthropic API key/ }))
    await screen.findByLabelText('Anthropic API key')
    expect((within(systemPanel()).getByLabelText('Assistant model') as HTMLInputElement).value).toBe('claude-sonnet-5')

    // Back to the endpoint, from one setup screen to another this time. The
    // field is a different field for a different connection: it must show that
    // connection's model, and Save must not be offering to store
    // claude-sonnet-5 as the model an Ollama endpoint serves.
    await user.click(within(systemPanel()).getByRole('radio', { name: /OpenAI-compatible endpoint/ }))
    await screen.findByLabelText('Endpoint URL')
    const model = within(systemPanel()).getByLabelText('Assistant model') as HTMLInputElement
    expect(model.value).toBe('')
    expect(model.placeholder).toBe('the model this endpoint serves')
    expect((within(systemPanel()).getByRole('button', { name: 'Save model' }) as HTMLButtonElement).disabled).toBe(true)
    expect(await harness?.store.settings.get('llm.model')).toBeNull()
  })
})

describe('a machine whose CLI is signed in with an API key', () => {
  it('says so on the connection row and in its setup, instead of calling it key-free', async () => {
    await serve({ cli: { ...SIGNED_IN, auth: 'api-key', detail: '2.1.236 and signed in via console' } })
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    await screen.findByRole('button', { name: /Fill the gaps/ })

    // Still the working state -- a keyed CLI answers -- but the label is the
    // observation, not the promise.
    const cli = within(systemPanel()).getByRole('radio', { name: /Local Claude Code CLI/ })
    expect(cli.textContent).toContain('signed in with an API key')
    expect(cli.textContent).not.toContain('No API key')
    expect(within(systemPanel()).getByRole('heading', { name: 'Signed in with an API key' })).toBeTruthy()
    expect(within(systemPanel()).queryByRole('heading', { name: 'No API key needed' })).toBeNull()
  })
})

describe('what the CLI setup says it costs', () => {
  it('claims the subscription covers it only when the probe saw a subscription login', async () => {
    await serve({ cli: SIGNED_IN })
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    await screen.findByRole('button', { name: /Fill the gaps/ })
    expect(within(systemPanel()).getByText(/Nothing is billed per call/)).toBeTruthy()
  })

  it('names no price at all when the probe could not classify the login', async () => {
    // An older CLI, or an auth method this build does not recognise. Still
    // usable, still key-free on Ingot's side -- and what it costs is unknown,
    // so the panel says what it knows and no more.
    await serve({ cli: { ...SIGNED_IN, auth: undefined, detail: '2.1.236 and signed in' } })
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    await screen.findByRole('button', { name: /Fill the gaps/ })
    expect(within(systemPanel()).getByRole('heading', { name: 'No API key needed' })).toBeTruthy()
    expect(within(systemPanel()).getByText(/whichever account that command is signed into/)).toBeTruthy()
    expect(within(systemPanel()).queryByText(/billed/)).toBeNull()
    expect(within(systemPanel()).queryByText(/subscription covers it/)).toBeNull()
  })
})

describe('the same panel in a container', () => {
  it('disables the CLI connection and says what it is for, without hiding it', async () => {
    await serve({ cli: SIGNED_IN, containerized: true })
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    // Still listed -- dropping it would read as "Ingot does not have that".
    const cli = within(systemPanel()).getByRole('radio', { name: /Local Claude Code CLI/ })
    expect((cli as HTMLButtonElement).disabled).toBe(true)
    expect(cli.textContent).toContain('container')
    expect(cli.textContent).toContain('pnpm dev')

    // And the connections that do work here are the ones offered.
    expect(
      (within(systemPanel()).getByRole('radio', { name: /OpenAI-compatible endpoint/ }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('offers the endpoint field with the host.docker.internal note the container needs', async () => {
    await serve({ cli: SIGNED_IN, containerized: true })
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    await user.click(within(systemPanel()).getByRole('radio', { name: /OpenAI-compatible endpoint/ }))
    const endpoint = await screen.findByLabelText('Endpoint URL')
    expect(within(systemPanel()).getByText(/host\.docker\.internal/)).toBeTruthy()

    fireEvent.change(endpoint, { target: { value: 'http://host.docker.internal:11434/v1' } })
    await user.click(within(systemPanel()).getByRole('button', { name: 'Save endpoint' }))

    // Stored server-side and reported back, because a typo in an endpoint has
    // to be visible to be fixed.
    await waitFor(async () => {
      const settings = await harness?.json<{ settings: { llm: { baseUrl?: string } } }>('/api/settings')
      expect(settings?.settings.llm.baseUrl).toBe('http://host.docker.internal:11434/v1')
    })
  })

  it('settles Save into the saved state when the endpoint was typed with a trailing slash', async () => {
    await serve({ cli: SIGNED_IN, containerized: true })
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    await user.click(within(systemPanel()).getByRole('radio', { name: /OpenAI-compatible endpoint/ }))
    const endpoint = await screen.findByLabelText('Endpoint URL')
    const saveEndpoint = (): HTMLButtonElement =>
      within(systemPanel()).getByRole('button', { name: 'Save endpoint' }) as HTMLButtonElement

    fireEvent.change(endpoint, { target: { value: 'http://host.docker.internal:11434/v1/' } })
    expect(saveEndpoint().disabled).toBe(false)
    await user.click(saveEndpoint())

    // The server keeps the URL without the slash. The control has to read as
    // saved against that value, not re-enable as if the write had not happened.
    await waitFor(async () => {
      const settings = await harness?.json<{ settings: { llm: { baseUrl?: string } } }>('/api/settings')
      expect(settings?.settings.llm.baseUrl).toBe('http://host.docker.internal:11434/v1')
    })
    await waitFor(() => expect(saveEndpoint().disabled).toBe(true))
    expect((endpoint as HTMLInputElement).value).toBe('http://host.docker.internal:11434/v1/')
  })

  it('clears the endpoint key when the endpoint moves host, says so, and never sends it there', async () => {
    await serve({ cli: SIGNED_IN, containerized: true })
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    await user.click(within(systemPanel()).getByRole('radio', { name: /OpenAI-compatible endpoint/ }))
    const endpoint = await screen.findByLabelText('Endpoint URL')
    fireEvent.change(endpoint, { target: { value: 'https://openrouter.ai/api/v1' } })
    await user.click(within(systemPanel()).getByRole('button', { name: 'Save endpoint' }))
    await waitFor(async () => {
      expect(await harness?.store.settings.get('llm.baseUrl')).toBe('https://openrouter.ai/api/v1')
    })
    fireEvent.change(screen.getByLabelText('API key (optional)'), { target: { value: 'sk-or-v1-HOSTAKEYHOSTAKEY' } })
    await user.click(within(systemPanel()).getByRole('button', { name: 'Save endpoint key' }))
    await waitFor(async () => {
      expect(await harness?.store.settings.get('llm.endpointKey')).toBe('sk-or-v1-HOSTAKEYHOSTAKEY')
    })

    // A path edit on the same host is the same address: the key stays, silently.
    fireEvent.change(endpoint, { target: { value: 'https://openrouter.ai/api/v1/' } })
    fireEvent.change(endpoint, { target: { value: 'https://openrouter.ai/v2' } })
    await user.click(within(systemPanel()).getByRole('button', { name: 'Save endpoint' }))
    await waitFor(async () => {
      expect(await harness?.store.settings.get('llm.baseUrl')).toBe('https://openrouter.ai/v2')
    })
    expect(await harness?.store.settings.get('llm.endpointKey')).toBe('sk-or-v1-HOSTAKEYHOSTAKEY')
    expect(within(systemPanel()).queryByText(/stored key was cleared/)).toBeNull()

    fireEvent.change(endpoint, { target: { value: 'https://api.groq.com/openai/v1' } })
    await user.click(within(systemPanel()).getByRole('button', { name: 'Save endpoint' }))

    await within(systemPanel()).findByText(/stored key was cleared because the endpoint.s host changed/)
    expect(await harness?.store.settings.get('llm.endpointKey')).toBeNull()

    await harness?.call('/api/settings', put({ llmModel: 'llama3.2' }))
    harness?.llm.reply({ proposals: [] })
    await harness?.call('/api/kits', body({ groupId: null }))
    const suggested = await harness?.call('/api/assistant/suggest', body({ capability: 'derive' }))
    expect(suggested?.status).toBe(200)
    const sent = harness?.llm.configs.at(-1)
    expect(sent?.baseUrl).toBe('https://api.groq.com/openai/v1')
    expect(sent?.apiKey).toBeUndefined()
    expect(harness?.llm.configs.some((entry) => entry.apiKey === 'sk-or-v1-HOSTAKEYHOSTAKEY')).toBe(false)
  })

  it('stores the endpoint field\'s key as the endpoint key, never as the Anthropic key', async () => {
    await serve({ cli: SIGNED_IN, containerized: true })
    const user = userEvent.setup()
    await reachTheWorkbench(user)

    await user.click(within(systemPanel()).getByRole('radio', { name: /OpenAI-compatible endpoint/ }))
    const keyField = await screen.findByLabelText('API key (optional)')
    fireEvent.change(keyField, { target: { value: 'sk-or-v1-PANELWIREDENDPOINTKEY' } })
    await user.click(within(systemPanel()).getByRole('button', { name: 'Save endpoint key' }))

    // The credential lands in the endpoint's own slot: the Anthropic key stays
    // empty, so switching connections can never send one key to the other's
    // endpoint -- which is the property this field exists to keep.
    await waitFor(async () => {
      expect(await harness?.store.settings.get('llm.endpointKey')).toBe('sk-or-v1-PANELWIREDENDPOINTKEY')
    })
    expect(await harness?.store.settings.get('llm.apiKey')).toBeNull()
    const settings = await harness?.json<{
      settings: { llm: { endpointKeyConfigured: boolean; source: string } }
    }>('/api/settings')
    expect(settings?.settings.llm.endpointKeyConfigured).toBe(true)
    expect(settings?.settings.llm.source).toBe('none')
  })
})

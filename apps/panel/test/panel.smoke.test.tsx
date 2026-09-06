/**
 * The panel smoke test: the whole thin slice, in one walk.
 *
 * Pair, import a capture set, generate a kit, see the preview drawn from its
 * tokens, download `design.md`. The server is faked at `fetch`, but the tokens
 * it answers with are the real committed `examples/ghost-warm/tokens.json`, so
 * the preview is rendering genuine engine output rather than a fixture invented
 * to make it pass.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import type { TokensDocument } from '@ingot/engine'

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
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'examples/ghost-warm/tokens.json'), 'utf8')) as TokensDocument
const DESIGN_MD = readFileSync(join(ROOT, 'examples/ghost-warm/design.md'), 'utf8')
const CAPTURE_SET = JSON.parse(readFileSync(join(ROOT, 'fixtures/ghost-warm/set.json'), 'utf8')) as {
  captures: Array<{ id: string; componentType: string; sourceUrl: string; capturedAt: string }>
}

const TOKEN = 'a-valid-pairing-token'
const GROUP = { id: 'group-1', slug: 'ghost-warm', name: 'Ghost warm', description: 'Warm.', origin: 'import', captureCount: CAPTURE_SET.captures.length }

interface FakeServer {
  calls: Array<{ path: string; method: string; token: string | null }>
  imported: boolean
  kitGenerated: boolean
}

/**
 * A fake server that behaves like the real one on the points the panel depends
 * on: it refuses without the pairing token, and it has no kit until one is
 * generated.
 */
function installFakeServer(): FakeServer {
  const state: FakeServer = { calls: [], imported: false, kitGenerated: false }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = init.method ?? 'GET'
    const token = new Headers(init.headers).get('x-ingot-token')
    state.calls.push({ path, method, token })

    if (path === '/api/pairing/verify') {
      const body = JSON.parse(String(init.body)) as { token: string }
      return body.token === TOKEN ? json({ paired: true }) : json({ error: { message: 'no' } }, 401)
    }
    // Everything else is guarded, exactly as the server guards it.
    if (token !== TOKEN) return json({ error: { message: 'not paired' } }, 401)

    if (path === '/api/settings' && method === 'GET') {
      return json({
        settings: {
          llm: { configured: false, source: 'none', managedByEnvironment: false },
          engine: { name: 'ingot-engine', version: '0.2.0' },
          storage: { adapter: 'sqlite', schemaVersion: 1 },
          allowedOrigins: ['http://localhost:5173'],
        },
      })
    }
    if (path === '/api/groups') return json({ groups: state.imported ? [GROUP] : [] })
    if (path === '/api/captures/import') {
      state.imported = true
      return json({ group: GROUP, created: CAPTURE_SET.captures.map((c) => c.id), replaced: [] }, 201)
    }
    if (path.startsWith('/api/captures')) {
      return json({
        captures: state.imported
          ? CAPTURE_SET.captures.map((capture) => ({ ...capture, tags: [], hasScreenshot: false }))
          : [],
      })
    }
    if (path.startsWith('/api/kits/latest')) {
      return state.kitGenerated ? json(kitPayload()) : json({ error: { message: 'none yet' } }, 404)
    }
    if (path === '/api/kits' && method === 'POST') {
      state.kitGenerated = true
      return json(kitPayload(), 201)
    }
    if (path.endsWith('/design.md')) {
      return new Response(DESIGN_MD, {
        headers: { 'content-type': 'text/markdown', 'content-disposition': 'attachment; filename="ghost-warm-v1-design.md"' },
      })
    }
    return json({ error: { message: `unexpected ${method} ${path}` } }, 404)
  })

  return state
}

function kitPayload(): unknown {
  return {
    kit: {
      id: 'kit-1',
      groupId: GROUP.id,
      version: 1,
      setId: 'ghost-warm',
      name: GROUP.name,
      engineVersion: '0.2.0',
      captureIds: CAPTURE_SET.captures.map((capture) => capture.id),
      warningCount: 0,
      createdAt: '2026-05-01T00:00:00.000Z',
    },
    tokens: TOKENS,
  }
}

let server: FakeServer

beforeEach(() => {
  server = installFakeServer()
})

describe('the panel, end to end', () => {
  it('pairs, imports a set, generates a kit, previews it and downloads design.md', async () => {
    const user = userEvent.setup()
    render(<App />)

    // 1. First run: unpaired, so the panel asks to be paired rather than
    //    showing an empty workbench.
    const tokenField = await screen.findByLabelText('Pairing token')
    await user.type(tokenField, TOKEN)
    await user.click(screen.getByRole('button', { name: 'Pair' }))

    // 2. The LLM key step is skippable, because nothing here calls an LLM yet.
    await user.click(await screen.findByRole('button', { name: /Continue without a key/ }))

    // 3. The workbench, with an empty collection.
    await screen.findByRole('heading', { name: 'Collection' })
    expect(screen.getByText(/Nothing captured yet/)).toBeTruthy()

    // 4. Import the capture set by pasting it.
    await user.click(screen.getByRole('button', { name: /Paste a capture set/ }))
    // Set the textarea directly: typing a 20KB document keystroke by keystroke
    // would take minutes and prove nothing extra.
    fireEvent.change(screen.getByLabelText('Capture set JSON'), {
      target: { value: JSON.stringify(CAPTURE_SET) },
    })
    await user.click(screen.getByRole('button', { name: 'Import set' }))

    await waitFor(() => expect(screen.getByText('ghost-btn-primary')).toBeTruthy())

    // 5. Generate the kit.
    await user.click(screen.getByRole('button', { name: /Generate kit/ }))

    // 6. The preview renders the canonical components from the kit's tokens...
    const preview = await screen.findByLabelText('Live preview')
    const publish = await within(preview).findByRole('button', { name: 'Publish kit' })
    expect(publish.dataset['variant']).toBe('primary')

    // ...through CSS variables carrying real token values, not hardcoded ones.
    const surface = preview.querySelector<HTMLElement>('.kit-surface')
    expect(surface?.style.getPropertyValue('--kit-color-primary')).toBe(TOKENS.color.roles.primary?.value.hex)
    expect(surface?.style.getPropertyValue('--kit-space-unit')).toBe(`${TOKENS.spacing.baseUnit}px`)

    // 7. The system panel reports the kit the preview is showing.
    const system = screen.getByRole('complementary', { name: 'System' })
    expect(within(system).getByText('ghost-warm')).toBeTruthy()
    expect(within(system).getByText('v1')).toBeTruthy()
    expect(within(system).getByText(TOKENS.color.roles.primary?.value.hex ?? '')).toBeTruthy()

    // 8. And design.md downloads, with the pairing token on the request.
    await user.click(within(system).getByRole('button', { name: 'design.md' }))
    await waitFor(() => {
      const download = server.calls.find((call) => call.path.endsWith('/design.md'))
      expect(download?.token).toBe(TOKEN)
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

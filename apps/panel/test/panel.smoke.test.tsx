/**
 * The panel, end to end: pair, import, generate, review, override, export.
 *
 * The server is faked at `fetch`, but the tokens it answers with are the real
 * committed `examples/ghost-warm/tokens.json` and the override it applies goes
 * through the real engine, so the preview is rendering genuine engine output
 * and the override flow is exercising the real `applyOverrides`. The only thing
 * stubbed is the transport.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyOverrides, overrideRejection, readTokenValue, renderDesignMarkdown } from '@ingot/engine'
import type { TokenOverride, TokensDocument } from '@ingot/engine'
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
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'examples/ghost-warm/tokens.json'), 'utf8')) as TokensDocument
const DESIGN_MD = readFileSync(join(ROOT, 'examples/ghost-warm/design.md'), 'utf8')
const CAPTURE_SET = JSON.parse(readFileSync(join(ROOT, 'fixtures/ghost-warm/set.json'), 'utf8')) as {
  captures: Array<{ id: string; componentType: string; sourceUrl: string; capturedAt: string }>
}

const TOKEN = 'a-valid-pairing-token'
const GROUP = {
  id: 'group-1',
  slug: 'ghost-warm',
  name: 'Ghost warm',
  description: 'Warm.',
  origin: 'import',
  captureCount: CAPTURE_SET.captures.length,
}

interface FakeServer {
  calls: Array<{ path: string; method: string; token: string | null }>
  imported: boolean
  kitGenerated: boolean
  /** Overrides the fake server holds, exactly as the real one would. */
  overrides: TokenOverride[]
  accepted: string[]
}

/**
 * A fake server that behaves like the real one on the points the panel depends
 * on: it refuses without the pairing token, it has no kit until one is
 * generated, and it replays overrides through the engine rather than pretending
 * they took effect.
 */
function installFakeServer(): FakeServer {
  const state: FakeServer = { calls: [], imported: false, kitGenerated: false, overrides: [], accepted: [] }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  function effective(): { tokens: TokensDocument; designMd: string; conflicts: unknown[]; rejected: unknown[] } {
    if (state.overrides.length === 0) {
      return { tokens: TOKENS, designMd: DESIGN_MD, conflicts: [], rejected: [] }
    }
    const result = applyOverrides(TOKENS, state.overrides)
    return {
      tokens: result.tokens,
      designMd: renderDesignMarkdown(result.tokens),
      conflicts: result.conflicts,
      rejected: result.rejected,
    }
  }

  function kitPayload(): unknown {
    const { tokens, designMd, conflicts, rejected } = effective()
    return {
      kit: {
        id: 'kit-1',
        groupId: GROUP.id,
        scope: 'group',
        version: 1,
        setId: 'ghost-warm',
        name: GROUP.name,
        engineVersion: TOKENS.engine.version,
        captureIds: CAPTURE_SET.captures.map((capture) => capture.id),
        warningCount: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      tokens,
      designMd,
      review: {
        overrides: state.overrides.map((override) => ({
          path: override.path,
          value: override.value,
          baseValue: override.baseValue ?? '',
          note: override.note ?? '',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        })),
        conflicts,
        rejected,
        accepted: state.accepted,
      },
    }
  }

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
          engine: { name: 'ingot-engine', version: TOKENS.engine.version },
          storage: { adapter: 'sqlite', schemaVersion: 2 },
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
    if (path.startsWith('/api/reviews/overrides') && method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { path: string; value: string; note?: string }
      // The real route judges the candidate *before* storing anything, and it
      // asks the question the same way: against the effective document with
      // this path's own override left out, and as an edit rather than a
      // creation when the reviewer already owns the path. The fake calls the
      // same engine entry point on the same baseline rather than approximating
      // it, so the panel is never tested against a server that is either more
      // permissive or more restrictive than the one it ships against.
      const others = state.overrides.filter((entry) => entry.path !== body.path)
      const baseline = others.length === 0 ? TOKENS : applyOverrides(TOKENS, others).tokens
      const editing = state.overrides.some((entry) => entry.path === body.path)
      const rejection = overrideRejection(
        baseline,
        { path: body.path, value: body.value },
        editing ? 'edit' : 'create',
      )
      if (rejection !== undefined) return json({ error: { message: rejection } }, 422)
      // `baseValue` is the other question, and it still comes from the pristine
      // kit: it is what a later regeneration is compared against.
      const baseValue = readTokenValue(TOKENS, body.path)
      state.overrides = [
        ...state.overrides.filter((entry) => entry.path !== body.path),
        {
          path: body.path,
          value: body.value,
          ...(baseValue === null ? {} : { baseValue }),
          ...(body.note === undefined ? {} : { note: body.note }),
        },
      ]
      return json(kitPayload())
    }
    if (path.startsWith('/api/reviews/overrides') && method === 'DELETE') {
      const target = new URL(url, 'http://localhost').searchParams.get('path')
      if (!state.overrides.some((entry) => entry.path === target)) {
        return json({ error: { message: `no override at ${target}` } }, 404)
      }
      state.overrides = state.overrides.filter((entry) => entry.path !== target)
      return json(kitPayload())
    }
    if (path.startsWith('/api/reviews/decisions') && method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { cardId: string; state: 'accepted' | 'open' }
      state.accepted =
        body.state === 'accepted'
          ? [...new Set([...state.accepted, body.cardId])]
          : state.accepted.filter((id) => id !== body.cardId)
      return json(kitPayload())
    }
    if (path.endsWith('/design.md')) {
      return new Response(effective().designMd, {
        headers: {
          'content-type': 'text/markdown',
          'content-disposition': 'attachment; filename="ghost-warm-v1-design.md"',
        },
      })
    }
    if (path.includes('/components/')) {
      return new Response('# Button', {
        headers: { 'content-type': 'text/markdown', 'content-disposition': 'attachment; filename="button.md"' },
      })
    }
    return json({ error: { message: `unexpected ${method} ${path}` } }, 404)
  })

  return state
}

let server: FakeServer

beforeEach(() => {
  server = installFakeServer()
})

/** Pair, import and generate: the state every review test starts from. */
async function reachTheWorkbench(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.type(await screen.findByLabelText('Pairing token'), TOKEN)
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
    const design = await (await fetch('/api/kits/kit-1/design.md', { headers: { 'x-ingot-token': TOKEN } })).text()
    expect(design).toContain('## 10. User overrides')
    expect(design).toContain('the captured radius reads timid')
  })

  it('reports a conflict as a card and lets the reviewer take the new evidence', async () => {
    const user = userEvent.setup()
    await reachTheWorkbench(user)
    const system = screen.getByRole('complementary', { name: 'System' })
    const engineRadius = `${TOKENS.radius.steps.md?.value}px`

    // A standing override whose recorded engine answer no longer matches: the
    // shape a regeneration produces when the captures have moved.
    server.overrides.push({ path: 'radius.steps.md', value: '10px', baseValue: '4px' })
    await user.click(within(system).getByRole('button', { name: /Regenerate/ }))

    const card = await within(system).findByText(/Your value and the new evidence disagree/)
    expect(card).toBeTruthy()
    expect(within(system).getByText(/the captures now say/)).toBeTruthy()

    // Taking what the engine now says clears the override rather than storing
    // it as a new one -- an override that agrees with the engine is not an
    // override, and the server refuses one.
    await user.click(within(system).getByRole('button', { name: `Revert to the engine (${engineRadius})` }))
    await waitFor(() => {
      const surface = screen.getByLabelText('Live preview').querySelector<HTMLElement>('.kit-surface')
      expect(surface?.style.getPropertyValue('--kit-radius-md')).toBe(engineRadius)
    })
    // The decision is gone from the store, so the conflict cannot come back.
    expect(server.overrides).toEqual([])
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
    await waitFor(() => expect(server.overrides[0]?.value).toBe('10px'))

    // Re-open the editor and change only the reason. The value is unchanged, so
    // an early return on "the value did not move" would drop the justification
    // on the floor while the editor closed as though it had saved.
    await user.click(within(system).getByTitle('Override radius.steps.md'))
    fireEvent.change(within(system).getByLabelText('Reason for overriding radius.steps.md'), {
      target: { value: 'the captured radius reads timid' },
    })
    await user.click(within(system).getByRole('button', { name: 'Override' }))

    await waitFor(() => expect(server.overrides[0]?.note).toBe('the captured radius reads timid'))
    // ...and it reaches the document the reviewer hands to a consumer.
    const design = await (await fetch('/api/kits/kit-1/design.md', { headers: { 'x-ingot-token': TOKEN } })).text()
    expect(design).toContain('the captured radius reads timid')
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

    await waitFor(() => expect(server.accepted.length).toBe(1))
    expect(within(system).getAllByText('accepted').length).toBeGreaterThan(0)
  })
})

/**
 * Kits: generate, list, retrieve, download.
 *
 * Generation runs the engine server-side and stores what it produced. Kits are
 * versioned rather than overwritten, so tuning a group and regenerating leaves
 * the previous kit intact -- the panel's future override and comparison views
 * need a kit to compare against.
 *
 * The download routes serve the stored strings byte for byte. They are the path
 * the acceptance test walks: a `design.md` downloaded here must equal the one
 * `pnpm skeleton` writes from the same captures.
 */
import { Hono } from 'hono'
import { COMPONENT_DOC_IDS, renderComponentMarkdown } from '@ingot/engine'
import type { ComponentDocId } from '@ingot/engine'
import { ApiError } from '../errors'
import { KitGenerationError, effectiveKit, generateKit } from '../kit'
import type { EffectiveKit } from '../kit'
import { kitPayload, scopeFrom } from './reviews'
import type { AppContext, AppEnv } from '../context'
import type { Kit } from '../storage/store'
import { isRecord, readJsonBody } from '../validate'

/** `?groupId=` absent or `library` means the whole-library scope. */
function scopeFromQuery(value: string | undefined): string | null {
  return scopeFrom(value)
}

/** Component ids are a closed list; anything else is a 404, not a render. */
function componentIdFrom(raw: string): ComponentDocId {
  const id = raw.endsWith('.md') ? raw.slice(0, -'.md'.length) : raw
  if (!(COMPONENT_DOC_IDS as readonly string[]).includes(id)) {
    throw ApiError.notFound(
      `no component doc named ${id}; this kit documents ${COMPONENT_DOC_IDS.join(', ')}`,
    )
  }
  return id as ComponentDocId
}

/** A filename a user can find later: the set id and the kit version. */
function attachment(kit: Kit, file: 'tokens.json' | 'design.md'): string {
  const base = file === 'tokens.json' ? 'tokens' : 'design'
  const extension = file === 'tokens.json' ? 'json' : 'md'
  return `attachment; filename="${kit.setId}-v${kit.version}-${base}.${extension}"`
}

function componentAttachment(kit: Kit, id: ComponentDocId): string {
  return `attachment; filename="${kit.setId}-v${kit.version}-${id}.md"`
}

async function runGeneration(context: AppContext, groupId: string | null): Promise<Kit> {
  try {
    const { kit } = await generateKit(context.store, groupId)
    return kit
  } catch (error) {
    if (error instanceof KitGenerationError) throw new ApiError(error.status, 'kit_generation', error.message)
    throw error
  }
}

export function kitRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store } = context

  app.post('/', async (c) => {
    const body = c.req.header('content-type')?.includes('application/json') ? await readJsonBody(c.req.raw) : {}
    const raw = isRecord(body) ? body['groupId'] : undefined
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      throw ApiError.badRequest('groupId must be a string, null, or omitted')
    }
    const kit = await runGeneration(context, scopeFromQuery(raw ?? undefined))
    // The new version inherits the scope's standing overrides, so the panel
    // gets back what it will actually render -- conflicts included.
    return c.json(kitPayload(await effectiveKit(store, kit)), 201)
  })

  app.get('/', async (c) => {
    const scope = c.req.query('groupId')
    const kits =
      scope === undefined ? await store.kits.list() : await store.kits.list({ groupId: scopeFromQuery(scope) })
    return c.json({ kits })
  })

  // Before `/:id`, so `latest` is never read as a kit id.
  app.get('/latest', async (c) => {
    const kit = await store.kits.latest(scopeFromQuery(c.req.query('groupId')))
    if (!kit) throw ApiError.notFound('no kit has been generated for that scope yet')
    return c.json(kitPayload(await effectiveKit(store, kit)))
  })

  app.get('/:id', async (c) => {
    return c.json(kitPayload(await load(c.req.param('id'))))
  })

  app.get('/:id/tokens.json', async (c) => {
    const effective = await load(c.req.param('id'))
    return c.body(effective.tokensJson, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment(effective.kit, 'tokens.json'),
    })
  })

  app.get('/:id/design.md', async (c) => {
    const effective = await load(c.req.param('id'))
    return c.body(effective.designMd, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': attachment(effective.kit, 'design.md'),
    })
  })

  // One component, on its own. Rendered on demand from the effective tokens
  // rather than stored, because it is a pure function of them and storing nine
  // more strings per kit would be nine more things to keep in step.
  app.get('/:id/components/:component', async (c) => {
    const effective = await load(c.req.param('id'))
    const id = componentIdFrom(c.req.param('component'))
    return c.body(renderComponentMarkdown(effective.tokens, id), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': componentAttachment(effective.kit, id),
    })
  })

  /** A stored kit with its scope's review state replayed over it. */
  async function load(id: string): Promise<EffectiveKit> {
    const kit = await store.kits.get(id)
    if (!kit) throw ApiError.notFound(`no kit with id ${id}`)
    return effectiveKit(store, kit)
  }

  return app
}

/**
 * The export routes: the latest kit for a scope, as a file.
 *
 * Separate from `/api/kits/:id/...` because a user downloading their library's
 * `design.md` should not have to know a kit id. They are reads: generating is
 * always an explicit `POST /api/kits`, so a download can never silently produce
 * a different kit than the one on screen.
 */
export function exportRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store } = context

  async function latestOrFail(c: { req: { query: (key: string) => string | undefined } }): Promise<EffectiveKit> {
    const kit = await store.kits.latest(scopeFromQuery(c.req.query('groupId')))
    if (!kit) {
      throw new ApiError(409, 'no_kit', 'generate a kit before exporting it')
    }
    return effectiveKit(store, kit)
  }

  app.get('/tokens.json', async (c) => {
    const effective = await latestOrFail(c)
    return c.body(effective.tokensJson, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment(effective.kit, 'tokens.json'),
    })
  })

  app.get('/design.md', async (c) => {
    const effective = await latestOrFail(c)
    return c.body(effective.designMd, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': attachment(effective.kit, 'design.md'),
    })
  })

  app.get('/components/:component', async (c) => {
    const effective = await latestOrFail(c)
    const id = componentIdFrom(c.req.param('component'))
    return c.body(renderComponentMarkdown(effective.tokens, id), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': componentAttachment(effective.kit, id),
    })
  })

  return app
}

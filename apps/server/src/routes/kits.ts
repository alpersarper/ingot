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
import { ApiError } from '../errors'
import { KitGenerationError, generateKit } from '../kit'
import type { AppContext, AppEnv } from '../context'
import type { Kit, KitSummary } from '../storage/store'
import { isRecord, readJsonBody } from '../validate'

/** `?groupId=` absent or `library` means the whole-library scope. */
function scopeFromQuery(value: string | undefined): string | null {
  return value === undefined || value === '' || value === 'library' ? null : value
}

function summarise(kit: Kit): KitSummary {
  const { tokensJson: _tokens, designMd: _design, ...summary } = kit
  return summary
}

/** A filename a user can find later: the set id and the kit version. */
function attachment(kit: Kit, file: 'tokens.json' | 'design.md'): string {
  const base = file === 'tokens.json' ? 'tokens' : 'design'
  const extension = file === 'tokens.json' ? 'json' : 'md'
  return `attachment; filename="${kit.setId}-v${kit.version}-${base}.${extension}"`
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
    return c.json({ kit: summarise(kit), tokens: JSON.parse(kit.tokensJson) as unknown }, 201)
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
    return c.json({ kit: summarise(kit), tokens: JSON.parse(kit.tokensJson) as unknown, designMd: kit.designMd })
  })

  app.get('/:id', async (c) => {
    const kit = await store.kits.get(c.req.param('id'))
    if (!kit) throw ApiError.notFound(`no kit with id ${c.req.param('id')}`)
    return c.json({ kit: summarise(kit), tokens: JSON.parse(kit.tokensJson) as unknown, designMd: kit.designMd })
  })

  app.get('/:id/tokens.json', async (c) => {
    const kit = await store.kits.get(c.req.param('id'))
    if (!kit) throw ApiError.notFound(`no kit with id ${c.req.param('id')}`)
    return c.body(kit.tokensJson, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment(kit, 'tokens.json'),
    })
  })

  app.get('/:id/design.md', async (c) => {
    const kit = await store.kits.get(c.req.param('id'))
    if (!kit) throw ApiError.notFound(`no kit with id ${c.req.param('id')}`)
    return c.body(kit.designMd, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': attachment(kit, 'design.md'),
    })
  })

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

  async function latestOrFail(c: { req: { query: (key: string) => string | undefined } }): Promise<Kit> {
    const kit = await store.kits.latest(scopeFromQuery(c.req.query('groupId')))
    if (!kit) {
      throw new ApiError(409, 'no_kit', 'generate a kit before exporting it')
    }
    return kit
  }

  app.get('/tokens.json', async (c) => {
    const kit = await latestOrFail(c)
    return c.body(kit.tokensJson, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment(kit, 'tokens.json'),
    })
  })

  app.get('/design.md', async (c) => {
    const kit = await latestOrFail(c)
    return c.body(kit.designMd, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': attachment(kit, 'design.md'),
    })
  })

  return app
}

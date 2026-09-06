/**
 * Groups: the named collections a kit is generated from, and the membership
 * that fixes the order captures reach the engine in.
 */
import { Hono } from 'hono'
import { ApiError } from '../errors'
import type { AppContext, AppEnv } from '../context'
import { optionalString, readJsonBody, requireSlug, requireString, requireStringArray } from '../validate'

export function groupRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store } = context

  app.get('/', async (c) => c.json({ groups: await store.groups.list() }))

  app.post('/', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const slug = requireSlug(body, 'slug')
    if ((await store.groups.getBySlug(slug)) !== null) {
      throw ApiError.conflict(`a group with slug ${JSON.stringify(slug)} already exists`)
    }
    const group = await store.groups.create({
      slug,
      name: requireString(body, 'name'),
      // The engine requires a non-empty description, so supply a stated one
      // rather than letting an empty group fail at distillation time.
      description: optionalString(body, 'description') ?? `Captures grouped as ${slug}.`,
      origin: 'manual',
    })
    return c.json({ group }, 201)
  })

  app.get('/:id', async (c) => {
    const group = await store.groups.get(c.req.param('id'))
    if (!group) throw ApiError.notFound(`no group with id ${c.req.param('id')}`)
    return c.json({ group })
  })

  app.patch('/:id', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const name = optionalString(body, 'name')
    const description = optionalString(body, 'description')
    const group = await store.groups.update(c.req.param('id'), {
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
    })
    if (!group) throw ApiError.notFound(`no group with id ${c.req.param('id')}`)
    return c.json({ group })
  })

  app.delete('/:id', async (c) => {
    const removed = await store.groups.delete(c.req.param('id'))
    if (!removed) throw ApiError.notFound(`no group with id ${c.req.param('id')}`)
    return c.body(null, 204)
  })

  app.post('/:id/captures', async (c) => {
    const groupId = c.req.param('id')
    if ((await store.groups.get(groupId)) === null) throw ApiError.notFound(`no group with id ${groupId}`)

    const captureIds = requireStringArray(await readJsonBody(c.req.raw), 'captureIds')
    const missing: string[] = []
    for (const captureId of captureIds) {
      if ((await store.captures.get(captureId)) === null) missing.push(captureId)
    }
    if (missing.length > 0) throw ApiError.unprocessable('unknown capture ids', missing)

    const added = await store.groups.addCaptures(groupId, captureIds)
    const group = await store.groups.get(groupId)
    return c.json({ group, added })
  })

  app.delete('/:id/captures/:captureId', async (c) => {
    const removed = await store.groups.removeCapture(c.req.param('id'), c.req.param('captureId'))
    if (!removed) throw ApiError.notFound('that capture is not in that group')
    return c.body(null, 204)
  })

  return app
}

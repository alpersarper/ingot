/**
 * Captures: CRUD, bulk import, tags, and the screenshot the record points at.
 *
 * The import endpoint accepts a fixture set verbatim -- `fixtures/<set>/set.json`
 * is a valid body -- which is how the panel gets from nothing to a distillable
 * library before the browser extension exists.
 */
import { Hono } from 'hono'
import { CaptureValidationError, validateCaptureRecord, validateCaptureSet } from '@ingot/engine'
import type { CaptureRecord } from '@ingot/engine'
import { ApiError } from '../errors'
import { contentTypeForPath, isSupportedImageType, supportedImageTypes } from '../screenshots'
import type { AppContext, AppEnv } from '../context'
import type { Capture, CaptureQuery } from '../storage/store'
import { isRecord, optionalString, optionalStringArray, readJsonBody, requireStringArray } from '../validate'

/** Wire shape. The record is passed through untouched; everything else is ours. */
function serialise(capture: Capture): Record<string, unknown> {
  return {
    id: capture.id,
    record: capture.record,
    componentType: capture.record.componentType,
    sourceUrl: capture.record.sourceUrl,
    capturedAt: capture.record.capturedAt,
    screenshotPath: capture.screenshotPath,
    hasScreenshot: capture.screenshotPath !== null,
    tags: capture.tags,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt,
  }
}

/** Turn the engine's validation failure into a 422 that names every issue. */
function asApiError(error: unknown, what: string): never {
  if (error instanceof CaptureValidationError) {
    throw ApiError.unprocessable(`${what} does not satisfy the capture schema`, error.issues)
  }
  throw error
}

export function captureRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store, screenshots } = context

  app.get('/', async (c) => {
    const query: CaptureQuery = {}
    const groupId = c.req.query('groupId')
    const componentType = c.req.query('componentType')
    const tag = c.req.query('tag')
    if (groupId !== undefined) query.groupId = groupId
    if (componentType !== undefined) query.componentType = componentType
    if (tag !== undefined) query.tag = tag
    const captures = await store.captures.list(query)
    return c.json({ captures: captures.map(serialise) })
  })

  // Registered before `/:id` so a capture can never be named "tags".
  app.get('/tags', async (c) => c.json({ tags: await store.captures.tags() }))

  /**
   * Bulk import. Accepts either a bare capture set or `{ set: <capture set> }`,
   * so a user can paste a fixture file straight in.
   *
   * The set's own id, name and description become the group's, which is what
   * makes a kit generated from the group identical to the one `pnpm skeleton`
   * writes for the same file.
   */
  app.post('/import', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const candidate = isRecord(body['set']) ? body['set'] : body

    let set
    try {
      set = validateCaptureSet(candidate)
    } catch (error) {
      asApiError(error, 'the imported set')
    }

    const result = await store.importCaptureSet({
      slug: set.id,
      name: set.name,
      description: set.description,
      records: set.captures,
    })
    return c.json(
      {
        group: result.group,
        created: result.created,
        replaced: result.replaced,
        captureCount: set.captures.length,
      },
      201,
    )
  })

  app.post('/', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const candidate = 'record' in body ? body['record'] : body

    let record: CaptureRecord
    try {
      record = validateCaptureRecord(candidate, 'record')
    } catch (error) {
      asApiError(error, 'the capture')
    }

    const tags = optionalStringArray(body, 'tags')
    const groupId = optionalString(body, 'groupId')
    if (groupId !== undefined && (await store.groups.get(groupId)) === null) {
      throw ApiError.notFound(`no group with id ${groupId}`)
    }

    const capture = await store.captures.upsert({ record, ...(tags === undefined ? {} : { tags }) })
    if (groupId !== undefined) await store.groups.addCaptures(groupId, [capture.id])
    return c.json({ capture: serialise(capture) }, 201)
  })

  app.get('/:id', async (c) => {
    const capture = await store.captures.get(c.req.param('id'))
    if (!capture) throw ApiError.notFound(`no capture with id ${c.req.param('id')}`)
    return c.json({ capture: serialise(capture) })
  })

  app.patch('/:id', async (c) => {
    const id = c.req.param('id')
    const body = await readJsonBody(c.req.raw)
    const patch: { record?: CaptureRecord; tags?: string[] } = {}

    if ('record' in body) {
      try {
        patch.record = validateCaptureRecord(body['record'], 'record')
      } catch (error) {
        asApiError(error, 'the capture')
      }
      if (patch.record.id !== id) {
        throw ApiError.badRequest(`record.id ${JSON.stringify(patch.record.id)} does not match ${JSON.stringify(id)}`)
      }
    }
    const tags = optionalStringArray(body, 'tags')
    if (tags !== undefined) patch.tags = tags

    const capture = await store.captures.update(id, patch)
    if (!capture) throw ApiError.notFound(`no capture with id ${id}`)
    return c.json({ capture: serialise(capture) })
  })

  app.put('/:id/tags', async (c) => {
    const id = c.req.param('id')
    const body = await readJsonBody(c.req.raw)
    const capture = await store.captures.update(id, { tags: requireStringArray(body, 'tags') })
    if (!capture) throw ApiError.notFound(`no capture with id ${id}`)
    return c.json({ capture: serialise(capture) })
  })

  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    const existing = await store.captures.get(id)
    if (!existing) throw ApiError.notFound(`no capture with id ${id}`)
    if (existing.screenshotPath !== null) await screenshots.remove(existing.screenshotPath)
    await store.captures.delete(id)
    return c.body(null, 204)
  })

  /**
   * Store a screenshot for a capture. Raw image bytes, content type in the
   * header -- the shape the extension will post from a canvas blob. The bytes
   * land on the volume and only the path reaches the database.
   */
  app.put('/:id/screenshot', async (c) => {
    const id = c.req.param('id')
    if ((await store.captures.get(id)) === null) throw ApiError.notFound(`no capture with id ${id}`)

    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim() ?? ''
    if (!isSupportedImageType(contentType)) {
      throw ApiError.badRequest(`content-type must be one of ${supportedImageTypes().join(', ')}`)
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength === 0) throw ApiError.badRequest('screenshot body is empty')

    const path = await screenshots.put(id, contentType, bytes)
    const capture = await store.captures.update(id, { screenshotPath: path })
    if (!capture) throw ApiError.notFound(`no capture with id ${id}`)
    return c.json({ capture: serialise(capture) })
  })

  app.get('/:id/screenshot', async (c) => {
    const id = c.req.param('id')
    const capture = await store.captures.get(id)
    if (!capture) throw ApiError.notFound(`no capture with id ${id}`)
    if (capture.screenshotPath === null) throw ApiError.notFound(`capture ${id} has no screenshot`)
    const bytes = await screenshots.read(capture.screenshotPath)
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      'Content-Type': contentTypeForPath(capture.screenshotPath),
      'Cache-Control': 'no-store',
    })
  })

  return app
}

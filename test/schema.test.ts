/**
 * Schema conformance.
 *
 * `schemas/*.schema.json` is the normative contract for anything outside this
 * repo -- the extension writing captures, the panel reading tokens. The engine
 * has its own hand-written validator for good error messages, so these two
 * descriptions of the same shape can drift. Validating real fixtures and real
 * outputs against the published schemas is what stops that.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import type { ErrorObject } from 'ajv'
import { describe, expect, it } from 'vitest'
import { distill } from '@ingot/engine'
import { fixtureSetIds } from '../scripts/skeleton'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const setIds = await fixtureSetIds()

const ajv = new Ajv({ allErrors: true, strict: false })

async function schema(name: string): Promise<object> {
  return JSON.parse(await readFile(join(ROOT, 'schemas', name), 'utf8')) as object
}

function explain(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('\n')
}

const captureSchema = ajv.compile(await schema('capture-record.schema.json'))
const tokensSchema = ajv.compile(await schema('tokens.schema.json'))

describe('capture-record.schema.json', () => {
  it.each(setIds)('validates fixtures/%s/set.json', async (setId) => {
    const raw = JSON.parse(await readFile(join(ROOT, 'fixtures', setId, 'set.json'), 'utf8')) as unknown
    expect(captureSchema(raw), explain(captureSchema.errors)).toBe(true)
  })

  it('rejects a capture with an unknown style property', () => {
    const raw = {
      schemaVersion: 1,
      id: 'demo',
      name: 'Demo',
      description: 'Demo.',
      captures: [
        {
          schemaVersion: 1,
          id: 'x',
          componentType: 'button',
          sourceUrl: 'https://example.com/',
          capturedAt: '2026-01-01T00:00:00.000Z',
          styles: { zIndex: '10' },
        },
      ],
    }
    expect(captureSchema(raw)).toBe(false)
  })

  it('rejects a non-px length, since computed styles always resolve to px', () => {
    const raw = {
      schemaVersion: 1,
      id: 'demo',
      name: 'Demo',
      description: 'Demo.',
      captures: [
        {
          schemaVersion: 1,
          id: 'x',
          componentType: 'button',
          sourceUrl: 'https://example.com/',
          capturedAt: '2026-01-01T00:00:00.000Z',
          styles: { fontSize: '0.875rem' },
        },
      ],
    }
    expect(captureSchema(raw)).toBe(false)
  })
})

describe('tokens.schema.json', () => {
  it.each(setIds)('validates the tokens document distilled from %s', async (setId) => {
    const raw = JSON.parse(await readFile(join(ROOT, 'fixtures', setId, 'set.json'), 'utf8')) as unknown
    const tokens = JSON.parse(JSON.stringify(distill(raw))) as unknown
    expect(tokensSchema(tokens), explain(tokensSchema.errors)).toBe(true)
  })

  it.each(setIds)('validates the committed examples/%s/tokens.json', async (setId) => {
    const raw = JSON.parse(await readFile(join(ROOT, 'examples', setId, 'tokens.json'), 'utf8')) as unknown
    expect(tokensSchema(raw), explain(tokensSchema.errors)).toBe(true)
  })
})

describe('provenance completeness', () => {
  it.each(setIds)('%s: every token carries provenance with a decision', async (setId) => {
    const raw = JSON.parse(await readFile(join(ROOT, 'examples', setId, 'tokens.json'), 'utf8')) as unknown

    const problems: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      if (typeof node !== 'object' || node === null) return
      const record = node as Record<string, unknown>

      // Any object with a `value` is a token, and every token must explain itself.
      if ('value' in record) {
        const provenance = record['provenance'] as Record<string, unknown> | undefined
        if (!provenance) problems.push(`${path}: token has no provenance`)
        else {
          const decision = provenance['decision'] as Record<string, unknown> | undefined
          if (!decision) problems.push(`${path}: provenance has no decision`)
          else {
            if (typeof decision['strategy'] !== 'string') problems.push(`${path}: decision has no strategy`)
            if (typeof decision['summary'] !== 'string') problems.push(`${path}: decision has no summary`)
            if (!Array.isArray(decision['competitors'])) problems.push(`${path}: decision has no competitors list`)
            const computed = decision['strategy'] === 'derived' || decision['strategy'] === 'sanctioned-default'
            if (computed && !decision['derivation']) {
              problems.push(`${path}: computed decision has no derivation record`)
            }
            // A value the engine supplied outright must not look like evidence.
            if (decision['strategy'] === 'sanctioned-default' && (provenance['captureIds'] as unknown[])?.length > 0) {
              problems.push(`${path}: sanctioned default claims contributing captures`)
            }
            if (!computed && !Array.isArray(provenance['observed'])) {
              problems.push(`${path}: observed decision lists no observed values`)
            }
          }
          if (!Array.isArray(provenance['captureIds'])) problems.push(`${path}: provenance has no captureIds`)
        }
        return
      }

      for (const [key, child] of Object.entries(record)) walk(child, `${path}.${key}`)
    }

    walk(raw, setId)
    expect(problems).toEqual([])
  })

  it.each(setIds)('%s: every observed capture id refers to a real capture', async (setId) => {
    const tokens = JSON.parse(await readFile(join(ROOT, 'examples', setId, 'tokens.json'), 'utf8')) as {
      source: { captureIds: string[] }
    }
    const known = new Set(tokens.source.captureIds)
    const referenced = [...JSON.stringify(tokens).matchAll(/"captureIds":\s*\[([^\]]*)\]/g)]
      .flatMap((match) => (match[1] as string).split(','))
      .map((part) => part.trim().replace(/^"|"$/g, ''))
      .filter((id) => id.length > 0)

    expect(referenced.length).toBeGreaterThan(0)
    expect([...new Set(referenced)].filter((id) => !known.has(id))).toEqual([])
  })
})

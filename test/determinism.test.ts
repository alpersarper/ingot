/**
 * The determinism guarantee.
 *
 * "Identical input produces byte-identical output" is the property the whole
 * product depends on: without it, a regenerated kit is a diff, provenance
 * cannot be trusted, and no export can be reviewed. It is checked from three
 * angles -- repeated runs, reordered input, and drift against the committed
 * examples.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { distill, renderDesignMarkdown, serializeTokens } from '@ingot/engine'
import type { CaptureSet } from '@ingot/engine'
import { fixtureSetIds, renderSet } from '../scripts/skeleton'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

async function loadSet(setId: string): Promise<CaptureSet> {
  return JSON.parse(await readFile(join(ROOT, 'fixtures', setId, 'set.json'), 'utf8')) as CaptureSet
}

const setIds = await fixtureSetIds()

describe('determinism', () => {
  it('finds the fixture sets', () => {
    expect(setIds).toEqual(['ghost-warm', 'linear-dark', 'messy-mixed', 'stripe-light'])
  })

  describe.each(setIds)('%s', (setId) => {
    it('produces byte-identical output on a second run', async () => {
      const input = await loadSet(setId)
      const first = distill(structuredClone(input))
      const second = distill(structuredClone(input))
      expect(serializeTokens(second)).toBe(serializeTokens(first))
      expect(renderDesignMarkdown(second)).toBe(renderDesignMarkdown(first))
    })

    it('does not depend on the order captures appear in', async () => {
      const input = await loadSet(setId)
      const shuffled: CaptureSet = { ...input, captures: [...input.captures].reverse() }
      expect(serializeTokens(distill(shuffled))).toBe(serializeTokens(distill(input)))
    })

    it('carries no timestamp that would make regeneration a diff', async () => {
      const json = serializeTokens(distill(await loadSet(setId)))
      // Capture timestamps are input, not output: none of them may leak through.
      expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(json).not.toMatch(/generatedAt|timestamp/i)
    })

    it('matches the committed examples byte for byte', async () => {
      for (const output of await renderSet(setId)) {
        expect(await readFile(output.path, 'utf8'), `${output.path} is stale; run pnpm skeleton`).toBe(
          output.contents,
        )
      }
    })
  })
})

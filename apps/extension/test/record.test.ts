/**
 * The record the extension emits, against the normative schema.
 *
 * `schemas/capture-record.schema.json` is the contract for everything outside
 * this repo, and the extension is the first thing outside it. So the test is
 * not "does the extractor return plausible strings" but "would the published
 * schema, and the engine's own validator, take what this extension produces" --
 * from the values a real browser reports, through every normalisation, to a
 * whole set the distiller would accept.
 */
import { readFile } from 'node:fs/promises'
import { Ajv } from 'ajv'
import type { ErrorObject } from 'ajv'
import { describe, expect, it } from 'vitest'
import { validateCaptureRecord, validateCaptureSet } from '@ingot/engine'
import type { CaptureRecord } from '@ingot/engine'
import { captureIdFor } from '../src/shared/identity'
import { extractStyles } from '../src/shared/styles'
import type { StyleReader } from '../src/shared/styles'
import type { Rect } from '../src/shared/protocol'

const ajv = new Ajv({ allErrors: true, strict: false })
const schemaPath = new URL('../../../schemas/capture-record.schema.json', import.meta.url)
const validateSet = ajv.compile(JSON.parse(await readFile(schemaPath, 'utf8')) as object)

function explain(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('\n')
}

function reader(values: Record<string, string>): StyleReader {
  return (property) => values[property] ?? ''
}

/**
 * A pill-shaped, variable-font button as Chrome reports it: the percentage
 * radius, the 450 weight, the `"normal"` gap and the phantom border colour all
 * in one element.
 */
const PILL_BUTTON: Record<string, string> = {
  color: 'rgb(255, 255, 255)',
  backgroundColor: 'rgb(28, 30, 38)',
  fontFamily: 'Inter, sans-serif',
  fontSize: '14px',
  fontWeight: '450',
  lineHeight: '20px',
  letterSpacing: 'normal',
  paddingTop: '10px',
  paddingRight: '20px',
  paddingBottom: '10px',
  paddingLeft: '20px',
  marginTop: '0px',
  marginRight: '0px',
  marginBottom: '0px',
  marginLeft: '0px',
  gap: 'normal',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  borderTopStyle: 'none',
  borderRightStyle: 'none',
  borderBottomStyle: 'none',
  borderLeftStyle: 'none',
  borderTopColor: 'rgb(255, 255, 255)',
  borderTopLeftRadius: '50%',
  borderTopRightRadius: '50%',
  borderBottomRightRadius: '50%',
  borderBottomLeftRadius: '50%',
  boxShadow: 'none',
}

const BOX: Rect = { x: 240, y: 118, width: 132, height: 40 }

function recordFrom(values: Record<string, string>, url: string, path: string): CaptureRecord {
  return {
    schemaVersion: 1,
    id: captureIdFor(url, path),
    componentType: 'button',
    sourceUrl: url,
    capturedAt: new Date('2026-02-11T09:14:22.000Z').toISOString(),
    screenshot: null,
    styles: extractStyles(reader(values), BOX),
  }
}

describe('the record the extension emits', () => {
  const record = recordFrom(PILL_BUTTON, 'https://linear.app/method', 'html/body/main/div:2/button')

  it('satisfies the engine\'s own validator', () => {
    expect(() => validateCaptureRecord(record)).not.toThrow()
  })

  it('satisfies the published JSON Schema as part of a set', () => {
    const set = {
      schemaVersion: 1,
      id: 'extension-capture',
      name: 'Captured with the extension',
      description: 'One button picked from a real page.',
      captures: [record],
    }
    expect(validateSet(set), explain(validateSet.errors)).toBe(true)
    expect(() => validateCaptureSet(set)).not.toThrow()
  })

  it('reports the pill the page actually draws', () => {
    expect(record.styles.borderTopLeftRadius).toBe('9999px')
  })

  it('reports a weight the schema accepts', () => {
    expect(record.styles.fontWeight).toBe('500')
  })

  it('leaves out the gap and the border colour the element does not have', () => {
    expect(record.styles.gap).toBeUndefined()
    expect(record.styles.borderColor).toBeUndefined()
  })

  it('stamps capturedAt in the form the schema requires', () => {
    expect(record.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('keeps the screenshot field null, because the engine never reads pixels', () => {
    // The image goes to the panel's own screenshot endpoint and its path lives
    // beside the record, never inside it -- a non-null value here fails
    // validation, which is the schema saying the same thing.
    expect(record.screenshot).toBeNull()
  })

  it('makes a set of captures from two pages, with ids the schema accepts', () => {
    const second = recordFrom(PILL_BUTTON, 'https://linear.app/pricing', 'html/body/main/div:2/button')
    const set = {
      schemaVersion: 1,
      id: 'extension-capture',
      name: 'Captured with the extension',
      description: 'The same control, captured from two pages.',
      captures: [record, second],
    }
    expect(validateSet(set), explain(validateSet.errors)).toBe(true)
    expect(() => validateCaptureSet(set)).not.toThrow()
  })
})

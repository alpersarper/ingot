/**
 * Boundary validation.
 *
 * The engine trusts its own types, so everything untrusted has to be caught
 * here. Each test asserts on the message, because a validation error whose text
 * does not name the offending field is not much use to whoever wrote the file.
 */
import { describe, expect, it } from 'vitest'
import { CaptureValidationError, validateCaptureRecord, validateCaptureSet } from '../src/index'

const record = {
  schemaVersion: 1,
  id: 'demo-button',
  componentType: 'button',
  sourceUrl: 'https://example.com/pricing',
  capturedAt: '2026-01-01T00:00:00.000Z',
  screenshot: null,
  styles: { backgroundColor: '#635bff', color: '#ffffff' },
}

const set = { schemaVersion: 1, id: 'demo', name: 'Demo', description: 'A demo set.', captures: [record] }

function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof CaptureValidationError) return [...error.issues]
    throw error
  }
  throw new Error('expected validation to fail')
}

describe('validateCaptureRecord', () => {
  it('accepts a well-formed record', () => {
    expect(validateCaptureRecord(record).id).toBe('demo-button')
  })

  it('rejects an unsupported schema version', () => {
    expect(issuesOf(() => validateCaptureRecord({ ...record, schemaVersion: 2 }))).toContain(
      'record.schemaVersion: expected 1, received 2',
    )
  })

  it('rejects an unknown component type', () => {
    expect(issuesOf(() => validateCaptureRecord({ ...record, componentType: 'modal' })).join()).toContain(
      'componentType',
    )
  })

  it('rejects a relative source URL', () => {
    expect(issuesOf(() => validateCaptureRecord({ ...record, sourceUrl: '/pricing' })).join()).toContain('sourceUrl')
  })

  it('rejects a non-UTC timestamp', () => {
    expect(issuesOf(() => validateCaptureRecord({ ...record, capturedAt: '2026-01-01 00:00' })).join()).toContain(
      'capturedAt',
    )
  })

  it('rejects a style property the engine does not know', () => {
    const issues = issuesOf(() => validateCaptureRecord({ ...record, styles: { ...record.styles, zIndex: '10' } }))
    expect(issues.join()).toContain('styles.zIndex: unknown style property')
  })

  it('rejects a non-string style value, which is how a typo in a generator shows up', () => {
    expect(issuesOf(() => validateCaptureRecord({ ...record, styles: { fontSize: 14 } })).join()).toContain(
      'styles.fontSize: expected a string',
    )
  })

  it('rejects a non-null screenshot, which is reserved', () => {
    expect(issuesOf(() => validateCaptureRecord({ ...record, screenshot: 'shot.png' })).join()).toContain('screenshot')
  })

  it('reports every problem at once rather than stopping at the first', () => {
    expect(issuesOf(() => validateCaptureRecord({ ...record, id: 'Not A Slug', componentType: 'modal' })).length).toBe(2)
  })
})

describe('validateCaptureSet', () => {
  it('accepts a well-formed set', () => {
    expect(validateCaptureSet(set).captures).toHaveLength(1)
  })

  it('rejects duplicate capture ids, because provenance addresses captures by id', () => {
    expect(issuesOf(() => validateCaptureSet({ ...set, captures: [record, record] })).join()).toContain(
      'duplicate capture id',
    )
  })

  it('rejects an empty set', () => {
    expect(issuesOf(() => validateCaptureSet({ ...set, captures: [] })).join()).toContain('non-empty array')
  })

  it('rejects a set with no name', () => {
    expect(issuesOf(() => validateCaptureSet({ ...set, name: '' })).join()).toContain('set.name')
  })

  it('names the offending capture by index', () => {
    expect(issuesOf(() => validateCaptureSet({ ...set, captures: [{ ...record, id: 'BAD' }] })).join()).toContain(
      'set.captures[0].id',
    )
  })
})

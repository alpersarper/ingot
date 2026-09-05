/**
 * Runtime validation for untrusted capture input.
 *
 * The engine is a pure function over data it did not produce, so it validates
 * shape at the boundary and then trusts its own types. This mirrors
 * `schemas/capture-record.schema.json`, which is the normative schema; the test
 * suite validates every fixture against both to keep them honest.
 */
import { CAPTURE_SCHEMA_VERSION, COMPONENT_TYPES } from './types'
import type { CaptureRecord, CaptureSet, CapturedStyles, ComponentType } from './types'

/** Thrown when input does not satisfy the capture schema. */
export class CaptureValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`invalid capture input:\n  - ${issues.join('\n  - ')}`)
    this.name = 'CaptureValidationError'
    this.issues = issues
  }
}

const STYLE_KEYS: ReadonlySet<string> = new Set<keyof CapturedStyles>([
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'gap',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'borderColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'boxShadow',
])

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkRecord(value: unknown, at: string, issues: string[]): CaptureRecord | undefined {
  if (!isRecord(value)) {
    issues.push(`${at}: expected an object`)
    return undefined
  }

  if (value['schemaVersion'] !== CAPTURE_SCHEMA_VERSION) {
    issues.push(
      `${at}.schemaVersion: expected ${CAPTURE_SCHEMA_VERSION}, received ${JSON.stringify(value['schemaVersion'])}`,
    )
  }
  if (typeof value['id'] !== 'string' || !SLUG.test(value['id'])) {
    issues.push(`${at}.id: expected a lowercase slug, received ${JSON.stringify(value['id'])}`)
  }
  if (!COMPONENT_TYPES.includes(value['componentType'] as ComponentType)) {
    issues.push(
      `${at}.componentType: expected one of ${COMPONENT_TYPES.join(' | ')}, received ${JSON.stringify(value['componentType'])}`,
    )
  }
  if (typeof value['sourceUrl'] !== 'string' || !/^https?:\/\/\S+$/.test(value['sourceUrl'])) {
    issues.push(`${at}.sourceUrl: expected an absolute http(s) URL, received ${JSON.stringify(value['sourceUrl'])}`)
  }
  if (typeof value['capturedAt'] !== 'string' || !ISO_INSTANT.test(value['capturedAt'])) {
    issues.push(`${at}.capturedAt: expected an ISO 8601 UTC instant, received ${JSON.stringify(value['capturedAt'])}`)
  }
  if ('screenshot' in value && value['screenshot'] !== null) {
    issues.push(`${at}.screenshot: reserved for future use, must be null when present`)
  }
  if ('notes' in value && typeof value['notes'] !== 'string') {
    issues.push(`${at}.notes: expected a string`)
  }

  const styles = value['styles']
  if (!isRecord(styles)) {
    issues.push(`${at}.styles: expected an object`)
  } else {
    for (const [key, styleValue] of Object.entries(styles)) {
      if (!STYLE_KEYS.has(key)) {
        issues.push(`${at}.styles.${key}: unknown style property`)
      } else if (typeof styleValue !== 'string') {
        issues.push(`${at}.styles.${key}: expected a string, received ${JSON.stringify(styleValue)}`)
      }
    }
  }

  return issues.length === 0 ? (value as unknown as CaptureRecord) : undefined
}

/** Validate one capture record, throwing {@link CaptureValidationError} on failure. */
export function validateCaptureRecord(value: unknown, at = 'record'): CaptureRecord {
  const issues: string[] = []
  const record = checkRecord(value, at, issues)
  if (!record) throw new CaptureValidationError(issues)
  return record
}

/**
 * Validate a whole capture set. Also enforces the set-level invariant the
 * single-record check cannot see: capture ids must be unique, because
 * provenance addresses captures by id.
 */
export function validateCaptureSet(value: unknown): CaptureSet {
  const issues: string[] = []

  if (!isRecord(value)) throw new CaptureValidationError(['set: expected an object'])

  if (value['schemaVersion'] !== CAPTURE_SCHEMA_VERSION) {
    issues.push(
      `set.schemaVersion: expected ${CAPTURE_SCHEMA_VERSION}, received ${JSON.stringify(value['schemaVersion'])}`,
    )
  }
  if (typeof value['id'] !== 'string' || !SLUG.test(value['id'])) {
    issues.push(`set.id: expected a lowercase slug, received ${JSON.stringify(value['id'])}`)
  }
  for (const key of ['name', 'description'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') {
      issues.push(`set.${key}: expected a non-empty string`)
    }
  }

  const captures = value['captures']
  if (!Array.isArray(captures) || captures.length === 0) {
    issues.push('set.captures: expected a non-empty array')
    throw new CaptureValidationError(issues)
  }

  const seen = new Set<string>()
  captures.forEach((capture, index) => {
    const record = checkRecord(capture, `set.captures[${index}]`, issues)
    if (!record) return
    if (seen.has(record.id)) {
      issues.push(`set.captures[${index}].id: duplicate capture id ${JSON.stringify(record.id)}`)
    }
    seen.add(record.id)
  })

  if (issues.length > 0) throw new CaptureValidationError(issues)
  return value as unknown as CaptureSet
}

/**
 * Request-body checks.
 *
 * Hand-written rather than schema-driven, for the same reason the engine's
 * capture validator is: the shapes are small, the messages are better, and the
 * dependency list stays short. Capture records themselves are *not* checked
 * here -- `validateCaptureSet` in the engine is the normative check, and having
 * two would be having two that disagree.
 */
import { ApiError } from './errors'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    throw ApiError.badRequest('request body must be JSON')
  }
  if (!isRecord(parsed)) throw ApiError.badRequest('request body must be a JSON object')
  return parsed
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw ApiError.badRequest(`${key} must be a non-empty string`)
  }
  return value
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  if (!(key in body) || body[key] === undefined) return undefined
  const value = body[key]
  if (typeof value !== 'string') throw ApiError.badRequest(`${key} must be a string`)
  return value
}

export function optionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  if (!(key in body) || body[key] === undefined) return undefined
  const value = body[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw ApiError.badRequest(`${key} must be an array of strings`)
  }
  return value as string[]
}

export function requireStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = optionalStringArray(body, key)
  if (value === undefined) throw ApiError.badRequest(`${key} must be an array of strings`)
  return value
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Group slugs are held to the engine's set-id rule, because a slug becomes
 * `tokens.source.setId`. Rejecting it here beats letting `distill` reject it
 * after the group already exists.
 */
export function requireSlug(body: Record<string, unknown>, key: string): string {
  const value = requireString(body, key)
  if (!SLUG.test(value)) {
    throw ApiError.badRequest(`${key} must be a lowercase slug, e.g. "ghost-warm"`)
  }
  return value
}

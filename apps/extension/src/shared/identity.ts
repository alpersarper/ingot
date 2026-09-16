/**
 * Capture ids: stable across recaptures, and opaque about the page.
 *
 * `docs/capture-record.md` makes one hard demand of an id: re-capturing the
 * same element must produce the same id, so provenance updates a contribution
 * instead of growing a second one. That rules out a counter and it rules out
 * anything derived from the clock.
 *
 * So the id is derived: a readable host label, plus a hash of where the element
 * sits. The hash input is a structural path (tag names and sibling positions)
 * and the page's path -- never text, never attributes, never markup. That is
 * deliberate on both counts: it is what makes the id reproducible, and it is
 * what keeps this side of the "reference-grade, never reproduction-grade" line
 * in DECISIONS.md. Nothing about the page's content survives the hash, and the
 * hash is all that travels.
 *
 * The component type is *not* in the input. A reviewer changing the guess in
 * the confirm popover must not mint a second capture of one element.
 */

/** Lowercase slug, the shape `^[a-z0-9]+(?:-[a-z0-9]+)*$` the engine demands. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'page' : slug
}

/**
 * FNV-1a, 32 bits, rendered base36 and padded to a fixed width.
 *
 * A non-cryptographic hash is the right tool: the job is a short stable label,
 * not a secret. Collisions inside one site's captures are the only ones that
 * matter and 32 bits is ample for a library a person curates by hand.
 */
export function fingerprint(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    // FNV prime, 32-bit, via the shift-and-add form that stays in int32.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

/** The site label that prefixes an id, e.g. `https://stripe.com/x` -> `stripe-com`. */
export function hostLabel(sourceUrl: string): string {
  let host: string
  try {
    host = new URL(sourceUrl).hostname
  } catch {
    return 'page'
  }
  return slugify(host.replace(/^www\./, ''))
}

/**
 * The id for an element at `path` on `sourceUrl`.
 *
 * `path` is the structural signature from `describe.ts`; the page's own
 * pathname joins it so the same component captured from two pages of one site
 * stays two captures, which is what the engine's provenance wants to show.
 */
export function captureIdFor(sourceUrl: string, path: string): string {
  let pathname = ''
  try {
    pathname = new URL(sourceUrl).pathname
  } catch {
    pathname = ''
  }
  return `${hostLabel(sourceUrl)}-${fingerprint(`${pathname}|${path}`)}`
}

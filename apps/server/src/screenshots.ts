/**
 * Screenshot storage: files on the data volume, paths in the database.
 *
 * Images are the one thing that must not go into SQLite. Side-by-side
 * comparison wants full-quality captures, a library grows to hundreds of them,
 * and a database that carries them is a database nobody can back up or move.
 * So the volume holds the bytes and a row holds a relative path.
 *
 * The path is derived from the capture id and never from anything a caller
 * sent, which is what makes traversal impossible rather than merely filtered.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Content types a screenshot may be stored as, and the extension each gets. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export type ScreenshotContentType = keyof typeof EXTENSIONS

export function isSupportedImageType(contentType: string): contentType is ScreenshotContentType {
  return contentType in EXTENSIONS
}

export function supportedImageTypes(): string[] {
  return Object.keys(EXTENSIONS)
}

/** Content type for a stored relative path, for serving it back. */
export function contentTypeForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1)
  for (const [type, candidate] of Object.entries(EXTENSIONS)) {
    if (candidate === extension) return type
  }
  return 'application/octet-stream'
}

export interface ScreenshotStore {
  /** Writes the image and returns its path relative to the screenshot root. */
  put(captureId: string, contentType: ScreenshotContentType, bytes: Uint8Array): Promise<string>
  /**
   * The bytes, or `null` when the row points at a file the volume no longer
   * holds.
   *
   * Null rather than a thrown `ENOENT`, because a missing file is a thing that
   * happens -- a volume restored from a database backup, a file removed by
   * hand -- and it is not this server's bug. It became worth answering
   * properly the day the panel started rendering screenshots: before that
   * nothing but a manual request ever read one, and now every capture in the
   * library asks. A 500 with a stack trace for a file somebody deleted is the
   * server going quiet about a thing it knows exactly.
   */
  read(relativePath: string): Promise<Uint8Array | null>
  remove(relativePath: string): Promise<void>
}

export function createScreenshotStore(root: string): ScreenshotStore {
  /**
   * Resolve a stored relative path back to a file, refusing anything that is
   * not the shape this store writes. A path only ever enters the database from
   * `put`, so a value that fails this check means the row was tampered with.
   */
  function resolveWithin(relativePath: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpg|webp)$/.test(relativePath)) {
      throw new Error(`refusing to read screenshot path ${JSON.stringify(relativePath)}`)
    }
    return join(root, relativePath)
  }

  return {
    async put(captureId, contentType, bytes) {
      const relativePath = `${captureId}.${EXTENSIONS[contentType]}`
      const absolute = resolveWithin(relativePath)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, bytes)
      return relativePath
    },
    async read(relativePath) {
      try {
        return await readFile(resolveWithin(relativePath))
      } catch (error) {
        // Only a missing file is an answer; anything else -- a permission
        // problem, a broken volume -- is still a fault worth raising.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async remove(relativePath) {
      await rm(resolveWithin(relativePath), { force: true })
    },
  }
}

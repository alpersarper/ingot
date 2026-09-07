/**
 * Serving the built panel.
 *
 * The container exposes one port, so the API and the panel come from the same
 * origin. That is worth more than tidiness: same-origin means the panel's
 * requests carry no CORS burden, and it means there is exactly one address to
 * configure -- the one the future extension will be pointed at.
 *
 * The panel is a single-page app, so any path that is not a real file falls
 * back to `index.html` and lets the client router take it. `/api` never reaches
 * here: this router is mounted last and the API has already answered.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { Hono } from 'hono'
import type { AppEnv } from './context'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** Resolve a URL path inside the panel directory, or `null` if it escapes it. */
function resolveInside(root: string, pathname: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(pathname)
    } catch {
      return null
    }
  })()
  if (decoded === null || decoded.includes('\0')) return null
  const candidate = resolve(root, `.${normalize(decoded)}`)
  return candidate === root || candidate.startsWith(root + sep) ? candidate : null
}

export function panelRoutes(panelDir: string): Hono<AppEnv> {
  const root = resolve(panelDir)
  const app = new Hono<AppEnv>()

  app.get('/*', async (c) => {
    const pathname = new URL(c.req.url).pathname
    const candidate = resolveInside(root, pathname)

    if (candidate !== null && pathname !== '/') {
      const found = await stat(candidate).catch(() => null)
      if (found?.isFile()) {
        const extension = extname(candidate)
        // Vite fingerprints everything under /assets, so those are immutable;
        // everything else has to be revalidated or a rebuilt panel never lands.
        const cacheControl = pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache'
        return c.body(new Uint8Array(await readFile(candidate)) as unknown as ArrayBuffer, 200, {
          'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
          'Cache-Control': cacheControl,
        })
      }
    }

    const index = await readFile(join(root, 'index.html'), 'utf8').catch(() => null)
    if (index === null) {
      return c.text(
        'The panel has not been built. Run `pnpm --filter @ingot/panel build`, or use `pnpm dev` for the Vite dev server.',
        503,
      )
    }
    return c.html(index, 200, { 'Cache-Control': 'no-cache' })
  })

  return app
}

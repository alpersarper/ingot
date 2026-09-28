/**
 * One line per request, and nothing that could carry a secret.
 *
 * This server used to log nothing at all about its traffic, and the cost of
 * that turned up in a real diagnosis: a panel that had been answering an
 * extension's captures with 401 for days had eight lines in `docker logs`, all
 * of them the startup banner. "Nothing ever reached the server" and "everything
 * that reached it was rejected" are opposite problems with opposite fixes, and
 * from outside they looked identical. A request log is what tells them apart.
 *
 * The reason there was no log is a good one, though, and it is the constraint
 * this file is built around: **this process holds secrets, and a request log is
 * exactly where they leak.** The usual accident is an access log that prints
 * the whole URL, on the day somebody adds `?token=` to a route. So:
 *
 *  - **Headers and bodies are never touched.** The pairing token travels in
 *    `x-ingot-token` and the LLM keys travel in bodies, so not reading them is
 *    a stronger guarantee than redacting them would be.
 *  - **Query *names* are logged; query *values* never are.** `?groupId&tag` is
 *    the useful part -- which filter was in play -- and the value is the user's
 *    content. This also means a future `?token=` cannot leak through here.
 *  - **The finished line still goes through `redact`**, against every secret
 *    the process holds synchronously. Belt and braces: the rules above should
 *    make it impossible for a secret to be in the line, and this is what
 *    catches the day one of them stops being true.
 *
 * It is deliberately not a general-purpose access log. No user agent, no IP, no
 * referer, no bytes -- this is a local workbench, and the only questions it has
 * to answer are "did the request arrive" and "what did we answer".
 */
import { redact } from './assistant/redact'
import type { MiddlewareHandler } from 'hono'

export interface RequestLogOptions {
  /**
   * Every secret this process holds, read at log time.
   *
   * A function rather than a list because the stored keys change while the
   * process runs, and a logger holding yesterday's would let today's through.
   */
  secrets: () => readonly (string | undefined)[]
  /** Where a line goes. Injected so the suite can read what was written. */
  write: (line: string) => void
  /** Injected so a test can assert a duration without waiting for one. */
  now?: () => number
}

/**
 * The path, with query parameter *names* only.
 *
 * `/api/captures?groupId=g1&tag=hero` becomes `/api/captures?groupId&tag`.
 * Sorted, so two requests that differ only in parameter order read as the same
 * shape -- which is what makes these lines groupable by eye.
 */
export function loggablePath(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return '(unparseable url)'
  }
  const names = [...new Set([...url.searchParams.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return names.length === 0 ? url.pathname : `${url.pathname}?${names.join('&')}`
}

export function requestLog(options: RequestLogOptions): MiddlewareHandler {
  const clock = options.now ?? (() => Date.now())
  return async (c, next) => {
    const started = clock()
    await next()
    const line = `[ingot] ${c.req.method} ${loggablePath(c.req.url)} ${c.res.status} ${clock() - started}ms`
    options.write(redact(line, options.secrets()))
  }
}

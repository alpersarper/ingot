/**
 * Starting the library over.
 *
 * This is the one operation in the product that destroys a kit. Everywhere else
 * kit history is append-only: regenerating adds a version, and deleting a group
 * orphans its kits rather than removing them, precisely so that a decision a
 * user made can always be traced to the document it was made against. Reset is
 * the deliberate exception -- somebody who has finished experimenting needs a
 * way to be rid of the experiment -- and it is written to be impossible to
 * reach by accident:
 *
 *   - it requires the pairing token like every other write;
 *   - it requires the body to repeat the word the panel made the user type,
 *     so a stray POST from a script that knows the token still does nothing;
 *   - it answers with a count of exactly what it destroyed, which is what the
 *     panel states afterwards. Nothing disappears silently, this least of all.
 *
 * Settings survive: the pairing token and the LLM key are how the user reaches
 * the panel at all, and re-pairing is not part of starting a library over.
 */
import { Hono } from 'hono'
import { ApiError } from '../errors'
import type { AppContext, AppEnv } from '../context'
import { readJsonBody, requireString } from '../validate'

/** The word the panel asks the user to type, and the body has to repeat. */
export const RESET_CONFIRMATION = 'reset'

export function resetRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store, screenshots } = context

  app.post('/', async (c) => {
    const confirm = requireString(await readJsonBody(c.req.raw), 'confirm')
    if (confirm !== RESET_CONFIRMATION) {
      throw ApiError.unprocessable(
        `confirm must be exactly ${JSON.stringify(RESET_CONFIRMATION)}; this destroys every capture, group, kit and review in this library`,
      )
    }

    const summary = await store.resetLibrary()
    // The rows are gone either way; a screenshot that refuses to delete must
    // not turn a completed reset into a 500 the user reads as "nothing
    // happened". The file is orphaned on the volume, which is recoverable;
    // a reset the panel cannot trust is not.
    const { screenshotPaths, ...counts } = summary
    for (const path of screenshotPaths) {
      await screenshots.remove(path).catch(() => undefined)
    }
    return c.json({ reset: { ...counts, screenshots: screenshotPaths.length } })
  })

  return app
}

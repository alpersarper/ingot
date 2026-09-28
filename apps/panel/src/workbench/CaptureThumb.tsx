/**
 * The picture, in the library.
 *
 * Capture in this product is *reference-grade* by decision: a component is its
 * computed values **and a picture of it**, and the two halves are what a
 * reviewer needs in order to say whether a capture belongs in a kit. The
 * extension took that picture, the server stored it on the volume and served
 * it back on request -- and until now the panel rendered none of it. The
 * library listed captures as `ghost-org-03ra16z` in monospace and left the
 * reviewer to remember which button that was. `apps/panel/src` did not contain
 * a single `<img>`; `hasScreenshot` was declared on the wire type and read by
 * nothing. Curating a collection you cannot see is not curation.
 *
 * Two things here are less obvious than they look.
 *
 * **The fetch, rather than a `src`.** Every call to this server carries the
 * pairing token in a header and an `<img src>` cannot send one, so the image
 * is fetched through the same authenticated door as everything else and handed
 * to the browser as an object URL. See `api.captureScreenshot`.
 *
 * **The object URL is revoked.** A library of a few hundred captures scrolled
 * past is a few hundred blobs the page would otherwise hold until reload.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface CaptureThumbProps {
  captureId: string
  /** What the server says it holds. False skips the request entirely. */
  hasScreenshot: boolean
  /** For the alt text, so the thumbnail names the thing it shows. */
  componentType: string
  className?: string
}

export function CaptureThumb({ captureId, hasScreenshot, componentType, className }: CaptureThumbProps): ReactNode {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!hasScreenshot) return undefined
    let objectUrl: string | null = null
    let live = true
    setFailed(false)

    void (async () => {
      try {
        const blob = await api.captureScreenshot(captureId)
        if (!live) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        // A capture whose file is missing is a capture, not a crash: the
        // styles are what the engine reads, and the row still has to render.
        if (live) setFailed(true)
      }
    })()

    return () => {
      live = false
      setUrl(null)
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [captureId, hasScreenshot])

  // A fixed box whether or not there is a picture in it, so a list of captures
  // is a column of rows rather than a ragged edge that reflows as blobs land.
  const frame = cn(
    'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/40',
    className,
  )

  if (!hasScreenshot || failed) {
    return (
      <div
        className={frame}
        title={hasScreenshot ? 'this capture’s screenshot could not be loaded' : 'this capture has no screenshot'}
      >
        <ImageOff className="size-3.5 text-muted-foreground/60" aria-hidden />
      </div>
    )
  }

  return (
    <div className={frame}>
      {url === null ? null : (
        <img src={url} alt={`${componentType} captured as ${captureId}`} className="size-full object-contain" />
      )}
    </div>
  )
}

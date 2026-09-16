/**
 * Cropping the tab screenshot down to the element.
 *
 * `chrome.tabs.captureVisibleTab` gives the whole visible viewport, at device
 * pixels: on a 2x display a 120 CSS-pixel button is 240 pixels wide in that
 * image. The element's rect is in CSS pixels, so the two only line up after a
 * multiply by `devicePixelRatio` -- get that wrong and every capture on a
 * retina screen is the top-left quarter of the component.
 *
 * This runs in the service worker rather than in the page. The image never
 * touches the site's JavaScript context, and the content script never handles
 * pixels of the page it is standing on.
 */
import type { Rect, ScreenshotBlob } from '../shared/protocol'

/** Device-pixel crop box, clamped to the image the browser actually gave us. */
export function cropBox(
  rect: Rect,
  devicePixelRatio: number,
  image: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const scale = devicePixelRatio > 0 ? devicePixelRatio : 1
  const x = Math.max(0, Math.floor(rect.x * scale))
  const y = Math.max(0, Math.floor(rect.y * scale))
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width) * scale))
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height) * scale))
  const width = right - x
  const height = bottom - y
  // An element scrolled off-screen has no pixels in a viewport screenshot.
  // Saying so beats attaching a zero-by-zero PNG.
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

export async function cropDataUrl(dataUrl: string, rect: Rect, devicePixelRatio: number): Promise<ScreenshotBlob> {
  const source = await createImageBitmap(await (await fetch(dataUrl)).blob())
  try {
    const box = cropBox(rect, devicePixelRatio, source)
    if (box === null) throw new Error('the element is outside the visible part of the tab')

    const canvas = new OffscreenCanvas(box.width, box.height)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('could not open a 2d canvas in the service worker')
    context.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return { contentType: 'image/png', dataUrl: await blobToDataUrl(blob), width: box.width, height: box.height }
  } finally {
    source.close()
  }
}

/**
 * Blob to data URL without `FileReader`, which service workers do not have.
 *
 * Chunked because `String.fromCharCode(...bytes)` on a few hundred kilobytes
 * overflows the argument stack -- a bug that only shows up on the large
 * captures, which are exactly the ones worth keeping.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

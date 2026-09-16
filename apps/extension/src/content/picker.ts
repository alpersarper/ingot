/**
 * Pick mode: the overlay, the hover outline, and the confirm popover.
 *
 * Three decisions here are load-bearing on real sites rather than on a test
 * page, so they are worth stating before the code:
 *
 * **The overlay swallows every pointer event.** The obvious build lets events
 * through and reads the element under the cursor directly, and it is wrong
 * twice over. A click would follow the link it landed on, and -- worse and much
 * quieter -- the page would apply `:hover`, so `getComputedStyle` would report
 * the *hover* colours and the kit would be distilled from a state the engine
 * derives for itself. Covering the page keeps the resting state resting. The
 * element under the cursor is then found by turning the overlay's own pointer
 * events off for the length of one `elementFromPoint` call.
 *
 * **Everything lives in a shadow root** under a host pinned to the maximum
 * z-index and re-appended if the page appends something after it. A site's CSS
 * cannot reach in, and the last-child rule wins the z-index tie that the
 * maximum value alone does not.
 *
 * **Frames are refused out loud.** The picker runs only in the top document, so
 * an element inside an iframe is unreachable -- the hover would land on the
 * frame element itself. Capturing that would record the frame's box and none of
 * the component inside it, so the outline turns amber and says why. Frames are
 * out of scope for v1 (the brief); failing silently is not.
 */
import type { ComponentType } from '@ingot/engine'
import { describeElement, structuralPath, styleReaderFor } from './describe'
import { guessComponentType } from '../shared/component-type'
import { captureIdFor } from '../shared/identity'
import { extractStyles } from '../shared/styles'
import { OVERLAY_CSS } from './overlay.css'
import type { PickedElement, Rect, SaveResult, ScreenshotBlob, ShootResult } from '../shared/protocol'

const HOST_TAG = 'ingot-picker-overlay'

/** Elements whose contents are a different document we are not in. */
const FRAME_TAGS = new Set(['iframe', 'frame', 'object', 'embed'])

/**
 * The four types, with the words the popover puts on them.
 *
 * `Record<ComponentType, string>` is the exhaustiveness check: the engine owns
 * the taxonomy, and a fifth type added there fails to compile here until it is
 * given a label. The list is spelled out rather than imported at runtime
 * because this file is injected into other people's pages -- importing a value
 * from the engine pulls its colour maths in with it, and a content script has
 * no business carrying culori.
 */
const TYPE_LABELS: Record<ComponentType, string> = {
  button: 'Button',
  card: 'Card',
  input: 'Input',
  typography: 'Typography',
}

const COMPONENT_TYPES = Object.keys(TYPE_LABELS) as ComponentType[]

export interface PickerHost {
  /** Ask the service worker for a cropped screenshot of this viewport rect. */
  shoot(rect: Rect, devicePixelRatio: number): Promise<ShootResult>
  /** Hand the finished capture to the service worker, which queues it. */
  save(picked: PickedElement, screenshot: ScreenshotBlob | null): Promise<SaveResult>
}

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect()
  return { x: box.left, y: box.top, width: box.width, height: box.height }
}

/** One frame, then one more: enough for a style change to have been painted. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export function createPicker(host: PickerHost): { start(): void; stop(): void; active(): boolean } {
  let root: HTMLElement | null = null
  let shadow: ShadowRoot | null = null
  let halo: HTMLElement
  let chip: HTMLElement
  let hint: HTMLElement
  let sheet: HTMLElement | null = null
  let toast: HTMLElement | null = null

  let hovered: Element | null = null
  let frozen: Element | null = null
  let pointer = { x: 0, y: 0 }
  let running = false

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (className !== undefined) node.className = className
    return node
  }

  function mount(): void {
    root = document.createElement(HOST_TAG)
    shadow = root.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    halo = el('div', 'halo')
    chip = el('div', 'chip')
    hint = el('div', 'hint')
    // Built node by node rather than with `innerHTML`: a page that enforces
    // Trusted Types can make an `innerHTML` assignment throw, and the overlay
    // must not be the thing that breaks on a hardened site.
    const key = (label: string): HTMLElement => {
      const node = el('kbd')
      node.textContent = label
      return node
    }
    hint.append(
      document.createTextNode('Click a component to capture it \u00b7 '),
      key('Esc'),
      document.createTextNode(' to exit \u00b7 hold '),
      key('Alt'),
      document.createTextNode(' for the parent'),
    )
    shadow.append(style, halo, chip, hint)
    halo.style.display = 'none'
    chip.style.display = 'none'
    document.documentElement.append(root)
  }

  /** Keep the overlay the last child, so a late-appended modal cannot cover it. */
  function keepOnTop(): void {
    if (root !== null && root.nextSibling !== null) document.documentElement.append(root)
  }

  function unmount(): void {
    root?.remove()
    root = null
    shadow = null
    sheet = null
    toast = null
  }

  /**
   * The page element under the cursor.
   *
   * The overlay is covering it, so its pointer events come off for exactly as
   * long as the hit test takes. Synchronous, so no frame is ever painted with
   * the page exposed and no `:hover` is recomputed against it.
   */
  function elementUnder(x: number, y: number): Element | null {
    if (root === null) return null
    root.style.pointerEvents = 'none'
    const found = document.elementFromPoint(x, y)
    root.style.pointerEvents = ''
    if (found === null || found === document.documentElement || found === document.body) return null
    return found
  }

  function refusalFor(element: Element): string | null {
    if (FRAME_TAGS.has(element.tagName.toLowerCase())) {
      return 'cannot capture inside frames'
    }
    const box = element.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) return 'this element has no visible box'
    return null
  }

  function paintHighlight(element: Element | null): void {
    if (element === null) {
      halo.style.display = 'none'
      chip.style.display = 'none'
      return
    }
    const box = rectOf(element)
    const refused = refusalFor(element)

    halo.style.display = ''
    halo.style.left = `${box.x - 2}px`
    halo.style.top = `${box.y - 2}px`
    halo.style.width = `${box.width}px`
    halo.style.height = `${box.height}px`
    halo.dataset['refused'] = String(refused !== null)

    const descriptor = describeElement(element)
    chip.style.display = ''
    chip.dataset['refused'] = String(refused !== null)
    chip.textContent = ''
    const label = el('span')
    label.textContent =
      refused === null
        ? `${TYPE_LABELS[guessComponentType(descriptor)]} · ${element.tagName.toLowerCase()}`
        : refused
    const size = el('span', 'dim')
    size.textContent = `${Math.round(box.width)}×${Math.round(box.height)}`
    chip.append(label, size)

    // Above the box when there is room, inside its top edge when there is not.
    const above = box.y > 26
    chip.style.left = `${Math.max(4, Math.min(box.x, window.innerWidth - 160))}px`
    chip.style.top = above ? `${box.y - 24}px` : `${box.y + 4}px`
  }

  function showToast(message: string, tone: 'ok' | 'error'): void {
    toast?.remove()
    toast = el('div', 'toast')
    toast.dataset['tone'] = tone
    toast.textContent = message
    shadow?.append(toast)
    const shown = toast
    window.setTimeout(() => {
      if (toast === shown) {
        shown.remove()
        toast = null
      }
    }, 2600)
  }

  /**
   * Hover, at most once a frame.
   *
   * The work behind one hover is a hit test plus `describeElement`, which reads
   * computed styles for the element's children. A raw `mousemove` handler doing
   * that on a container with hundreds of them is how a picker makes a real page
   * feel broken, and mouse moves arrive faster than frames anyway.
   */
  let queued: { x: number; y: number; alt: boolean } | null = null

  function onMouseMove(event: MouseEvent): void {
    pointer = { x: event.clientX, y: event.clientY }
    if (frozen !== null) return
    const first = queued === null
    queued = { x: event.clientX, y: event.clientY, alt: event.altKey }
    if (!first) return
    requestAnimationFrame(() => {
      const next = queued
      queued = null
      if (next === null || !running || frozen !== null) return
      keepOnTop()
      const found = elementUnder(next.x, next.y)
      hovered = next.alt && found?.parentElement instanceof Element ? found.parentElement : found
      paintHighlight(hovered)
    })
  }

  function reposition(): void {
    if (frozen !== null) return
    const found = elementUnder(pointer.x, pointer.y)
    hovered = found
    paintHighlight(hovered)
  }

  /**
   * Was this click on the confirm popover rather than on the page?
   *
   * It has to be asked before anything else in the click handler. The handler
   * runs on `window` in the capture phase and stops propagation, which is what
   * keeps a click in pick mode from following a link -- and which, without this
   * check, also stops the click before it reaches the popover's own Save
   * button. `composedPath` is what sees through the shadow boundary; the host
   * element alone would not distinguish the popover from the scrim behind it,
   * because a click on empty overlay targets the host itself.
   */
  function onSheet(event: Event): boolean {
    return sheet !== null && event.composedPath().includes(sheet)
  }

  async function onClick(event: MouseEvent): Promise<void> {
    if (onSheet(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (sheet !== null) return
    const target = hovered ?? elementUnder(event.clientX, event.clientY)
    if (target === null) return

    const refused = refusalFor(target)
    if (refused !== null) {
      showToast(refused, 'error')
      return
    }

    frozen = target
    await openSheet(target)
  }

  /**
   * Take the screenshot with the overlay hidden.
   *
   * The outline and the chip are ours; a capture with them burnt into it is a
   * reference picture of the extension rather than of the component.
   */
  async function screenshotOf(element: Element): Promise<ShootResult> {
    if (root === null) return { screenshot: null, error: 'the picker overlay is gone' }
    root.style.visibility = 'hidden'
    await nextPaint()
    try {
      return await host.shoot(rectOf(element), window.devicePixelRatio)
    } finally {
      root.style.visibility = ''
    }
  }

  async function openSheet(element: Element): Promise<void> {
    const descriptor = describeElement(element)
    let chosen = guessComponentType(descriptor)
    const shot = await screenshotOf(element)

    sheet = el('div', 'sheet')
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-label', 'Confirm capture')

    const title = el('h1')
    title.textContent = 'Capture this component'
    const origin = el('p', 'origin')
    origin.textContent = location.href

    const thumb = el('img', 'thumb')
    thumb.alt = ''
    if (shot.screenshot !== null) thumb.src = shot.screenshot.dataUrl

    const types = el('div', 'types')
    const buttons = new Map<ComponentType, HTMLButtonElement>()
    for (const type of COMPONENT_TYPES) {
      const button = el('button')
      button.type = 'button'
      button.textContent = TYPE_LABELS[type]
      button.setAttribute('aria-pressed', String(type === chosen))
      button.addEventListener('click', () => {
        chosen = type
        for (const [candidate, node] of buttons) node.setAttribute('aria-pressed', String(candidate === chosen))
      })
      buttons.set(type, button)
      types.append(button)
    }

    const note = el('p', 'note')
    if (shot.error !== undefined) {
      note.dataset['tone'] = 'warn'
      note.textContent = `No screenshot: ${shot.error}`
    } else {
      note.textContent = 'The guess is a starting point -- set the type you meant.'
    }

    const actions = el('div', 'actions')
    const cancel = el('button', 'cancel')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => closeSheet())
    const save = el('button', 'save')
    save.type = 'button'
    save.textContent = 'Save capture'
    save.addEventListener('click', () => {
      void commit(element, chosen, shot.screenshot, save)
    })
    actions.append(cancel, save)

    sheet.append(title, origin, ...(shot.screenshot !== null ? [thumb] : []), types, note, actions)
    shadow?.append(sheet)
    placeSheet(rectOf(element))
    save.focus()
  }

  function placeSheet(box: Rect): void {
    if (sheet === null) return
    const height = sheet.getBoundingClientRect().height
    const width = sheet.getBoundingClientRect().width
    const below = box.y + box.height + 12
    const top = below + height < window.innerHeight ? below : Math.max(12, box.y - height - 12)
    const left = Math.max(12, Math.min(box.x, window.innerWidth - width - 12))
    sheet.style.top = `${top}px`
    sheet.style.left = `${left}px`
  }

  function closeSheet(): void {
    sheet?.remove()
    sheet = null
    frozen = null
    reposition()
  }

  async function commit(
    element: Element,
    componentType: ComponentType,
    screenshot: ScreenshotBlob | null,
    trigger: HTMLButtonElement,
  ): Promise<void> {
    trigger.disabled = true
    trigger.textContent = 'Saving...'
    const box = rectOf(element)
    const picked: PickedElement = {
      componentType,
      styles: extractStyles(styleReaderFor(element), box),
      sourceUrl: location.href,
      captureId: captureIdFor(location.href, structuralPath(element)),
      rect: box,
      devicePixelRatio: window.devicePixelRatio,
    }
    const result = await host.save(picked, screenshot)
    closeSheet()
    if (result.ok) {
      showToast(result.pending > 0 ? `Captured -- ${result.pending} waiting for the panel` : 'Captured', 'ok')
    } else {
      showToast(result.error ?? 'could not save this capture', 'error')
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    // One Escape backs out of the confirm popover; a second leaves pick mode.
    if (sheet !== null) closeSheet()
    else stop()
  }

  const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions]> = []

  function listen(target: EventTarget, type: string, handler: EventListener, options: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options)
    listeners.push([target, type, handler, options])
  }

  function start(): void {
    if (running) return
    running = true
    mount()
    const capture = { capture: true }
    listen(window, 'mousemove', onMouseMove as EventListener, capture)
    listen(window, 'click', ((event: MouseEvent) => void onClick(event)) as EventListener, capture)
    listen(window, 'keydown', onKeyDown as EventListener, capture)
    listen(window, 'scroll', reposition as EventListener, { capture: true, passive: true })
    listen(window, 'resize', reposition as EventListener, { passive: true })
  }

  function stop(): void {
    if (!running) return
    running = false
    for (const [target, type, handler, options] of listeners.splice(0)) {
      target.removeEventListener(type, handler, options)
    }
    hovered = null
    frozen = null
    unmount()
  }

  return { start, stop, active: () => running }
}

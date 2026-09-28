/**
 * Pick mode: the overlay, the hover outline, and the confirm popover.
 *
 * Several decisions here are load-bearing on real sites rather than on a test
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
 *
 * **The cursor lands on layout, so the boundary is negotiable.** Modern pages
 * are built out of transparent `<div>`s, and `elementFromPoint` has no opinion
 * about which of the nine nested boxes under the cursor is the component. A
 * first real session produced seven captures and five of them were wrappers:
 * transparent, unbordered, padding `0px` or `128px`. So the chip now states the
 * boundary it measured -- background, border, padding -- the arrow keys walk out
 * to the parent and back in to the child, and an element a reader could not see
 * says so and offers the nearest box that paints one. The picker cannot know
 * which element was meant; what it can do is show its evidence and make the
 * correction one keystroke.
 *
 * **The type is chosen, not guessed.** The popover will not save until one of
 * the four is picked. The guess is shown and can be taken with a keystroke, but
 * it is never the default that a hurried person ships: seven captures that all
 * said `card` because nobody disagreed with the guess is a kit distilled from
 * one kind of evidence.
 */
import type { ComponentType } from '@ingot/engine'
import { describeElement, nearestBoundary, recordedBackdropOf, structuralPath, styleReaderFor } from './describe'
import { boundarySummary, wrapperReason } from '../shared/boundary'
import { guessComponentType } from '../shared/component-type'
import { captureIdFor } from '../shared/identity'
import { extractStyles } from '../shared/styles'
import { saveMessage } from '../shared/outcome'
import { emptyTally, tallyLine } from '../shared/tally'
import type { TypeTally } from '../shared/tally'
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

/** The key that takes the picker's suggestion of a better boundary. */
const BOUNDARY_KEY = 'w'

/**
 * How far the pointer may drift before an arrow-key choice is given up.
 *
 * Without it, walking to the parent and then nudging the mouse by one pixel
 * silently throws the choice away -- which makes the feature look broken rather
 * than transient.
 */
const PIN_SLACK_PX = 12

export interface PickerHost {
  /** Ask the service worker for a cropped screenshot of this viewport rect. */
  shoot(rect: Rect, devicePixelRatio: number): Promise<ShootResult>
  /** Hand the finished capture to the service worker, which queues it. */
  save(picked: PickedElement, screenshot: ScreenshotBlob | null): Promise<SaveResult>
  /** How many of each type this browser has captured so far. */
  tally(): Promise<TypeTally>
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
  /** Where the pointer was when the arrow keys last chose an element. */
  let pinnedAt: { x: number; y: number } | null = null
  /** True while the chip is offering a better boundary than the hovered box. */
  let offering = false
  /** Number keys, installed while the confirm popover is open. */
  let sheetKeys: ((key: string) => boolean) | null = null
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
      key('\u2191'),
      key('\u2193'),
      document.createTextNode(' parent/child \u00b7 hold '),
      key('Alt'),
      document.createTextNode(' for the parent \u00b7 '),
      key('Esc'),
      document.createTextNode(' to exit'),
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

  /**
   * Draw the outline and say what was measured.
   *
   * Three lines rather than one, and each is a different kind of claim: what the
   * picker thinks this is, what it measured to think so, and -- when the box is
   * one a reader could not see -- that it is probably not the thing that was
   * meant, with the key that fixes it.
   */
  function paintHighlight(element: Element | null): void {
    offering = false
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

    chip.style.display = ''
    chip.dataset['refused'] = String(refused !== null)
    chip.textContent = ''
    halo.dataset['wrapper'] = 'false'

    if (refused !== null) {
      const line = el('div', 'line')
      line.textContent = refused
      chip.append(line)
    } else {
      const descriptor = describeElement(element)
      const head = el('div', 'line')
      const label = el('span')
      label.textContent = `${TYPE_LABELS[guessComponentType(descriptor)]} · ${element.tagName.toLowerCase()}`
      const size = el('span', 'dim')
      size.textContent = `${Math.round(box.width)}×${Math.round(box.height)}`
      head.append(label, size)

      const measured = el('div', 'line dim')
      measured.textContent = boundarySummary(descriptor)
      chip.append(head, measured)

      // The better boundary is searched for when the key is pressed, not here.
      // Naming the candidate's tag in the chip would read slightly better and
      // would cost a bounded DOM walk on every hover frame, on exactly the
      // sprawling page sections where a hover is already expensive.
      const wrapper = wrapperReason(descriptor)
      if (wrapper !== null) {
        offering = true
        const warn = el('div', 'line warn')
        warn.textContent = `this looks like a wrapper: ${wrapper} -- press W for the nearest box that paints one`
        chip.append(warn)
      }
      halo.dataset['wrapper'] = String(wrapper !== null)
    }

    place(box)
  }

  /** Above the box when there is room, inside its top edge when there is not. */
  function place(box: Rect): void {
    const height = chip.getBoundingClientRect().height
    const above = box.y > height + 6
    chip.style.left = `${Math.max(4, Math.min(box.x, window.innerWidth - 220))}px`
    chip.style.top = above ? `${box.y - height - 4}px` : `${box.y + 4}px`
  }

  /**
   * Say something, for long enough to be read.
   *
   * A failure stays up far longer than a confirmation, because the two are not
   * the same kind of message: "Captured" is a receipt you glance at, while
   * "the panel would not accept this -- check the pairing token" is an
   * instruction, and an instruction that vanishes in two seconds is one the
   * person will conclude they imagined.
   */
  function showToast(message: string, tone: 'ok' | 'error'): void {
    toast?.remove()
    toast = el('div', 'toast')
    toast.dataset['tone'] = tone
    toast.setAttribute('role', tone === 'error' ? 'alert' : 'status')
    toast.textContent = message
    shadow?.append(toast)
    const shown = toast
    window.setTimeout(
      () => {
        if (toast === shown) {
          shown.remove()
          toast = null
        }
      },
      tone === 'error' ? 9000 : 2600,
    )
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
    // An element walked to with the arrow keys survives a shaky hand, and is
    // given up as soon as the pointer is genuinely somewhere else.
    if (pinnedAt !== null) {
      const drifted = Math.abs(pointer.x - pinnedAt.x) + Math.abs(pointer.y - pinnedAt.y) > PIN_SLACK_PX
      if (!drifted) return
      pinnedAt = null
    }
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
    pinnedAt = null
    paintHighlight(hovered)
  }

  /** Move the outline to a different element, and keep it there for a moment. */
  function walkTo(element: Element | null): void {
    if (element === null) return
    hovered = element
    pinnedAt = { ...pointer }
    paintHighlight(hovered)
  }

  /** The parent, unless the parent is the page itself. */
  function parentOf(element: Element): Element | null {
    const parent = element.parentElement
    if (parent === null || parent === document.body || parent === document.documentElement) return null
    return parent
  }

  /**
   * The child to walk into: the one under the cursor, else the largest.
   *
   * Under the cursor first because that is the one the person is pointing at; the
   * largest as the fallback so a pointer parked over a gap between children
   * still goes somewhere useful rather than nowhere.
   */
  function childOf(element: Element): Element | null {
    const children = Array.from(element.children).filter((child) => {
      const box = child.getBoundingClientRect()
      return box.width >= 1 && box.height >= 1
    })
    if (children.length === 0) return null
    const under = children.find((child) => {
      const box = child.getBoundingClientRect()
      return pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom
    })
    if (under !== undefined) return under
    return children.reduce((best, candidate) => {
      const a = candidate.getBoundingClientRect()
      const b = best.getBoundingClientRect()
      return a.width * a.height > b.width * b.height ? candidate : best
    })
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
    const guess = guessComponentType(descriptor)
    let chosen: ComponentType | null = null
    const shot = await screenshotOf(element)
    // Read before the popover is built, so the line is never briefly wrong. A
    // failure here is not worth refusing a capture over: no counts yet reads as
    // an empty tally, which is what a first capture honestly has.
    const tally = await host.tally().catch(() => emptyTally())

    sheet = el('div', 'sheet')
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-label', 'Confirm capture')

    const title = el('h1')
    title.textContent = 'Capture this component'
    const origin = el('p', 'origin')
    origin.textContent = location.href

    const thumb = el('img', 'thumb')
    thumb.alt = ''
    // The popover is measured to be placed, and an undecoded image measures
    // zero: without this the layout it was positioned against is 50px shorter
    // than the one on screen.
    thumb.addEventListener('load', () => placeSheet(rectOf(element)))
    if (shot.screenshot !== null) thumb.src = shot.screenshot.dataUrl

    const measured = el('p', 'note')
    measured.textContent = boundarySummary(descriptor)

    const save = el('button', 'save')
    save.type = 'button'
    save.textContent = 'Save capture'
    save.disabled = true

    const prompt = el('p', 'note')
    prompt.dataset['tone'] = 'ask'
    prompt.textContent = `Which is it? The guess is ${TYPE_LABELS[guess]} -- press 1-4 or click.`

    const types = el('div', 'types')
    const buttons = new Map<ComponentType, HTMLButtonElement>()
    const choose = (type: ComponentType): void => {
      chosen = type
      for (const [candidate, node] of buttons) node.setAttribute('aria-pressed', String(candidate === chosen))
      delete prompt.dataset['tone']
      prompt.textContent = `Capturing as ${TYPE_LABELS[type]}${
        type === guess ? '' : ` -- the guess was ${TYPE_LABELS[guess]}`
      }.`
      save.disabled = false
      save.focus()
    }
    COMPONENT_TYPES.forEach((type, index) => {
      const button = el('button')
      button.type = 'button'
      const number = el('span', 'num')
      number.textContent = String(index + 1)
      button.append(number, document.createTextNode(TYPE_LABELS[type]))
      button.setAttribute('aria-pressed', 'false')
      button.dataset['guess'] = String(type === guess)
      button.addEventListener('click', () => choose(type))
      buttons.set(type, button)
      types.append(button)
    })

    const notes: HTMLElement[] = []
    const wrapper = wrapperReason(descriptor)
    if (wrapper !== null) {
      const note = el('p', 'note')
      note.dataset['tone'] = 'warn'
      note.textContent = `This looks like a wrapper rather than a component: ${wrapper}. Cancel, then use the arrow keys to pick a different box -- or save it anyway.`
      notes.push(note)
    }
    if (shot.error !== undefined) {
      const note = el('p', 'note')
      note.dataset['tone'] = 'warn'
      note.textContent = `No screenshot: ${shot.error}`
      notes.push(note)
    }
    const mix = el('p', 'note')
    mix.textContent = `Captured so far: ${tallyLine(tally)}`
    notes.push(mix)

    const actions = el('div', 'actions')
    const cancel = el('button', 'cancel')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => closeSheet())
    save.addEventListener('click', () => {
      if (chosen === null) return
      void commit(element, chosen, shot.screenshot, save)
    })
    actions.append(cancel, save)

    sheet.append(
      title,
      origin,
      ...(shot.screenshot !== null ? [thumb] : []),
      measured,
      prompt,
      types,
      ...notes,
      actions,
    )
    shadow?.append(sheet)
    placeSheet(rectOf(element))
    // The guess gets the focus rather than Save, because Save is disabled: one
    // Enter takes the guess, which is a keystroke a person spent on purpose.
    const first = buttons.get(guess)
    if (first !== undefined) first.focus()
    sheetKeys = (key: string): boolean => {
      const type = COMPONENT_TYPES[Number.parseInt(key, 10) - 1]
      if (!/^[1-9]$/.test(key) || type === undefined) return false
      choose(type)
      return true
    }
  }

  /**
   * Put the popover near the element, and never outside the window.
   *
   * The clamp is the part that matters. Preferring "below, else above" alone put
   * the popover's own Save button 20px past the bottom edge of an 819px viewport
   * -- present, enabled, and impossible to press, with nothing on screen saying
   * why. It happened because the height is measured the moment the popover is
   * appended and the thumbnail has not decoded yet, so the measurement was 50px
   * short of the truth; `placeSheet` is therefore called again when the image
   * lands, and clamps whatever it then measures into the viewport.
   */
  function placeSheet(box: Rect): void {
    if (sheet === null) return
    const { width, height } = sheet.getBoundingClientRect()
    const below = box.y + box.height + 12
    const preferred = below + height + 12 <= window.innerHeight ? below : box.y - height - 12
    const top = Math.min(Math.max(12, preferred), Math.max(12, window.innerHeight - height - 12))
    const left = Math.min(Math.max(12, box.x), Math.max(12, window.innerWidth - width - 12))
    sheet.style.top = `${top}px`
    sheet.style.left = `${left}px`
  }

  function closeSheet(): void {
    sheet?.remove()
    sheet = null
    sheetKeys = null
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
    const inherited = recordedBackdropOf(element)
    const picked: PickedElement = {
      componentType,
      styles: extractStyles(styleReaderFor(element), box),
      sourceUrl: location.href,
      captureId: captureIdFor(location.href, structuralPath(element)),
      rect: box,
      devicePixelRatio: window.devicePixelRatio,
      // Only when the element's own fill is not fully opaque: the record keeps
      // the browser's own `backgroundColor` either way, and this is the colour
      // that was actually behind it. See `capture/surface.ts` in the engine.
      ...(inherited === null ? {} : { inheritedBackgroundColor: inherited }),
    }
    const result = await host.save(picked, screenshot)
    closeSheet()
    // The wording is not decided here. `saveMessage` owns it, so that "a
    // capture the panel did not take is never reported in the success tone" is
    // a property of a pure function the suite asserts on, rather than of a
    // branch in a content script no test can reach.
    const message = saveMessage(result)
    showToast(message.text, message.tone)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // One Escape backs out of the confirm popover; a second leaves pick mode.
      if (sheet !== null) closeSheet()
      else stop()
      return
    }

    if (sheet !== null) {
      if (sheetKeys?.(event.key) === true) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      const from = hovered ?? elementUnder(pointer.x, pointer.y)
      if (from === null) return
      walkTo(event.key === 'ArrowUp' ? parentOf(from) : childOf(from))
      return
    }

    if (event.key.toLowerCase() === BOUNDARY_KEY && offering && hovered !== null) {
      event.preventDefault()
      event.stopPropagation()
      const better = nearestBoundary(hovered)
      if (better === null) showToast('nothing near this element paints a boundary of its own', 'error')
      else walkTo(better)
    }
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
    offering = false
    pinnedAt = null
    sheetKeys = null
    unmount()
  }

  return { start, stop, active: () => running }
}

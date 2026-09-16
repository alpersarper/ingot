/**
 * Everything that crosses a boundary inside the extension, in one place.
 *
 * There are three boundaries and they are all message passing: the picker in
 * the page talks to the service worker, the options page talks to the service
 * worker, and the service worker talks to the panel over HTTP. Only the last
 * one leaves the browser, and what it carries is a `CaptureRecord` -- the
 * engine's own type, so the shape the extension emits cannot drift from the
 * shape the engine accepts.
 */
import type { CaptureRecord, ComponentType } from '@ingot/engine'

/** Where the panel lives and how we prove we are allowed to talk to it. */
export interface Settings {
  /** Origin of the panel server, no trailing slash. Configurable; never assumed. */
  panelUrl: string
  /** The pairing token, sent as `x-ingot-token`. Empty until the user pastes one. */
  token: string
}

export const DEFAULT_PANEL_URL = 'http://localhost:4310'

export const DEFAULT_SETTINGS: Settings = { panelUrl: DEFAULT_PANEL_URL, token: '' }

/** A screenshot on its way to the panel, held as a data URL so it survives JSON. */
export interface ScreenshotBlob {
  /** `image/png`. The only type `chrome.tabs.captureVisibleTab` gives us losslessly. */
  contentType: 'image/png'
  /** `data:image/png;base64,...` -- `chrome.storage.local` stores JSON, not bytes. */
  dataUrl: string
  width: number
  height: number
}

/**
 * One capture waiting to reach the panel.
 *
 * The record is already schema-valid when this is created: the extension runs
 * the engine's own validator before anything is queued, so a malformed capture
 * fails at the point a human can still see what they picked, rather than as a
 * 422 in a drain loop hours later.
 */
export interface QueuedCapture {
  record: CaptureRecord
  screenshot: ScreenshotBlob | null
  /** When it was put in the queue. For the options page, never for the record. */
  queuedAt: string
}

/** A capture the panel refused outright, parked so it cannot wedge the queue. */
export interface RejectedCapture {
  record: CaptureRecord
  reason: string
  rejectedAt: string
}

/** What the picker measured, before the service worker turns it into a record. */
export interface PickedElement {
  componentType: ComponentType
  styles: CaptureRecord['styles']
  sourceUrl: string
  /** Stable across recaptures of the same element; see `identity.ts`. */
  captureId: string
  /** CSS-pixel box in viewport coordinates, for cropping the tab screenshot. */
  rect: Rect
  devicePixelRatio: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Messages the page sends the service worker. */
export type PickerMessage =
  | { type: 'ingot:ping' }
  | { type: 'ingot:shoot'; rect: Rect; devicePixelRatio: number }
  | { type: 'ingot:save'; picked: PickedElement; screenshot: ScreenshotBlob | null }

/** Messages the service worker sends the page. */
export type PickerCommand = { type: 'ingot:start' } | { type: 'ingot:stop' }

/** Messages the options page sends the service worker. */
export type OptionsMessage =
  | { type: 'ingot:status' }
  | { type: 'ingot:sync' }
  | { type: 'ingot:clear-rejected' }
  | { type: 'ingot:test-connection' }

/** What the options page renders. */
export interface QueueStatus {
  pending: number
  rejected: RejectedCapture[]
  /** Why the last drain stopped, or null when everything got through. */
  lastError: string | null
  /** ISO instant of the last completed drain attempt, or null. */
  lastAttemptAt: string | null
}

export interface ShootResult {
  screenshot: ScreenshotBlob | null
  /** Set when the shot could not be taken -- shown in the confirm popover. */
  error?: string
}

export interface SaveResult {
  ok: boolean
  /** Number of captures still waiting, so the picker can say "queued (3)". */
  pending: number
  /** Set when the capture could not even be queued. */
  error?: string
}

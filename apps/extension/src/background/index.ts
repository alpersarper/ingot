/**
 * The service worker: the toolbar button, the screenshot, and the buffer.
 *
 * MV3 evicts this worker whenever it is idle, which shapes everything below.
 * It holds no state between messages -- pick mode is discovered by asking the
 * tab rather than remembered, the queue lives in `chrome.storage.local`, and
 * the retry is an alarm rather than a timer. Anything kept in a module
 * variable would be correct until the first eviction and wrong afterwards,
 * which is the worst kind of correct.
 */
import { validateCaptureRecord, CaptureValidationError } from '@ingot/engine'
import type { CaptureRecord } from '@ingot/engine'
import { cropDataUrl } from './crop'
import { chromeLocalStore, readSettings } from '../shared/settings'
import { createQueue, QueueFullError } from '../shared/queue'
import type { Queue } from '../shared/queue'
import { createTransport } from '../shared/transport'
import type {
  OptionsMessage,
  PickedElement,
  PickerMessage,
  SaveResult,
  ScreenshotBlob,
  ShootResult,
} from '../shared/protocol'

const DRAIN_ALARM = 'ingot:drain'
/** Chrome's floor for a packed extension's alarm period is one minute. */
const DRAIN_PERIOD_MINUTES = 1

const store = chromeLocalStore()

const queue: Queue = createQueue({
  store,
  transport: async () => createTransport(await readSettings(store)),
  onCount: setBadge,
  now: () => new Date().toISOString(),
})

async function setBadge(pending: number): Promise<void> {
  await chrome.action.setBadgeText({ text: pending === 0 ? '' : String(pending) })
  await chrome.action.setBadgeBackgroundColor({ color: '#b45309' })
}

/**
 * Keep retrying only while there is something to retry.
 *
 * An alarm that fires forever would wake the worker every minute for the life
 * of the browser to find an empty queue.
 */
async function scheduleRetries(pending: number): Promise<void> {
  if (pending === 0) {
    await chrome.alarms.clear(DRAIN_ALARM)
    return
  }
  const existing = await chrome.alarms.get(DRAIN_ALARM)
  if (existing === undefined) {
    await chrome.alarms.create(DRAIN_ALARM, { periodInMinutes: DRAIN_PERIOD_MINUTES })
  }
}

async function drainNow(): Promise<{ sent: number; pending: number; error: string | null }> {
  const result = await queue.drain()
  await setBadge(result.pending)
  await scheduleRetries(result.pending)
  return result
}

/**
 * The capture record, assembled here rather than in the page.
 *
 * `capturedAt` is stamped in the service worker because the page's clock is the
 * page's: a site may have replaced `Date`. The engine never reads this field --
 * a timestamp that reached the output would make every regeneration a diff --
 * but the operator does, so it should be the browser's own answer.
 */
function buildRecord(picked: PickedElement): CaptureRecord {
  return validateCaptureRecord({
    schemaVersion: 1,
    id: picked.captureId,
    componentType: picked.componentType,
    sourceUrl: picked.sourceUrl,
    capturedAt: new Date().toISOString(),
    screenshot: null,
    styles: picked.styles,
  })
}

async function handleSave(picked: PickedElement, screenshot: ScreenshotBlob | null): Promise<SaveResult> {
  let record: CaptureRecord
  try {
    record = buildRecord(picked)
  } catch (error) {
    // The engine's own validator, run before anything is stored. A capture that
    // could never be accepted fails here, in front of the person who picked it,
    // rather than as a 422 inside a drain hours later.
    const message =
      error instanceof CaptureValidationError ? error.issues.join('; ') : error instanceof Error ? error.message : ''
    return { ok: false, pending: await queue.pendingCount(), error: `invalid capture: ${message}` }
  }

  let pending: number
  try {
    pending = await queue.enqueue(record, screenshot, new Date().toISOString())
  } catch (error) {
    // Anything from here -- the buffer's own cap, or `chrome.storage.local`
    // refusing the write -- has to come back as an answer. A thrown error
    // would leave the confirm popover saying "Saving..." for ever, which is the
    // one outcome worse than losing the capture.
    const message = error instanceof QueueFullError ? error.message : `could not buffer this capture: ${String(error)}`
    return { ok: false, pending: await queue.pendingCount(), error: message }
  }

  await setBadge(pending)
  const result = await drainNow()
  return { ok: true, pending: result.pending }
}

async function handleShoot(tabId: number, message: Extract<PickerMessage, { type: 'ingot:shoot' }>): Promise<ShootResult> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    return { screenshot: await cropDataUrl(dataUrl, message.rect, message.devicePixelRatio) }
  } catch (error) {
    // A capture without a picture is still a capture: the styles are what the
    // engine reads. Say what went wrong in the popover and carry on.
    return { screenshot: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Toggle pick mode on a tab, injecting the picker the first time. */
async function togglePickMode(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id
  if (tabId === undefined) return
  await clearFailure()

  let active: boolean | null = null
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { type: 'ingot:ping' })) as { active: boolean } | undefined
    active = pong?.active ?? false
  } catch {
    // No listener in the tab: the picker has not been injected here yet. This
    // is the ordinary first-click path, not an error.
    active = null
  }

  if (active === null) {
    try {
      await chrome.scripting.executeScript({
        // The top frame only. Frames are out of scope for v1, and the picker
        // says so when a frame is what you hovered.
        target: { tabId, allFrames: false },
        files: ['content.js'],
      })
    } catch (error) {
      await showFailure(error instanceof Error ? error.message : String(error))
      return
    }
  }

  await chrome.tabs.sendMessage(tabId, { type: active === true ? 'ingot:stop' : 'ingot:start' })
}

const DEFAULT_TITLE = 'Ingot: pick a component (click to toggle)'

/**
 * Say something went wrong on the button itself; there is no popup to say it in.
 *
 * It is cleared at the start of the next toggle rather than on a timer,
 * because a timer in a service worker does not survive the worker being
 * evicted -- and the failure mode of that is an error message stuck on the
 * toolbar with nothing left to explain it.
 */
async function showFailure(title: string): Promise<void> {
  await chrome.action.setBadgeText({ text: '!' })
  await chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' })
  await chrome.action.setTitle({ title: `Ingot: ${title}` })
}

async function clearFailure(): Promise<void> {
  await chrome.action.setTitle({ title: DEFAULT_TITLE })
  await setBadge(await queue.pendingCount())
}

chrome.action.onClicked.addListener((tab) => {
  void togglePickMode(tab)
})

chrome.runtime.onMessage.addListener((message: PickerMessage | OptionsMessage, sender, respond) => {
  void (async () => {
    switch (message.type) {
      case 'ingot:shoot': {
        const tabId = sender.tab?.id
        respond(
          tabId === undefined
            ? ({ screenshot: null, error: 'no tab to screenshot' } satisfies ShootResult)
            : await handleShoot(tabId, message),
        )
        return
      }
      case 'ingot:save':
        respond(await handleSave(message.picked, message.screenshot))
        return
      case 'ingot:status':
        respond(await queue.status())
        return
      case 'ingot:sync': {
        await drainNow()
        respond(await queue.status())
        return
      }
      case 'ingot:clear-rejected':
        await queue.clearRejected()
        respond(await queue.status())
        return
      case 'ingot:test-connection': {
        const transport = createTransport(await readSettings(store))
        respond(await transport.check())
        return
      }
      default:
        respond(undefined)
    }
  })()
  // Every branch answers asynchronously, which is what the `true` promises.
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DRAIN_ALARM) void drainNow()
})

// Two wake-ups worth draining on: the browser starting with a queue left over
// from last session, and the extension being installed or updated.
chrome.runtime.onStartup.addListener(() => void drainNow())
chrome.runtime.onInstalled.addListener(() => void drainNow())

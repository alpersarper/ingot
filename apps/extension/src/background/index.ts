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
import { validateCaptureRecord } from '@ingot/engine'
import type { CaptureRecord } from '@ingot/engine'
import { cropDataUrl } from './crop'
import { chromeLocalStore, readSettings } from '../shared/settings'
import { createQueue } from '../shared/queue'
import { bumpTally, readTally } from '../shared/tally'
import { saveCapture } from '../shared/save'
import type { DrainReport, Queue, QueueCounts } from '../shared/queue'
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

/** Amber for captures that are merely waiting; red for ones the panel refused. */
const WAITING_COLOUR = '#b45309'
const REFUSED_COLOUR = '#b91c1c'

const DEFAULT_TITLE = 'Ingot: pick a component (click to toggle)'

/**
 * The toolbar badge, which is the only thing this extension can say while the
 * user is not looking at it.
 *
 * Two states rather than one, because they mean opposite things. A *waiting*
 * capture is safe and will go the moment the panel answers, so it is a count in
 * amber and needs nothing from anybody. A *refused* capture is one the panel
 * will never take: it has been parked, it is not coming back on its own, and
 * something has to be done about it. That state used to render as an empty
 * badge -- the queue was genuinely empty, because the parked capture had been
 * moved out of it -- which meant the one case where data had been dropped was
 * the one case with no indicator at all. Refused therefore wins the badge, in
 * red, and says so in the tooltip.
 */
async function setBadge(counts: QueueCounts): Promise<void> {
  if (counts.rejected > 0) {
    await chrome.action.setBadgeText({ text: String(counts.rejected) })
    await chrome.action.setBadgeBackgroundColor({ color: REFUSED_COLOUR })
    await chrome.action.setTitle({
      title: `Ingot: the panel refused ${counts.rejected} capture${counts.rejected === 1 ? '' : 's'} -- open this extension's options`,
    })
    return
  }
  await chrome.action.setBadgeText({ text: counts.pending === 0 ? '' : String(counts.pending) })
  await chrome.action.setBadgeBackgroundColor({ color: WAITING_COLOUR })
  await chrome.action.setTitle({
    title:
      counts.pending === 0
        ? DEFAULT_TITLE
        : `Ingot: ${counts.pending} capture${counts.pending === 1 ? '' : 's'} waiting for the panel`,
  })
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

async function drainNow(): Promise<DrainReport> {
  const result = await queue.drain()
  // The drain announces its own counts through the sink, so the badge is
  // already current here; only the alarm still needs telling.
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
    ...(picked.inheritedBackgroundColor === undefined
      ? {}
      : { inheritedBackgroundColor: picked.inheritedBackgroundColor }),
  })
}

/**
 * Take a capture, buffer it, deliver it -- and say what actually happened.
 *
 * The decision is `saveCapture`'s, in `shared/save.ts`, so that "a capture the
 * panel refused is never reported as a success" is a property the Node suite
 * can hold this code to. What stays here is the part that is Chrome: the
 * record is assembled from what the picker measured, and the drain that runs
 * is the worker's own, alarm and badge included.
 */
async function handleSave(picked: PickedElement, screenshot: ScreenshotBlob | null): Promise<SaveResult> {
  const result = await saveCapture(
    { queue, drain: drainNow },
    () => buildRecord(picked),
    screenshot,
    new Date().toISOString(),
  )
  // Counted only when the capture got in: the tally's whole job is to say what
  // evidence the library has, and a capture the buffer refused is not evidence.
  // A storage failure here must not turn an accepted capture into a reported
  // one, so the tally's own write cannot change the answer.
  if (result.ok) await bumpTally(store, picked.componentType).catch(() => undefined)
  return result
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

/**
 * Say something went wrong on the button itself; there is no popup to say it in.
 *
 * This one is about the *injection* failing -- there is no page to put a toast
 * on, because the picker is what could not be put there. Delivery failures do
 * not come through here: they have a page to speak on, and they use it.
 *
 * It is cleared at the start of the next toggle rather than on a timer,
 * because a timer in a service worker does not survive the worker being
 * evicted -- and the failure mode of that is an error message stuck on the
 * toolbar with nothing left to explain it.
 */
async function showFailure(title: string): Promise<void> {
  await chrome.action.setBadgeText({ text: '!' })
  await chrome.action.setBadgeBackgroundColor({ color: REFUSED_COLOUR })
  await chrome.action.setTitle({ title: `Ingot: ${title}` })
}

/**
 * Put the badge back to what the buffer actually says.
 *
 * Through the counts rather than a hardcoded default, so clearing an injection
 * error cannot also clear a standing "the panel refused N captures" warning
 * that is still true.
 */
async function clearFailure(): Promise<void> {
  await setBadge(await queue.counts())
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
      case 'ingot:tally':
        respond(await readTally(store))
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

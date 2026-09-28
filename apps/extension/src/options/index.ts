/**
 * The options page: the panel address, the token, and the state of the buffer.
 *
 * It owns no logic of its own -- the queue lives in the service worker, and
 * every button here is a message to it. That is what keeps "sync now" and the
 * automatic retry the same code path, so the manual button cannot drift into a
 * second, subtly different drain.
 */
import { chromeLocalStore, readSettings, saveSettings } from '../shared/settings'
import type { HostAccess } from '../shared/settings'
import { DEFAULT_PANEL_URL } from '../shared/protocol'
import { adviceFor } from '../shared/outcome'
import type { OptionsMessage, QueueStatus } from '../shared/protocol'

const store = chromeLocalStore()

function need<T extends Element>(id: string): T {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`options page is missing #${id}`)
  return node as unknown as T
}

const form = need<HTMLFormElement>('settings')
const panelUrl = need<HTMLInputElement>('panelUrl')
const token = need<HTMLInputElement>('token')
const settingsStatus = need<HTMLElement>('settingsStatus')
const syncStatus = need<HTMLElement>('syncStatus')
const pending = need<HTMLElement>('pending')
const queueError = need<HTMLElement>('queueError')
const rejectedSection = need<HTMLElement>('rejectedSection')
const rejectedList = need<HTMLUListElement>('rejected')

function say(target: HTMLElement, message: string, tone: 'ok' | 'error' = 'ok'): void {
  target.textContent = message
  target.dataset['tone'] = tone
}

async function send<T>(message: OptionsMessage): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T
}

function render(status: QueueStatus): void {
  pending.textContent = String(status.pending)

  // The same sentence the capture popover shows, from the same function: one
  // failure should not read as two different problems depending on where the
  // user happens to be looking at it.
  queueError.hidden = status.lastFailure === null
  queueError.textContent = status.lastFailure === null ? '' : adviceFor(status.lastFailure)

  rejectedSection.hidden = status.rejected.length === 0
  rejectedList.textContent = ''
  for (const item of status.rejected) {
    const li = document.createElement('li')
    const id = document.createElement('span')
    id.className = 'id'
    id.textContent = item.record.id
    const reason = document.createElement('div')
    reason.className = 'reason'
    reason.textContent = item.reason
    const origin = document.createElement('div')
    origin.textContent = item.record.sourceUrl
    li.append(id, origin, reason)
    rejectedList.append(li)
  }
}

async function refresh(): Promise<void> {
  render(await send<QueueStatus>({ type: 'ingot:status' }))
}

/**
 * Chrome's permission API, as the save sequence wants it.
 *
 * The three calls are wrapped here and the decisions are in
 * `shared/settings.ts`, which is what lets "a refused grant never loses the
 * token" be a Node test rather than something only a real browser could show.
 */
const access: HostAccess = {
  contains: (pattern) => chrome.permissions.contains({ origins: [pattern] }),
  request: (pattern) => chrome.permissions.request({ origins: [pattern] }),
  remove: async (pattern) => void (await chrome.permissions.remove({ origins: [pattern] })),
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void (async () => {
    const address = panelUrl.value.trim() === '' ? DEFAULT_PANEL_URL : panelUrl.value.trim()
    say(settingsStatus, 'Saving...')
    let outcome
    try {
      outcome = await saveSettings({ store, access, defaultUrl: DEFAULT_PANEL_URL }, { panelUrl: address, token: token.value })
    } catch (error) {
      // Nothing may leave this handler silently. The old version let a
      // rejection escape a floating async function, which showed the user an
      // empty status line and a form that had quietly done nothing.
      say(settingsStatus, `could not save: ${error instanceof Error ? error.message : String(error)}`, 'error')
      return
    }

    const current = await readSettings(store)
    panelUrl.value = current.panelUrl
    say(settingsStatus, outcome.message, outcome.tone)
    // A settings change is the commonest reason a stalled queue can move again
    // -- but only try when the address is actually reachable, so a failed grant
    // does not bury its own message under a drain error.
    if (outcome.granted) render(await send<QueueStatus>({ type: 'ingot:sync' }))
    else await refresh()
  })()
})

need<HTMLButtonElement>('test').addEventListener('click', () => {
  void (async () => {
    say(settingsStatus, 'Checking...')
    const result = await send<{ ok: boolean; message?: string }>({ type: 'ingot:test-connection' })
    if (result.ok) say(settingsStatus, 'Paired -- the panel accepted this token.')
    else say(settingsStatus, result.message ?? 'the panel did not accept this token', 'error')
  })()
})

need<HTMLButtonElement>('sync').addEventListener('click', () => {
  void (async () => {
    say(syncStatus, 'Sending...')
    const status = await send<QueueStatus>({ type: 'ingot:sync' })
    render(status)
    if (status.pending === 0) say(syncStatus, 'Everything is through.')
    else say(syncStatus, `${status.pending} still waiting.`, 'error')
  })()
})

need<HTMLButtonElement>('clearRejected').addEventListener('click', () => {
  void (async () => {
    render(await send<QueueStatus>({ type: 'ingot:clear-rejected' }))
  })()
})

void (async () => {
  const settings = await readSettings(store)
  panelUrl.value = settings.panelUrl
  token.value = settings.token
  await refresh()
})()

// The badge and this page can disagree if a drain happens while it is open.
chrome.storage.local.onChanged.addListener(() => void refresh())

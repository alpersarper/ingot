/**
 * The options page: the panel address, the token, and the state of the buffer.
 *
 * It owns no logic of its own -- the queue lives in the service worker, and
 * every button here is a message to it. That is what keeps "sync now" and the
 * automatic retry the same code path, so the manual button cannot drift into a
 * second, subtly different drain.
 */
import { chromeLocalStore, hostPatternFor, readSettings, writeSettings } from '../shared/settings'
import { DEFAULT_PANEL_URL } from '../shared/protocol'
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

  queueError.hidden = status.lastError === null
  queueError.textContent = status.lastError ?? ''

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
 * Ask for host access to whatever address was typed.
 *
 * The default is in `host_permissions` and needs nothing. Anything else is an
 * optional permission requested from this click -- Chrome requires a user
 * gesture, and requiring one is the right shape anyway: the extension gets
 * access to exactly the host the user named, at the moment they name it.
 */
async function ensureHostAccess(url: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const pattern = hostPatternFor(url)
  if (pattern === null) return { ok: false, message: 'that is not an http(s) address' }
  if (await chrome.permissions.contains({ origins: [pattern] })) return { ok: true }
  const granted = await chrome.permissions.request({ origins: [pattern] })
  return granted ? { ok: true } : { ok: false, message: `without access to ${pattern} captures cannot be sent` }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void (async () => {
    const address = panelUrl.value.trim() === '' ? DEFAULT_PANEL_URL : panelUrl.value.trim()
    const access = await ensureHostAccess(address)
    if (!access.ok) {
      say(settingsStatus, access.message, 'error')
      return
    }
    await writeSettings(store, { panelUrl: address, token: token.value })
    const current = await readSettings(store)
    panelUrl.value = current.panelUrl
    say(settingsStatus, 'Saved.')
    // A settings change is the commonest reason a stalled queue can move again.
    render(await send<QueueStatus>({ type: 'ingot:sync' }))
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

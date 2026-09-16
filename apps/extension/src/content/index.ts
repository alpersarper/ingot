/**
 * The content script: injected on demand, never declared.
 *
 * There is no `content_scripts` block in the manifest, which is the privacy
 * posture made structural rather than promised. Nothing runs on any page until
 * the toolbar button is clicked, and the click is also what grants `activeTab`
 * -- so the extension's access to a page begins and ends with a person asking
 * for it on that tab.
 *
 * Re-injection is normal: the service worker injects on every toggle rather
 * than tracking which tabs it has touched, because it is evicted often enough
 * that such a record would be a lie. So this file installs exactly once and
 * everything after that is a message.
 */
import { createPicker } from './picker'
import type { PickerCommand, PickerMessage, SaveResult, ShootResult } from '../shared/protocol'

declare global {
  interface Window {
    __ingotPickerInstalled?: true
  }
}

function install(): void {
  const picker = createPicker({
    async shoot(rect, devicePixelRatio) {
      const message: PickerMessage = { type: 'ingot:shoot', rect, devicePixelRatio }
      return (await chrome.runtime.sendMessage(message)) as ShootResult
    },
    async save(picked, screenshot) {
      const message: PickerMessage = { type: 'ingot:save', picked, screenshot }
      return (await chrome.runtime.sendMessage(message)) as SaveResult
    },
  })

  chrome.runtime.onMessage.addListener((message: PickerCommand | PickerMessage, _sender, respond) => {
    if (message.type === 'ingot:ping') {
      respond({ active: picker.active() })
      return false
    }
    if (message.type === 'ingot:start') {
      picker.start()
      respond({ active: true })
      return false
    }
    if (message.type === 'ingot:stop') {
      picker.stop()
      respond({ active: false })
      return false
    }
    return false
  })
}

if (window.__ingotPickerInstalled !== true) {
  window.__ingotPickerInstalled = true
  install()
}

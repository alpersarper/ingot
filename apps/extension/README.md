# Ingot capture (Chrome extension)

Pick a UI component while browsing; it arrives in your panel as a capture
record. This is the front of the pipeline the rest of the repository is about:
what it emits is `schemas/capture-record.schema.json`, and nothing else.

Chrome only, Manifest V3. Firefox and Safari are
[out of scope for v1](../../DECISIONS.md#hard-boundaries-v1-scope).

## Load it

```bash
pnpm install
pnpm build:extension     # writes apps/extension/dist/
```

Then in Chrome: **chrome://extensions** → turn on **Developer mode** → **Load
unpacked** → choose `apps/extension/dist`. (Load `dist`, not
`apps/extension`; the manifest and the built scripts live there.)

Open the extension's **Details → Extension options** and fill in:

- **Panel address** -- `http://localhost:4310` by default, which is what
  `docker compose up` serves. Any other address is fine; Chrome asks for
  permission for that host when you save, and the extension has no access to it
  until you grant it.
- **Pairing token** -- printed by the server on first start, and in
  `pairing-token.txt` on the panel's data volume.

**Test connection** checks both against the panel before you rely on them.

`pnpm --filter @ingot/extension dev` rebuilds on change; press the reload button
on the extension's card in `chrome://extensions` to pick the rebuild up.

## Use it

Click the toolbar button to turn **pick mode** on for that tab.

- **Hover** outlines the element under the cursor and names the component type
  it is going to guess. The outline is drawn over the page and changes nothing
  about its layout.
- **Alt** while hovering selects the parent instead, for when the thing you want
  is the card and the cursor keeps landing on the text inside it.
- **Click** freezes that element, takes its picture, and opens a small popover:
  the cropped screenshot, the four component types with the guess selected, and
  **Save capture**. The guess is a starting point -- set the type you meant.
- **Escape** closes the popover; Escape again leaves pick mode.

While pick mode is on, the page gets no clicks: a capture on a link does not
follow it. That also keeps `:hover` off the element you are capturing, so the
styles recorded are its resting state and not the one your cursor put it in.

**Frames.** An element inside an `<iframe>` cannot be captured. Hovering one
outlines it in amber and says *cannot capture inside frames* rather than
capturing the frame's own empty box.

**When the panel is down**, captures queue in the extension and the toolbar
badge shows how many are waiting. They survive a browser restart, drain in the
order you took them as soon as the panel answers, and can be pushed by hand with
**Sync now** on the options page. A capture the panel refuses outright -- a
schema error rather than an unreachable server -- is set aside there with the
reason, so one bad record cannot block the ones behind it.

## What it reads, and what it sends

- **Reads** the computed style values of the one element you click, that
  element's size and position, and the page URL. Never the page's markup,
  text, stylesheets, cookies or storage. Capture is reference-grade by
  [decision](../../DECISIONS.md#hard-boundaries-v1-scope): values and a picture,
  never anything aiming at reproducing the DOM.
- **Screenshots** that element's box, cropped in the extension from a shot of
  the visible tab. The page's own JavaScript never sees the image.
- **Sends** both to the configured panel address, with the pairing token in the
  `x-ingot-token` header, and to nowhere else. No telemetry, no analytics, no
  third party.
- **Stores** the panel address, the pairing token and captures still waiting, in
  `chrome.storage.local` -- deliberately not `chrome.storage.sync`, which would
  copy the token to a Google account and back down onto every browser you are
  signed into.
- **Runs** on a tab only after you click the toolbar button on it. There is no
  `content_scripts` block in the manifest; the picker is injected on that click
  and on no other occasion.

### Permissions, and why each one is there

| Permission | Why |
| ---------- | --- |
| `activeTab` | Grants access to the current tab *on the toolbar click* and no earlier. It is what lets the picker be injected and the tab be screenshotted, without a standing permission on every site you visit. |
| `scripting` | To inject the picker on that click. The alternative -- a declared content script -- would run on every page whether or not you ever capture from it. |
| `storage` | The panel address, the token, and the buffer of captures waiting to be sent. |
| `alarms` | The retry that drains the buffer when the panel comes back. MV3 evicts the service worker when idle, so a timer would not survive; an alarm does. |
| `host_permissions: http://localhost:4310/*` | The default panel address, so the common case needs no permission prompt. |
| `optional_host_permissions: http(s)://*/*` | Requested for *one* host, at the moment you save a different panel address on the options page. Nothing is granted until then. |

The extension asks for no host permission on the sites you browse. `activeTab`
covers those, one click at a time.

## What it normalises, and why

The record carries what the browser reported. Four values cannot travel
verbatim, because the browser's honest answer is not one the schema accepts --
all four are in `src/shared/styles.ts` with the reasoning, and all four are
tested in `test/styles.test.ts`:

- **Percentage radii.** `getComputedStyle` reports `"50%"`. It is resolved
  against the box, and a corner rounded to its maximum becomes `9999px`, which
  is how `docs/capture-record.md` spells "pill". Reporting `20px` for a
  fully-round 40px control would tell the engine the opposite of what is on
  screen.
- **Variable-font weights.** `"450"` is snapped to `"500"`; the schema takes
  hundreds. A 25-unit rounding is a smaller lie than a capture with no weight.
- **`gap`.** `"normal"` on everything that is not flex or grid, and dropped
  there; a grid's two gaps (`<row-gap> <column-gap>`) become the row gap -- the
  first -- because it is the one that describes the vertical rhythm of the
  column layouts most captured cards use.
- **Border colour.** Browsers report one even at zero width, usually the text
  colour. It travels only from an element that actually draws a border.

Colours are passed through exactly as reported -- `rgb(...)`, `rgba(...)`,
whatever the page resolved to. The engine normalises colour; the extension does
not second-guess it.

### Capture ids

An id must be the same when you capture the same element again, so that
provenance updates a contribution instead of growing a second one. It is
derived: a readable host label plus a hash of the page's path and the element's
position in the document (`stripe-com-1f3k9x2`). The component type is
deliberately not in the input -- changing the guess in the popover must not mint
a second capture of one element.

The hashed input is tag names and sibling positions only. Nothing about the
page's content is in it, and the hash is all that travels.

## Tests

`pnpm test` runs them with the rest of the workspace; `pnpm vitest run --project
extension` on their own.

Everything worth testing here is pure by construction: extraction takes a
property reader rather than an element, the type guess takes a flat descriptor,
and the buffer takes a key-value store rather than `chrome.storage`. So the
tests run in Node, with the values a real browser actually returns -- which is
the point, because the cases worth pinning (`"50%"` radii, `"450"` weights,
phantom border colours) are ones jsdom cannot produce. `test/queue.test.ts`
walks the whole buffer lifecycle, service-worker eviction included, against a
panel that can be switched off; `test/record.test.ts` puts the result through
both the engine's validator and the published JSON Schema.

## Known limits

- **Frames** are refused rather than captured. See above.
- **The overlay is a fixed-position layer at the maximum z-index**, re-appended
  when a page appends something after it. A page that scrolls an inner container
  under the cursor will scroll the document instead while pick mode is on.
- **`captureVisibleTab` photographs the visible viewport**, so an element that
  does not fit on screen is captured as the part that does, and one scrolled out
  of view is saved without a picture and says so in the popover.
- **Store publishing is not in scope.** This loads unpacked.

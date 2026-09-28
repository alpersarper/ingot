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

- **Panel address** -- `http://localhost:4310` by default, which is what both
  `npx ingot-workbench` and `docker compose up` serve. Any other address is fine; Chrome asks for
  permission for that host when you save, and the extension has no access to it
  until you grant it.
- **Pairing token** -- printed by the server on first start, and in
  `pairing-token.txt` in the panel's data directory (`~/.ingot` under npx).

**Test connection** checks both against the panel before you rely on them.

`pnpm --filter @ingot/extension dev` rebuilds on change; press the reload button
on the extension's card in `chrome://extensions` to pick the rebuild up.

## Use it

Click the toolbar button to turn **pick mode** on for that tab.

- **Hover** outlines the element under the cursor and states three things: the
  type it is going to guess, the boundary it measured -- background, border,
  padding -- and, when that boundary is one a reader could not see, that this
  looks like a wrapper rather than a component. The outline is drawn over the
  page and changes nothing about its layout.
- **Up and Down arrows** walk to the parent and back into the child, re-outlining
  as they go. The cursor lands on layout far more often than on a component, and
  the element you meant is usually one step away. **Alt** while hovering is the
  same move without leaving the mouse.
- **W** takes the picker's suggestion: the nearest box that actually paints a
  background, a border or a shadow, searched inwards first and then outwards.
- **Click** freezes that element, takes its picture, and opens a small popover:
  the cropped screenshot, the boundary it measured, the four component types
  with the guess *marked* -- and **Save capture**, which stays disabled until you
  choose one. Press 1-4 or click. The guess is never the answer by default,
  because a hurried session in which nobody disagreed with it is how a library
  ends up holding nothing but cards.
- The popover also says **what you have captured so far**, by type. `1 button ·
  1 card · 0 inputs · 1 type -- grab some inputs next` is the cheapest possible
  moment to find out that a kit is going to be distilled from one kind of
  evidence.
- **Escape** closes the popover; Escape again leaves pick mode.

While pick mode is on, the page gets no clicks: a capture on a link does not
follow it. That also keeps `:hover` off the element you are capturing, so the
styles recorded are its resting state and not the one your cursor put it in.

**Frames.** An element inside an `<iframe>` cannot be captured. Hovering one
outlines it in amber and says *cannot capture inside frames* rather than
capturing the frame's own empty box.

**When the panel is down**, captures queue in the extension and the toolbar
badge shows how many are waiting, in amber. They survive a browser restart,
drain in the order you took them as soon as the panel answers, and can be
pushed by hand with **Sync now** on the options page. Only a capture the panel
will never accept -- a schema error (a 400 or 422), rather than an unreachable
server or a setting to fix -- is set aside there with the reason, so one bad
record cannot block the ones behind it. Everything else, a wrong token or a
mistyped address some other server answers, holds the queue: correct the
setting and it drains.

**You are told when a capture did not arrive, on the page where you took it.**
The popover's confirmation is a receipt for something that happened, so it says
`Captured` only when the panel took the capture. Anything else names the
panel's own answer and what to do about it -- *the panel would not accept this
(401 -- this panel is not paired with you) -- check the panel address and
pairing token in this extension's options* -- and stays on screen long enough
to read. A capture the panel **refused outright** also turns the toolbar badge
red and keeps it red until you deal with it on the options page, because that
capture is not waiting for anything: it is the one case where work was dropped,
and it used to be the one case with no indicator at all.

## What it reads, and what it sends

- **Reads** the computed style values of the one element you click, that
  element's size and position, the page URL, and -- when the element is
  transparent -- the background colour of the nearest ancestor that paints one,
  so that a ghost button is not recorded as evidence of no background. Never the
  page's markup, text, stylesheets, cookies or storage. Capture is reference-grade by
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
| `optional_host_permissions: http(s)://*/*` | Requested for *one* host, at the moment you save a different panel address on the options page. Nothing is granted until then, and the grant for a previously saved address is revoked when it is no longer the configured one. |

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

There is one thing it **measures** rather than normalises. When the element's own
background is fully transparent, the picker walks its ancestors for the colour
actually painted behind it and sends that as `inheritedBackgroundColor`, marked
as inherited and beside `styles` rather than inside it -- the record still
reports `backgroundColor: rgba(0, 0, 0, 0)`, because that is what the browser
said about the element. Without it, a ghost button, a heading, or a bordered
card on a tinted section is evidence of *no background*, and a library captured
mostly that way distils its surface from whichever two or three captures
happened to paint their own. When nothing up the chain paints one either, the
field is left out rather than assumed to be white: a UA dark mode or a user
stylesheet changes the canvas, and not knowing is reported as not knowing.

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
property reader rather than an element, the type guess and the boundary check
take a flat descriptor, the tally takes a key-value store, and so does the
buffer rather than `chrome.storage`. So the
tests run in Node, with the values a real browser actually returns -- which is
the point, because the cases worth pinning (`"50%"` radii, `"450"` weights,
phantom border colours) are ones jsdom cannot produce. `test/queue.test.ts`
walks the whole buffer lifecycle, service-worker eviction included, against a
panel that can be switched off; `test/record.test.ts` puts the result through
both the engine's validator and the published JSON Schema; and
`test/boundary.test.ts` is built from the captures that made the boundary check
necessary -- seven off three real sites, five of them transparent layout
`<div>`s recorded as cards.

## Known limits

- **Frames** are refused rather than captured. See above.
- **The overlay is a fixed-position layer at the maximum z-index**, re-appended
  when a page appends something after it. A page that scrolls an inner container
  under the cursor will scroll the document instead while pick mode is on.
- **`captureVisibleTab` photographs the visible viewport**, so an element that
  does not fit on screen is captured as the part that does, and one scrolled out
  of view is saved without a picture and says so in the popover.
- **The wrapper check is advice, not a gate.** It can be wrong in both
  directions -- an image with no fill of its own reads as a wrapper, and a
  full-bleed section that does paint one is called out anyway -- so it says what
  it measured and lets you save regardless.
- **Store publishing is not in scope.** This loads unpacked.

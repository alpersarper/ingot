# The panel

The workbench: review captures, generate kits, look at the result. It is an
ordinary web app that happens to run locally in Docker, and it is written that
way on purpose -- writing it deployable today is nearly free, and converting it
later would be a rewrite.

```
apps/server/   Node + TypeScript. Storage, API, and the engine run server-side.
apps/panel/    React + Vite + Tailwind + shadcn conventions. The workbench UI.
```

The container exposes **one port**: the server serves the built panel, so the
API and the UI share an origin and there is exactly one address to configure --
the one the future browser extension will be pointed at.

## Running it

| | |
| --- | --- |
| `docker compose up` | The whole thing on `http://localhost:4310`. |
| `pnpm dev` | Server on 4310, Vite on 5173 with `/api` proxied. Use this to develop. |
| `pnpm build` | Build the panel, then bundle the server into `apps/server/dist`. |

Environment (all optional; see `apps/server/src/config.ts`):

| Variable | Default | |
| -------- | ------- | --- |
| `INGOT_PORT` | `4310` | |
| `INGOT_DATA_DIR` | `./data` (`/data` in the container) | Database, screenshots, pairing token. |
| `INGOT_PANEL_DIR` | unset | Built panel to serve. Unset means API only. |
| `INGOT_PANEL_ORIGIN` | `http://localhost:5173` | Comma-separated CORS allowlist. |
| `INGOT_PAIRING_TOKEN` | minted on first run | Pin to skip the first-run screen. |
| `INGOT_LLM_API_KEY` | unset | Pin the key instead of typing it into the panel. |

## The two guards

**The pairing token.** The panel is a web app on a known local port, so without
a guard any site in any tab could script requests at it and read the user's
captures. The server mints a token on first run, writes it to
`<data>/pairing-token.txt` and logs it; the user pastes it into the first-run
screen; the panel sends it as `x-ingot-token` on every call. A header is the
point -- a form post or an image tag cannot attach one, so a cross-site request
cannot forge it. Only `/api/health` and `/api/pairing*` are open, and they are
open because a client needs them *before* it holds a token.

It is not a login. There are no accounts, and the screen says so, because a
screen that looks like a login invites someone to type a password into it.

**CORS.** `apps/server/src/cors.ts` answers preflights for the allowlist and
*rejects* any cross-origin request whose `Origin` is not on it, rather than
merely declining to set the header. Declining the header stops a script reading
the response; it does not stop the request. The server's own origin is always
allowed without being configured, because in the container the panel is
same-origin with it.

## The LLM key

Goes in, never comes out. `PUT /api/settings` stores it server-side;
`GET /api/settings` reports `{ configured, source }` and no endpoint returns the
value. It is server-side precisely because the browser is where it must not be.

**No LLM call is made anywhere in this build.** The field exists so the key is
already in place for the assistant that follows.

## Determinism through the server

`distill()` guarantees byte-identical output for the same capture set. The
server can break that without touching the engine, so
`apps/server/src/kit.ts` is written to make three things true, and
`apps/server/test/kit-determinism.test.ts` asserts all of them against the
committed `examples/`:

- records are handed back to the engine exactly as they were stored;
- capture order comes from the group's membership positions;
- the set's id, name and description come from the group, which an import copies
  from the incoming set.

A `design.md` downloaded from the panel is byte-for-byte the one `pnpm skeleton`
writes for the same captures. If that stops being true, the bug is in the
server.

Overrides do not weaken that. A kit row stores the engine's own output --
`tokensJson` and `designMd` exactly as `distill` and `renderDesignMarkdown`
wrote them -- and the reviewer's values are replayed over it on read
(`effectiveKit` in `src/kit.ts`). A scope with no overrides hands back the
stored strings themselves rather than a re-rendered copy, so "no overrides" is
byte-identical by construction. A scope with overrides gets a document that is
still a pure function of `(stored kit, overrides)`, because `applyOverrides` is
as deterministic as `distill`.

## The API

Everything except `/api/health` and `/api/pairing*` requires the token.

| | |
| --- | --- |
| `GET /api/health` | Open. Engine version and storage schema version. |
| `GET /api/pairing`, `POST /api/pairing/verify` | Open. Pairing status and token check. |
| `GET/PUT /api/settings` | Panel settings; stores the LLM key, never returns it. |
| `GET/POST /api/captures`, `GET/PATCH/DELETE /api/captures/:id` | Capture CRUD. |
| `POST /api/captures/import` | Bulk import. Accepts a fixture set verbatim, or `{ set }`. |
| `PUT /api/captures/:id/tags`, `GET /api/captures/tags` | Replace a capture's tags; list every tag in use. |
| `PUT/GET /api/captures/:id/screenshot` | Image bytes to the volume, path to the database. |
| `GET/POST /api/groups`, `GET/PATCH/DELETE /api/groups/:id` | Groups. |
| `POST /api/groups/:id/captures`, `DELETE /api/groups/:id/captures/:captureId` | Membership. |
| `POST /api/kits` | Run the engine over a group, or over the whole library. |
| `GET /api/kits`, `GET /api/kits/latest`, `GET /api/kits/:id` | Kit retrieval: the kit, its effective tokens, `design.md`, and the review state behind them. |
| `GET /api/kits/:id/{tokens.json,design.md}` | Downloads. |
| `GET /api/kits/:id/components/:component.md` | One component, self-sufficient. |
| `GET /api/export/{tokens.json,design.md}`, `GET /api/export/components/:component.md` | The latest kit for a scope, as a file. |
| `GET /api/reviews` | The overrides and accepted decisions for a scope. Answers before a kit exists. |
| `PUT/DELETE /api/reviews/overrides` | Set or clear one token override. Answers with the whole effective kit. |
| `PUT /api/reviews/decisions` | Accept or reopen one decision card. |

## The workbench

Three columns, per the approved skeleton: collection on the left, the live
sample UI in the middle, the system on the right. The middle is widest because
the user's real question is "will my app look good", not "am I faithful to the
capture".

### The review loop

The right column is the product, not a settings page. It has three tabs:

- **Review** is the queue. Cards come from three places -- a conflict between a
  standing override and fresh evidence, a diagnostic the engine raised, and a
  dominant choice with a real minority behind it ("16 of 28 corners at 6px,
  runner-up 12px") -- and each carries its evidence and its runner-up as a
  one-click override. Accepting is one click; overriding is one more. A card id
  is derived from the kit's own content, so an acceptance survives regeneration.
- **Tokens** is the whole document, group by group. Every value shows its origin
  -- measured, derived, default, contrast-adjusted, yours -- and opens its full
  provenance on demand: contributing captures, every raw value observed, the
  dominant-choice record, any adjustment, and, for an overridden token, the
  engine's own answer it replaced.
- **Export** is the four artefacts, plus the seam where the LLM assistant lands.

Overrides are stored per **scope** (a group, or the library) rather than per kit
version, which is what makes regenerating carry them forward. A write answers
with the whole effective kit, so the preview, the docs and the exports all turn
from one authoritative answer instead of a locally patched copy.

### One renderer, three surfaces

`apps/panel/src/preview/components/` holds the canonical components -- button,
card, stat, input, select, badge, table, type scale. They draw the live preview,
the in-panel docs (`apps/panel/src/docs/KitDocs.tsx`) and the static docs export
(`apps/panel/src/export/docs-html.ts`), from one implementation. The static
export is that same React tree rendered to a string with the two stylesheets
inlined: no static-site framework, no second template to keep in step, and a
file that opens from `file://` with no server and no script.

The prose those surfaces show -- what a component is for, which tokens it uses,
the rules and the prohibitions -- comes from the engine's `componentDoc`, which
also writes the per-component markdown. So the docs page, the exported page and
`button.md` cannot disagree about a button.

The panel's own chrome uses shadcn's variable conventions (`--background`,
`--primary`, ...) and is **not** the kit. The kit lives inside the preview under
`--kit-*` (`apps/panel/src/preview/kit-css.ts`), so a dark kit in a light panel
renders as itself instead of inheriting the room it is standing in. The docs, by
contrast, are deliberately set *in* the kit: a page about the kit in the panel's
chrome would be a weaker artefact than a page that is the kit.

Every visual value in `canonical.css` and `docs.css` is a `var(--kit-*)` --
no colour, no length, no font size, not even as a fallback.
`apps/panel/test/canonical-css.test.ts` reads both stylesheets and enforces it,
because the failure it prevents is invisible: a hardcoded `#fff` looks fine in
the panel and is simply absent from every export.

The theme control swaps the token set the whole centre column is drawn from. The
kit has one mode, so the counterpart is derived in the panel
(`preview/counterpart.ts`): the surface and text ladder flipped and re-spread,
the brand roles kept, every guaranteed pair re-enforced with the engine's own
walker. It is labelled *derived, not exported* wherever it appears, and the kit
ships in the mode it was distilled in.

## Deliberately not built yet

No LLM assistant and no browser extension. The seams are left where they go: the
key the assistant needs is already stored server-side, and the review queue the
right column produces is exactly what it will be asked to reason about.

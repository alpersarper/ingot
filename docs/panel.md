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

## The API

Everything except `/api/health` and `/api/pairing*` requires the token.

| | |
| --- | --- |
| `GET /api/health` | Open. Engine version and storage schema version. |
| `GET /api/pairing`, `POST /api/pairing/verify` | Open. Pairing status and token check. |
| `GET/PUT /api/settings` | Panel settings; stores the LLM key, never returns it. |
| `GET/POST /api/captures`, `GET/PATCH/DELETE /api/captures/:id` | Capture CRUD. |
| `POST /api/captures/import` | Bulk import. Accepts a fixture set verbatim, or `{ set }`. |
| `PUT /api/captures/:id/tags` | Replace a capture's tags. |
| `PUT/GET /api/captures/:id/screenshot` | Image bytes to the volume, path to the database. |
| `GET/POST /api/groups`, `PATCH/DELETE /api/groups/:id` | Groups. |
| `POST /api/groups/:id/captures`, `DELETE /api/groups/:id/captures/:captureId` | Membership. |
| `POST /api/kits` | Run the engine over a group, or over the whole library. |
| `GET /api/kits`, `GET /api/kits/latest`, `GET /api/kits/:id` | Kit retrieval. |
| `GET /api/kits/:id/{tokens.json,design.md}` | Downloads, byte for byte. |
| `GET /api/export/{tokens.json,design.md}` | The latest kit for a scope, as a file. |

## The workbench

Three columns, per the approved skeleton: collection on the left, the live
sample UI in the middle, the system on the right. The middle is widest because
the user's real question is "will my app look good", not "am I faithful to the
capture".

The panel's own chrome uses shadcn's variable conventions (`--background`,
`--primary`, ...) and is **not** the kit. The kit lives inside the preview under
`--kit-*` (`apps/panel/src/preview/kit-css.ts`), so a dark kit in a light panel
renders as itself instead of inheriting the room it is standing in.

`apps/panel/src/preview/components/` holds the canonical components -- button,
card, input, type scale. Every visual property comes from a `var(--kit-*)`;
there is not one hardcoded colour, size or radius in `canonical.css`. That is
what makes the preview honest about the exported tokens, and it is the seed of
the component engine that will also draw the in-panel kit docs and the static
export.

## Deliberately not built yet

No token editing or overrides, no LLM assistant, no docs view, no
conflict-resolution UI, no browser extension. The seams are left where they go:
every token already carries the provenance and runner-up choices an override UI
needs, the system panel reads `tokens` and nothing else, and the key the
assistant needs is already stored.

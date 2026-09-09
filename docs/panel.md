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
| `INGOT_LLM_MODEL` | `claude-sonnet-5` | Pin the assistant's model; otherwise it is a panel setting. |
| `INGOT_LLM_BASE_URL` | unset | Provider endpoint, for a hosted proxy. |
| `INGOT_ASSISTANT_RATE_LIMIT` | `20` | Assistant calls allowed per window. |
| `INGOT_ASSISTANT_RATE_WINDOW_MS` | `60000` | Length of that window. |

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

Goes in, never comes out. `PUT /api/settings` stores or replaces it server-side,
`DELETE /api/settings/llm-key` removes it, and `GET /api/settings` reports
`{ configured, source, model }` -- no endpoint returns the value, and none ever
will. It is server-side precisely because the browser is where it must not be:
an extension, a bookmarklet or a stray script in the panel's own origin can read
anything the page holds.

It is also redacted from every log line and every error message the assistant
path produces, including provider-SDK errors built from a request that carried
it in a header. See [The assistant](#the-assistant) for the rest.

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
| `GET /api/assistant` | Assistant status and this scope's proposals. Reaches no provider; never rate-limited. |
| `POST /api/assistant/suggest` | Run `derive` or `merge`. Stores what the engine would accept as proposals. Rate-limited. |
| `POST /api/assistant/ask`, `/name`, `/rationale` | Content, not kit changes. Rate-limited. |
| `POST /api/assistant/proposals/:id/{accept,dismiss}` | Accept writes an override through the ordinary boundary; dismiss writes nothing to the kit. |
| `DELETE /api/settings/llm-key` | Remove the stored key. There is no endpoint that returns it. |

## The workbench

Three columns, per the approved skeleton: collection on the left, the live
sample UI in the middle, the system on the right. The middle is widest because
the user's real question is "will my app look good", not "am I faithful to the
capture".

### The review loop

The right column is the product, not a settings page. It has four tabs:

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
- **Export** is the four artefacts, and says how many of their values came from
  an assistant suggestion you accepted.
- **Assistant** is the advisory layer, and the only tab that can be absent: with
  no API key it shows how to get one and nothing else in this column changes.
  Its *suggestions* do not live there -- they are cards in the Review queue,
  drawn as suggestions. [The assistant](#the-assistant) is the long form.

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

## The assistant

The advisory layer in the right column. It proposes; the engine checks; a person
decides. `apps/server/src/assistant/` is where it lives, and the engine imports
none of it -- `packages/engine/test/purity.test.ts` would fail if it did.

### The division of labour

**The engine's deterministic core is never the LLM's job.** Colour maths,
contrast enforcement, scale snapping, conflict determination: the engine is
exact about all of those and a language model is not. The LLM does the parts
that are language -- what should this be called, do these two greys have a
reason to be two things, what would you write in the reason field, why is the
radius 8 -- and every value it proposes is checked by the engine before anybody
is shown it.

Five capabilities, each a typed operation with its own versioned prompt template
in `assistant/prompts.ts`:

| | | |
| --- | --- | --- |
| **derive** | proposal cards | Fills tokens the captures were silent about, where the engine had to state a `sanctioned-default`. |
| **merge** | proposal cards | Finds near-duplicates -- two greys a hair apart, two paddings a pixel apart -- and proposes collapsing one onto the other. |
| **name** | content | A brand-meaningful vocabulary for the palette. Content rather than cards *because the token model has no writable name*: Ingot's role names are a fixed, stack-agnostic set every export depends on, so a rename card would be one whose accept button could not do anything. |
| **rationale** | content | Drafts the reason behind an override that has none. Offered in the Tokens tab only where the reason field is empty; it fills the box and the reviewer still presses Override. |
| **qa** | content | Answers a question from the kit's provenance, citing token paths. The server resolves every citation against the kit and names any that does not resolve. |

### The proposal pipeline

```
model answer -> engine guardrail check -> proposal row -> card in Review
                                                              |
                                    accept ------------------>+------> planOverrideWrite -> override row
                                    dismiss ----------------->+------> nothing in the kit
```

The guardrail check (`assistant/proposals.ts`) is not a sanity check on the
text. The candidate is written into a throwaway copy of the kit and the whole of
`applyOverrides` runs: the value is parsed in the slot's own notation, the
interaction shades are re-derived, the control heights recomputed, the contrast
floor enforced. A candidate the engine refuses never becomes a card. One that
lands but moves something else -- a snapped length, a shade pinned to a gamut
pole -- becomes a card that says so, because that is a consequence the reviewer
is agreeing to.

A dismissal is a standing answer, not a deleted row, and it follows the same
law overrides and conflicts do: a human decision is respected until the world
changes, and nothing resurfaces or retires silently. A kept dismissed proposal
suppresses the same suggestion -- same path, same capability -- for as long as
the engine's answer it was judged against is unchanged. When the evidence
moves, the suggestion may return, and its card is marked "previously dismissed
-- evidence has since changed" rather than rendered as new.

**The assistant never writes a token, and there is no bypass.** Accepting goes
through `planOverrideWrite` and `store.reviews.setOverride`, the same two calls
the Tokens editor makes, with `suggestedBy: 'assistant'` set. That is a
provenance fact, not a different kind of value: the strategy stays
`user-override` because a person chose it, and where the candidate came from is
recorded beside it and stated in `design.md`.

Proposal cards render in the Review queue alongside the engine's own findings,
with their own icon, tone, left rule and an "Assistant suggestion" label, and
they sort *after* every open engine finding. The engine looked at the evidence;
the assistant looked at the engine.

### The provider seam

`assistant/llm.ts` is a narrow interface -- messages plus a response schema in,
validated structured output out -- and `assistant/anthropic.ts` is its only
implementation. Capability code depends on the interface alone, so a hosted
proxy or a second provider is a sibling file rather than a change to any
capability. Key, model and endpoint all come from configuration.

The shared half of a client (`structuredClient`) does the parsing, the reader,
and the redaction; an implementation supplies only a transport and its own
status-to-kind classification. That split is deliberate: redaction living inside
one implementation is a promise the next one has to remember to keep.

### Security

Five properties, each with a test in `apps/server/test/assistant.test.ts`:

- **The key never comes out.** No endpoint returns it. The test scans every
  response body *and* every response header across the whole API surface.
- **The key is redacted from all logs and error messages**, including
  provider-SDK errors that echo auth headers -- and from truncated fragments of
  it, because half a key is still a key. The test forces an auth failure with a
  key-bearing error and asserts the log carries `[redacted]` and not the key.
- **Assistant endpoints are rate-limited server-side.** One budget shared by
  every caller, configurable, defaulting to 20 calls a minute. The guard is
  against a *copied pairing token*: these are the only routes where that costs
  money rather than privacy, and a client-side limit would protect nothing,
  since the client is the part that was copied.
- **Key management is write-only.** `PUT /api/settings` sets or replaces,
  `DELETE /api/settings/llm-key` removes, `GET` reports presence only.
- **The existing guards still apply**: pairing token and CORS lock, both before
  a request reaches an assistant route.

Accepting and dismissing a proposal are deliberately *not* rate-limited: they
reach no provider, and a reviewer working through their queue must never be told
to come back later.

### What leaves the machine

One payload, built in `assistant/context.ts`: the kit's tokens and their
provenance, the contrast pairs, the diagnostics, the standing overrides, and the
user's question. Never the key, never the pairing token, never capture records,
never screenshots, never any other server state. The full list is in the
[README's privacy note](../README.md#what-leaves-your-machine).

### Absence

With no key configured, the Assistant tab shows a setup path -- including the
fact that a Claude subscription does not include API usage, which is the step
nearly everyone is surprised by -- and every other panel feature is fully
functional. A provider error is a notice in that column and nothing else.

### Determinism

Untouched. The assistant writes nothing, and an accepted suggestion is an
ordinary override, so `pnpm skeleton` and every export are byte-identical with
the assistant present or absent as long as no proposal has been accepted.

## Deliberately not built yet

No browser extension. Within the assistant, deliberately absent in v1: chat
history persisted beyond the session, multi-provider support, and autonomous
batch operations -- there is no "fix everything", only single-suggestion cards.

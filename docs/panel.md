# The panel

The workbench: review captures, generate kits, look at the result. It is an
ordinary web app that happens to run locally -- from `npx` or from a container --
and it is written that way on purpose: writing it deployable today is nearly free,
and converting it later would be a rewrite.

```
apps/server/   Node + TypeScript. Storage, API, and the engine run server-side.
apps/panel/    React + Vite + Tailwind + shadcn conventions. The workbench UI.
apps/cli/      The published `ingot-workbench` package. A launcher, nothing more.
```

Either way it exposes **one port**: the server serves the built panel, so the
API and the UI share an origin and there is exactly one address to configure --
the one the browser extension is pointed at
([apps/extension](../apps/extension/README.md)).

## Running it

| | |
| --- | --- |
| `npx ingot-workbench` | The whole thing on `http://127.0.0.1:4310`, nothing installed. The quickstart. |
| `docker compose up` | The same thing in a container. The durable path. |
| `pnpm dev` | Server on 4310, Vite on 5173 with `/api` proxied. Use this to develop. |
| `pnpm build` | Build the panel, then bundle the server into `apps/server/dist`. |
| `pnpm build:cli` | Build the publishable `ingot-workbench` package (`apps/cli`). |

Three ways in, **one server**. `apps/server/src/index.ts` exports `startPanel`,
which binds the port, then opens the data directory, establishes the pairing
token and installs the shutdown handlers -- in that order, so a start that loses
the port to a running panel writes nothing to that panel's library; `docker compose up` and `npx` are two callers of
it that print different things. There is no second configuration system: the CLI
resolves its flags into the `INGOT_*` variables below and `loadConfig` decides
what they mean, so a flag is only a more convenient spelling of a variable and a
variable documented here works under both. The precedence is flag, then
environment, then default (`apps/cli/src/resolve.ts`).

The npx path differs in exactly three defaults, and each is a difference between
a laptop and a container. It serves the panel out of the published tarball
(`dist/panel`), so there is nothing to build. It binds `127.0.0.1` rather than
`0.0.0.0`, because a container has to accept connections from outside itself and a
laptop does not -- a workbench full of someone's captures should not appear on the
coffee-shop wifi because they typed one command. And its data directory is
`~/.ingot` rather than `./data`, because `npx` runs in whatever directory the user
happened to be in and a relative default would scatter one library across many
folders.

It also hands the pairing token to the browser in the URL **fragment**
(`http://127.0.0.1:4310/#token=...`), which is what makes the one-liner need no
copy-paste. A fragment is never sent to a server, never lands in an access log
and never travels in a `Referer`; the panel verifies it against
`/api/pairing/verify`, keeps it only if the server agrees, and strips it from the
address bar either way. The guard below is unchanged -- the token is still
required on every call, and a page on another origin can no more read this
fragment than it could read the panel's `localStorage`.

One data directory serves one panel at a time; a second panel needs its own
`INGOT_DATA_DIR` (or `--data-dir`), not just its own port.

Environment (all optional; see `apps/server/src/config.ts`):

| Variable | Default | |
| -------- | ------- | --- |
| `INGOT_PORT` | `4310` | Also `--port`. |
| `INGOT_HOST` | `0.0.0.0` (`127.0.0.1` under npx) | Also `--host`. |
| `INGOT_DATA_DIR` | `./data` (`/data` in the container, `~/.ingot` under npx) | Database, screenshots, pairing token. Also `--data-dir`. |
| `INGOT_PANEL_DIR` | unset (the packaged panel under npx) | Built panel to serve. Unset means API only. |
| `INGOT_PANEL_ORIGIN` | `http://localhost:5173` | Comma-separated CORS allowlist. |
| `INGOT_PAIRING_TOKEN` | minted on first run | Pin to skip the first-run screen. Also `--token`. A data directory that already stores a different token refuses to start rather than replacing it. |
| `INGOT_LLM_CONNECTION` | unset | Pin the assistant's connection: `claude-cli`, `openai-compatible` or `anthropic-api`. Unset, the server uses whichever is ready. |
| `INGOT_LLM_API_KEY` | unset | Pin the Anthropic key instead of typing it into the panel. Sent only by the Anthropic connection. |
| `INGOT_LLM_ENDPOINT_KEY` | unset | Pin the OpenAI-compatible endpoint's bearer token. Sent only by that connection. |
| `INGOT_LLM_MODEL` | per connection | Pin the assistant's model; otherwise it is a panel setting. |
| `INGOT_LLM_BASE_URL` | unset | The OpenAI-compatible endpoint, or a hosted proxy for the Anthropic connection. The panel-stored endpoint reaches only the OpenAI-compatible connection. |
| `INGOT_CLAUDE_CLI_PATH` | `claude` | Full path to the Claude Code binary, when it is not on the server's PATH. |
| `INGOT_IN_CONTAINER` | set by the image | Declares that host processes are unreachable, which disables the local-CLI connection with an explanation. |
| `INGOT_ASSISTANT_RATE_LIMIT` | `20` | Assistant calls allowed per window. |
| `INGOT_ASSISTANT_RATE_WINDOW_MS` | `60000` | Length of that window. |

## The two guards

**The pairing token.** The panel is a web app on a known local port, so without
a guard any site in any tab could script requests at it and read the user's
captures. The server mints a token on first run, writes it to
`<data>/pairing-token.txt` and logs it; the user pastes it into the first-run
screen, or `npx ingot-workbench` hands it over in the URL fragment as described
above; the panel sends it as `x-ingot-token` on every call. A header is the
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

Two origins are allowed without being configured, and the second is worth
knowing about. Chrome puts `Origin: chrome-extension://<id>` on every request an
MV3 service worker makes -- measured, not assumed -- so the capture extension is
a cross-origin caller like any other, and the lock would refuse it. Its origin
is fixed by the public key pinned in `apps/extension/manifest.json` and allowed
by name, so this is one extension rather than a class of them. Refusing it would
have protected nothing: a web page cannot forge an extension origin, and an
extension that wanted to lie about its own could rewrite the header. The pairing
token is the guard there, as it is for `curl`.
`apps/server/test/api.test.ts` derives the id from the manifest so the constant
and the extension cannot drift apart.

## The LLM keys

There are two -- the Anthropic key and the OpenAI-compatible endpoint's bearer
token, each read only by its own connection ([docs/assistant.md](assistant.md#configuration))
-- and both go in and never come out. `PUT /api/settings` stores, replaces or
clears (`null`) either one server-side, `DELETE /api/settings/llm-key` also
clears the Anthropic key, and `GET /api/settings` reports presence and
provenance only (`configured`, `source`, `endpointKeyConfigured`), beside the
connection, endpoint, model and every connection's readiness -- no endpoint
returns either value, and none ever will. They are server-side precisely
because the browser is where they must not be: an extension, a bookmarklet or a
stray script in the panel's own origin can read anything the page holds.

Both are also redacted from every log line and every error message the
assistant path produces, including provider-SDK errors built from a request
that carried one in a header. See [The assistant](#the-assistant) for the rest.

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

A `design-kit.md` downloaded from the panel is byte-for-byte the one `pnpm skeleton`
writes for the same captures. If that stops being true, the bug is in the
server.

Overrides do not weaken that. A kit row stores the engine's own output --
`tokensJson` and `designKitMd` exactly as `distill` and `renderDesignKitMarkdown`
wrote them -- and the reviewer's values are replayed over it on read
(`effectiveKit` in `src/kit.ts`). A scope with no overrides hands back the
stored strings themselves rather than a re-rendered copy, so "no overrides" is
byte-identical by construction. A scope with overrides gets a document that is
still a pure function of `(stored kit, overrides)`, because `applyOverrides` is
as deterministic as `distill`.

`DESIGN.md` is not on the kit row. It is rendered on demand from the effective
tokens, the way the per-component files are, because it is a pure function of
them and a second stored copy of a kit is a second thing that can fall out of
step with the first. `design-kit.md` is stored rather than rendered for one
reason only: it is the document the determinism guarantee above is written
against, and that guarantee is about the engine's *own* bytes for a kit
version. Both reflect a reviewer's overrides, neither is regenerated to do so.

## The API

Everything except `/api/health` and `/api/pairing*` requires the token.

| | |
| --- | --- |
| `GET /api/health` | Open. Engine version and storage schema version. |
| `GET /api/pairing`, `POST /api/pairing/verify` | Open. Pairing status and token check. |
| `GET/PUT /api/settings` | Panel settings; stores both LLM keys, never returns them. Also the assistant's connection, endpoint and model, and it reports every connection's readiness. |
| `GET/POST /api/captures`, `GET/PATCH/DELETE /api/captures/:id` | Capture CRUD. |
| `POST /api/captures/import` | Bulk import. Accepts a fixture set verbatim, or `{ set }`. |
| `PUT /api/captures/:id/tags`, `GET /api/captures/tags` | Replace a capture's tags; list every tag in use. |
| `PUT/GET /api/captures/:id/screenshot` | Image bytes to the volume, path to the database. |
| `GET/POST /api/groups`, `GET/PATCH/DELETE /api/groups/:id` | Groups. |
| `POST /api/groups/:id/captures`, `DELETE /api/groups/:id/captures/:captureId` | Membership. |
| `POST /api/kits` | Run the engine over a group, the whole library, or an explicit `captureIds` selection. |
| `GET /api/kits`, `GET /api/kits/latest`, `GET /api/kits/:id` | Kit retrieval: the kit, its effective tokens, `design-kit.md`, and the review state behind them. |
| `GET /api/kits/:id/{tokens.json,design-kit.md,DESIGN.md}` | Downloads. |
| `GET /api/kits/:id/components/:component.md` | One component, self-sufficient. |
| `GET /api/export/{tokens.json,design-kit.md,DESIGN.md}`, `GET /api/export/components/:component.md` | The latest kit for a scope, as a file. |
| `GET /api/reviews` | The overrides and accepted decisions for a scope. Answers before a kit exists. |
| `PUT/DELETE /api/reviews/overrides` | Set or clear one token override. Answers with the whole effective kit. |
| `PUT /api/reviews/decisions` | Accept or reopen one decision card. |
| `GET /api/assistant` | Assistant status and this scope's proposals. Reaches no provider; never rate-limited. |
| `POST /api/assistant/suggest` | Run `derive` or `merge`. Stores what the engine would accept as proposals. Rate-limited. |
| `POST /api/assistant/ask`, `/name`, `/rationale` | Content, not kit changes. Rate-limited. |
| `POST /api/assistant/proposals/:id/{accept,dismiss}` | Accept writes an override through the ordinary boundary; dismiss writes nothing to the kit. |
| `DELETE /api/settings/llm-key` | Remove the stored Anthropic key; the endpoint key clears with `PUT { llmEndpointKey: null }`. There is no endpoint that returns either. |
| `POST /api/reset` | Destroy the library. Requires `{ "confirm": "reset" }`. The only endpoint that deletes a kit; settings and pairing survive. |

## The workbench

Three columns, per the approved skeleton: collection on the left, the live
sample UI in the middle, the system on the right. The middle is widest because
the user's real question is "will my app look good", not "am I faithful to the
capture".

### The collection, and curating it

The left column is where a kit's evidence is chosen, and the model it implements
is three words.

- **Library** is the pool. Every capture lands in it, whatever its type and
  wherever it came from; the browser extension will post into the same place.
- **Groups** are named curations *within* the pool, and they are deliberately
  **not exclusive**: a capture can be in several. Deciding which captures belong
  together is the work this product exists for, and a capture that can only be
  in one place makes that decision unrepeatable. Groups are objects here, not
  filters -- open, rename, delete -- and the selected one shows its own name and
  description, which is where an imported set's prose lives.
- **A kit generates from a scope**: the whole library, one group, or an ad-hoc
  **selection**.

The primary journey is collect, curate, distil. Ticking captures raises the
selection bar, which states the count, the **type mix** ("4 buttons · 3 cards ·
2 inputs · 3 type") and three actions: group the selection, generate from it, or
delete it. The mix earns its space because "6 selected" says nothing about
whether the evidence is worth distilling and "6 buttons" says everything.

A selection is a *set*: the server hands the ids to the engine in the library's
own insertion order, so the same captures ticked in any order produce the same
bytes. The kit it makes takes the next **library** version and reviews under the
library scope rather than opening a lineage of its own -- the ruling and its
reason are in [DECISIONS.md](../DECISIONS.md) -- and the kit says so on itself,
because a library kit turning up carrying a decision made on a one-off is not
something a reader should have to discover.

Generating is offered wherever the user already is: the empty middle column
carries its own button, the selection bar carries "Generate from selection", and
the system column keeps the one that regenerates what is on screen. An empty
state that points at a control in another column is an instruction to go looking.

Every destructive action confirms first and **names what survives** --
`apps/panel/src/workbench/ConfirmDialog.tsx`. Deleting a group says its captures
stay and its kits are kept as orphans; deleting captures says the kits already
generated keep their evidence; "Start over" makes the user type the word the API
itself insists on, and is the only path in the product that destroys a kit.

Deleting captures also never touches the kit on display. A kit is an append-only
snapshot of the evidence at the moment it was distilled, so it legitimately
outlives the captures that fed it; re-reading the browsing scope's latest to
decide what to show is how a one-off would silently vanish. When a displayed
kit's contributing captures have since been deleted, the System column says so
in one quiet line -- a note about provenance, not a warning: the kit stays
valid and downloadable, and regenerating is how a reader gets one without them.

### The review loop

The right column is the product, not a settings page. It has four tabs:

- **Review** is the queue. Cards come from three places -- a conflict between a
  standing override and fresh evidence, a diagnostic the engine raised, and a
  dominant choice with a real minority behind it ("16 of 28 corners at 6px,
  runner-up 12px") -- and each carries its evidence and its runner-up as a
  one-click override. Accepting is one click; overriding is one more. A card id
  is derived from the kit's own content, so an acceptance survives regeneration.

  One card is a decision rather than a finding: a kit whose palette carries no
  error colour cannot signal an invalid field in colour, and the card says so
  and offers the two exits -- set `color.roles.destructive`, or acknowledge
  shipping without one. The acknowledgment is an ordinary override, so it is
  durable, it survives regeneration, and it retires only when the reviewer
  clears it. Nothing is blocked while it is open: the card and the kit status
  simply stay unresolved. [docs/tokens.md](tokens.md#states) has the lifecycle.
- **Tokens** is the whole document, group by group. Every value shows its origin
  -- measured, derived, default, contrast-adjusted, yours -- and opens its full
  provenance on demand: contributing captures, every raw value observed, the
  dominant-choice record, any adjustment, and, for an overridden token, the
  engine's own answer it replaced. The colour group also carries the engine's
  own notice when the kit has no error colour, because that is where a reviewer
  is when the question is worth asking.
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
| **derive** | proposal cards | Fills tokens the captures were silent about, where the engine had to state a `sanctioned-default`. It may also propose the error colour a kit has none of, calibrated to the palette it is given -- but never the choice to ship without one, which is refused before the engine is consulted. |
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
recorded beside it and stated in `design-kit.md`.

Proposal cards render in the Review queue alongside the engine's own findings,
with their own icon, tone, left rule and an "Assistant suggestion" label, and
they sort *after* every open engine finding. The engine looked at the evidence;
the assistant looked at the engine.

### The provider seam

`assistant/llm.ts` is a narrow interface -- messages plus a response schema in,
validated structured output out -- and everything above it depends on that
interface alone. Three implementations sit behind it, and `assistant/providers.ts`
is the whole of the dispatch between them:

| | |
| --- | --- |
| `assistant/claude-cli.ts` | The `claude` binary on this machine, headless. No API key: it uses the account it is already signed into. |
| `assistant/openai-compatible.ts` | Anything that speaks `/chat/completions` -- Ollama locally, OpenRouter, Groq, Gemini. `fetch`, no SDK. |
| `assistant/anthropic.ts` | The official SDK and a prepaid key. The only file in the repository that imports an LLM SDK. |

Which one is in force is configuration -- pinned by the environment, chosen in
the panel, or resolved from whichever is ready, in that precedence. Readiness
itself is computed in `assistant/connections.ts`, which is pure: it takes
presence facts (is there a key, is there an endpoint, is the CLI signed in, are
we in a container) and returns a report per connection. The panel renders that
report rather than deriving a second opinion, and the service's own "not set up"
error quotes the same sentence, so the two cannot drift. The setup guide the
reports are written for is [docs/assistant.md](assistant.md).

The shared half of a client (`structuredClient`) does the parsing, the reader,
and the redaction; an implementation supplies only a transport and its own
status-to-kind classification. That split is deliberate: redaction living inside
one implementation is a promise the next one has to remember to keep -- and with
three implementations it is now a promise that would have had to be kept three
times. The secrets a client redacts are the *service's* whole list rather than
its own key, so the connection that has no key of its own still cannot echo the
pairing token.

### Reachability is not the same as configuration

One connection is a process on the host rather than an address, and a container
cannot start one. `assistant/runtime.ts` detects that (the image declares
`INGOT_IN_CONTAINER=1`; `/.dockerenv` and the cgroup are the fallback for a
container somebody else built), and the local-CLI connection is then reported
`unreachable` -- rendered disabled, with a sentence, rather than hidden. Hiding
it would read as "Ingot does not have that"; the truth is "that one is for
`pnpm dev`", which is what a person comparing the two run paths needs to know.
It is also refused server-side, so setting it deliberately in a container fails
with the same explanation rather than spawning nothing.

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
  `DELETE /api/settings/llm-key` removes, `GET` reports presence only. The
  *endpoint* is deliberately readable -- it is not a secret, and a typo in it
  has to be visible to be fixed.
- **A key goes only where it was saved.** The Anthropic key and the
  OpenAI-compatible endpoint's bearer token are separate settings, each read
  only by its own connection, and the panel-stored endpoint URL reaches only
  the OpenAI-compatible connection. Switching connections carries no credential
  and no endpoint across, so a stored Anthropic key is never sent as a bearer
  token to whatever endpoint somebody pointed the OpenAI-compatible connection
  at.
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

With no usable connection, the Assistant tab shows a connection picker and the
setup path for whichever is selected -- including, on the Anthropic one, the
fact that a Claude subscription does not include API usage, which is the step
nearly everyone is surprised by. Every other panel feature is fully functional.
A provider error is a notice in that column and nothing else.

Absence is increasingly rare by design: a machine with Claude Code installed and
signed in has a working assistant with no setup at all, because "whichever
connection is ready" resolves to it.

### Determinism

Untouched. The assistant writes nothing, and an accepted suggestion is an
ordinary override, so `pnpm skeleton` and every export are byte-identical with
the assistant present or absent as long as no proposal has been accepted.

## Deliberately not built yet

Within the assistant, deliberately absent: chat history persisted beyond the
session, streaming (every operation is one request and one structured answer),
and autonomous batch operations -- there is no "fix everything", only
single-suggestion cards.

# Ingot

Design-kit distillation workbench. Capture UI components while browsing, distill
them into a coherent token-driven design kit, export it LLM-ready.

Ingot is not a one-click extractor -- those exist. The bet is **cross-site
distillation quality**: taking a pile of components captured from several places
and resolving them into one design system that actually holds together, with
every decision traceable and overridable.

## What is in this repository today

The deterministic distillation engine, proven end to end on fixture data, and
the workbench that stands on it: a local web app -- one `npx` command, or a
container -- where you import
captures, generate a kit, review every decision the engine made, override the
ones you disagree with, and watch the preview, the docs and every export turn
together -- with an LLM assistant in the right column that proposes names, fills
gaps and spots duplicates, and can never write a token. And in front of it, the
Chrome extension that fills the library: pick a component on any page and it
arrives in the panel with its screenshot.

```
packages/engine/   the distillation core -- pure, no DOM, no I/O, no network
apps/server/       panel server: storage behind an interface, API, engine host
apps/panel/        the workbench UI -- React, Vite, Tailwind, shadcn conventions
apps/extension/    the Chrome capture extension -- MV3, no framework, loads unpacked
apps/cli/          the published `ingot-workbench` package: `npx` starts the panel
fixtures/          four hand-authored capture sets standing in for real captures
examples/          generated tokens.json + design-kit.md + DESIGN.md, committed as evidence
schemas/           normative JSON Schema for both formats
docs/              format, storage and panel documentation
scripts/skeleton.ts  fixtures -> examples
```

## Quick start

```bash
npx ingot-workbench
```

That is the whole setup. It starts the panel on <http://127.0.0.1:4310> and opens
it, already paired. **No account, no sign-up, no Docker, no database to
provision** -- the library is a SQLite file in `~/.ingot`, and nothing leaves your
machine unless you turn the optional [assistant](#the-assistant-optional) on.
Ctrl-C stops it; run it again and your library is where you left it.

> The npm name `ingot` belongs to an unrelated, abandoned 2014 package, so the
> published package carries the product's other word. The command it installs is
> `ingot`.

Needs Node 22+. `--port`, `--data-dir`, `--host` and `--no-open` are there when
you need them (`npx ingot-workbench --help`), and so is every `INGOT_*`
environment variable in [docs/panel.md](docs/panel.md#running-it); flags win.
One data directory serves one panel at a time: to run a second panel, give it its
own `--data-dir`.
For a long-lived install -- a pinned image, a managed volume, a restart policy --
use [Docker](#the-durable-path-docker) instead. It is the same server either way.

### First kit

**Paste a capture set** on the left, paste
[`fixtures/ghost-warm/set.json`](fixtures/ghost-warm/set.json), **Generate kit**
on the right. The middle column renders a sample screen entirely from the kit's
tokens, and switches to a browsable component-library documentation view drawn
by the same components. The right column is the review queue: every diagnostic
and every close call the engine made, with its evidence and the runner-up as a
one-click override -- and every token in the kit, with its provenance, editable
in place. The downloaded `design-kit.md` is byte-for-byte the one `pnpm skeleton`
writes for the same captures, until you override something, and then it says
what you changed and what the engine had chosen.

Two whole-kit documents come out, and they are for different readers.
`design-kit.md` is the full specification -- provenance, override history,
contrast evidence, the states a kit has to be explicit about -- written for an
LLM building against the kit. `DESIGN.md` is the same kit stated in the
[Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md),
an open specification with its own linter, for any agent that already reads that
standard; save it at a repository root under that exact name. Ingot's own
document is deliberately the richer of the two, and is not narrowed to fit the
spec -- see [DECISIONS.md](DECISIONS.md#hard-boundaries-v1-scope).

### The durable path: Docker

`npx` is the fastest way in and the right one for trying Ingot, working through a
kit, or running it now and then. Reach for Docker when the panel should be a
fixture rather than a command you remember: a pinned image, a volume with a
backup story, and a process that comes back after a reboot.

```bash
docker compose up
```

Same panel on <http://localhost:4310>, same API, same data format. One container,
one port, one volume (`/data`: the database, screenshots and the pairing token).
It prints a **pairing token** on first start -- paste that into the panel's
first-run screen, because a container cannot open your browser for you the way
the CLI does. (It is also in `pairing-token.txt` on the volume;
`docker compose logs panel` if you scrolled past it.)

The two differ in exactly three defaults, each a difference between a laptop and
a container: the npx path binds `127.0.0.1` rather than `0.0.0.0`, keeps its data
in `~/.ingot` rather than `./data` (the volume at `/data` in the container), and
serves the panel from the packaged `dist/panel`. Everything else -- the engine,
the storage schema, the guards, every `INGOT_*` variable -- is shared code. A
library written by one is readable by the other if you point them at the same
directory.

### The extension

```bash
pnpm build:extension
```

Then **chrome://extensions** -> **Developer mode** -> **Load unpacked** ->
`apps/extension/dist`. Put the panel address and the pairing token into the
extension's options page, click the toolbar button on any page, and pick
components: hover outlines one, click confirms the type, save sends it to the
panel with a screenshot of its box. With the panel down they queue in the
browser -- across a restart -- and drain in order when it comes back.

It reads the computed styles of the one element you click and nothing else:
never the page's markup, text or stylesheets. Capture is reference-grade by
decision, and the full posture, the permission-by-permission justification and
the load instructions are in
[apps/extension/README.md](apps/extension/README.md).

### The assistant (optional)

The right column's **Assistant** tab proposes token values, drafts the reason
behind an override, names the kit's palette and answers questions about it from
its own provenance. Everything it proposes arrives as a card in the review queue
beside the engine's own findings; you accept or dismiss it, and it can never
write a token itself. **Every other feature works without it.**

It needs a model to ask, and there are three ways to give it one. With nothing
configured the panel uses whichever is ready, in this order (a CLI signed in
with a Console key is billed per call, so a ready endpoint is preferred to it):

1. **The Claude Code CLI you already have.** If `claude` is on this machine and
   signed in, that is the whole setup — no API key, nothing billed per call,
   your existing subscription. Available on the local run (`pnpm dev`); a
   container cannot start a process on your machine, and the panel says so
   rather than offering a button that cannot work.
2. **Any OpenAI-compatible endpoint.** Ollama on your laptop (nothing leaves the
   machine at all), or OpenRouter, Groq and Gemini, which have free tiers.
3. **An Anthropic API key.** About $0.03 a suggestion, and there is one thing
   worth knowing before you go looking for one:

> **A Claude subscription does not include API usage.** Claude Pro and Max pay
> for claude.ai. The API is billed separately, from prepaid credit on an
> [Anthropic Console](https://console.anthropic.com) account. Having one does
> not give you the other — which is exactly why option 1 exists.

The server rate-limits assistant calls whichever connection is in use, so a
mistake cannot become a bill. A key is stored server-side, never returned to the
browser, and redacted from every log and error message.

Setup for all three, including the free tiers and the Docker caveats:
**[docs/assistant.md](docs/assistant.md)**. What Ingot sends is written out
below.

### What leaves your machine

Nothing leaves this machine unless you use the assistant. When you do, exactly
one payload goes to whichever connection you configured -- and with a model
running locally under Ollama, it does not leave the machine even then. It is
built in
[`apps/server/src/assistant/context.ts`](apps/server/src/assistant/context.ts):

**Sent:**

- the kit's identity -- set id, name, description, capture count, the origins
  that contributed and how many captures each, and which component types were
  captured;
- every overridable token: path, kind, current value, and its provenance --
  strategy, the dominant-choice sentence, and the most-observed raw values;
- the contrast pairs the engine guarantees, with their ratios;
- the diagnostics the engine raised;
- your standing overrides -- path, value and the reason you wrote;
- your question, for Q&A;
- the prompt template for the capability, which is in code and versioned.

The extension is the other part of Ingot that talks to the network, and it talks
to one address: the panel you configured. What it reads off a page and what it
sends is written out in
[apps/extension/README.md](apps/extension/README.md#what-it-reads-and-what-it-sends).

**Never sent:**

- **the API key** -- it is an HTTP header handled by the provider client, and it
  is not in this payload at any point. On the local Claude CLI connection there
  is no key at all: it is signed in, not keyed;
- **the pairing token**, or any other server state -- no settings, no other
  groups, no other kits;
- **capture records** -- the raw captures carry full CSS declarations, DOM
  context and source URLs; the assistant is asked about the distillation of
  them, so the records themselves have no reason to travel;
- **screenshots** -- they never leave the data volume, and the assistant is not
  shown images at all.

Origins (`stripe.com`, `linear.app`) *are* included: they are already in every
`design-kit.md` you export, and "eleven captures from one site and three from
another" is a large part of what makes a naming or merge suggestion sensible.
Anthropic's API terms apply to what is sent; run the panel without a key if that
is not a trade you want to make.

### Development

```bash
pnpm install
pnpm dev         # server on :4310, panel on :5173 with /api proxied
pnpm test        # unit, schema, determinism, storage, API, panel and extension suites
pnpm skeleton    # regenerate examples/ from fixtures/
```

Requires Node 20+ and pnpm 10.

| Command | What it does |
| ------- | ------------ |
| `pnpm dev` | The server, the panel, and the extension's watch build, outside Docker. |
| `pnpm build` | Build the panel, bundle the server. |
| `pnpm build:extension` | Build the unpacked Chrome extension into `apps/extension/dist`. |
| `pnpm build:cli` | Build the panel, then bundle the publishable `ingot-workbench` package. |
| `pnpm pack:cli` | Pack that package into a tarball, to try `npx ./<tarball>` before publishing. |
| `pnpm test` | The whole suite, across engine, extension, server and panel. |
| `pnpm typecheck` | `tsc --noEmit` across the workspace. |
| `pnpm skeleton` | Distil every fixture set into `examples/<set>/`. |
| `pnpm skeleton --check` | Regenerate in memory and fail on any drift. This is the determinism check. |

## The pipeline

```
capture set (JSON)
      |
      |  validate against the capture schema
      v
  distill()          pure: same input -> byte-identical output
      |
      +--> tokens.json     stack-agnostic tokens, every one carrying provenance
      |
      +--> design-kit.md   Tailwind v4 + shadcn/ui spec, written for an LLM to implement against
      |
      +--> DESIGN.md       the Google Labs DESIGN.md format, for any agent that reads the standard
      |
      +--> <component>.md  one control, self-sufficient: its rules plus the tokens it needs
      |
      +--> docs.html       the browsable kit documentation, one file, opens from file://
```

Between the engine and the exports sits the review: a reviewer overriding a
token in the panel replaces the engine's answer, and every artefact above is
rendered from the result. An override is a first-class provenance state that
survives regeneration -- when fresh captures disagree with it, the disagreement
is reported and the override keeps the value. See
[docs/tokens.md](docs/tokens.md#overrides).

The assistant sits beside that review rather than inside it. It proposes; the
engine checks every proposed value against its own guardrails before a card is
ever shown; a person accepts or dismisses. An accepted suggestion becomes an
ordinary override through the same write path, carrying a record of where the
candidate came from, which `design-kit.md` states. There is no path from the
assistant to a token that does not pass through a human.

Read [`examples/linear-dark/design-kit.md`](examples/linear-dark/design-kit.md) for what
comes out the far end, and
[`examples/messy-mixed/tokens.json`](examples/messy-mixed/tokens.json) for what
provenance looks like when the engine had to work for it.

### What the engine decides

- **Colour.** Converts to OKLCH, merges perceptual near-duplicates, assigns a
  small semantic role set (`background`, `surface`, `border`, `text`,
  `textMuted`, `primary`, ...), derives the interaction and state shades, and
  enforces a WCAG contrast floor on every pair it puts on screen -- 4.5:1 for
  text, a stated 3:1 for the disabled pair, the derived hover, pressed and
  selected surfaces included -- adjusting lightness, then chroma, and recording
  exactly what it changed.
- **Spacing.** Picks one base unit from the evidence and snaps every observed
  length onto it, then continues the series into a layout band past the largest
  observation so page rhythm has somewhere on-scale to live. Component steps
  stop at the largest observed length; layout steps say they are extrapolated.
- **Radius, shadows, typography.** Dominant-choice selection over the observed
  values, with missing steps derived rather than invented.
- **Components.** One height, padding pair, radius step, type step and weight for
  each of button (per variant), input, select, table header and row, and badge,
  plus the disabled, selected and focus-ring states. Measured from the captures
  where they reach, borrowed from a sibling recipe where they do not, and stated
  as a sanctioned default where nothing implies an answer -- distinguishable per
  value, so nothing is left for a consumer to invent.

Every token records the captures that produced it, every raw value that was
observed, and a machine-readable dominant-choice record -- `"12 of 28 corners at
8px (runner-up 12px, 8)"` -- which is what the panel renders as a decision card,
with the runner-up as a one-click override.

Full format documentation: [`docs/capture-record.md`](docs/capture-record.md)
and [`docs/tokens.md`](docs/tokens.md). The `DESIGN.md` target and what it can
and cannot carry: [`docs/design-md.md`](docs/design-md.md). The panel that
drives it: [`docs/panel.md`](docs/panel.md); the storage seam behind it:
[`docs/storage.md`](docs/storage.md); connecting the assistant to a model:
[`docs/assistant.md`](docs/assistant.md).

## The fixture sets

Hand-authored, no scraping. Each emulates a coherent real-world source style.

| Set | What it exercises |
| --- | ----------------- |
| [`linear-dark`](fixtures/linear-dark/set.json) | A coherent dark product UI. Dark-mode detection, borders doing all the separation, a single brand colour, one shadow extended into a scale. |
| [`stripe-light`](fixtures/stripe-light/set.json) | A coherent light product UI. A tinted panel surface, layered shadows, a monospace stack, and a red used only for errors becoming `destructive`. |
| [`ghost-warm`](fixtures/ghost-warm/set.json) | A coherent warm editorial UI. Warm off-white paper and sand panels, an evergreen brand, a reading type scale deliberately larger than the control type scale, near-duplicate sand and border tints that clustering merges, and optical paddings that snapping resolves. |
| [`messy-mixed`](fixtures/messy-mixed/set.json) | Ten components from five unrelated sites. Near-duplicate greys, a brand blue captured twice, off-scale padding, two serif faces fighting three sans stacks, and two colour pairs that fail WCAG before distillation. |

### The quality bar

Kits are judged by one question: *would I ship a real page built against only
this `design-kit.md`?* That bar applies to the **three coherent sets** --
`ghost-warm`, `linear-dark` and `stripe-light`. They are three deliberately
different subjects (warm editorial, dark dense, light commerce), so a kit that
only works for one style cannot pass by accident.

`messy-mixed` is **not** held to it. It is the smoke test for incoherent input:
its job is to degrade legibly and warn loudly -- accurate diagnostics, honest
provenance, no silent invention -- not to look good. Judging it on ship quality
measures the fixture, not the engine.

`test/snapshots.test.ts` encodes the split: the coherent sets must distil with
zero warning diagnostics, `messy-mixed` must produce some. One warning is
allowed through on a coherent set, `color.no-destructive`, and only where it is
true: a set whose captures carry no red has no error colour, the engine will not
invent a brand colour, and saying so is the point rather than a defect.

That is also where the bar has an explicit edge. A kit's error state clears it
with **either** a destructive colour **or** a reviewer's recorded acknowledgment
that the kit ships without one -- an acknowledgment the workbench asks for by
name, having first stated the consequence. A kit with neither is measured as
unresolved, not as passing. See [DECISIONS.md](DECISIONS.md#quality-bar).

## Design constraints

- **`packages/engine` is portable.** No DOM, browser or extension APIs, no
  filesystem, no network, no clock, no randomness. That is what lets the same
  code run in the extension, in the panel and in CI.
  `packages/engine/test/purity.test.ts` enforces it by reading the engine's own
  source.
- **The token model is stack-agnostic.** Tailwind and shadcn specificity lives
  only in `packages/engine/src/export/design-kit-md.ts`, and the DESIGN.md
  format's vocabulary only in `design-md-spec.ts` beside it. Further export
  targets are siblings of those files, not changes to the token shape.
- **Determinism is a hard guarantee**, not a nice-to-have. See
  [`docs/tokens.md#determinism`](docs/tokens.md#determinism).
- **Dependencies stay small and boring.** The engine depends on
  [culori](https://culorijs.org/) and nothing else. The server adds hono,
  better-sqlite3 and the Anthropic SDK; the panel adds React, Vite and Tailwind.
  The other two assistant connections added no dependency at all -- one is
  `fetch`, the other is `spawn`.
  No ORM, no auth framework -- the pairing guard is a header check.
- **The assistant advises; it never decides.** The engine's deterministic core
  -- colour maths, contrast, scales, conflict determination -- is never the
  LLM's job. The LLM does the parts that are language, and everything it
  proposes is checked by the engine and then by a person.
  [docs/panel.md](docs/panel.md#the-assistant).
- **Which model answers is configuration, not architecture.** One narrow
  `LlmClient` interface, three implementations behind it: the local Claude Code
  CLI, any OpenAI-compatible endpoint, and the Anthropic API. No capability
  knows which is in use. [docs/assistant.md](docs/assistant.md).
- **Storage sits behind an interface.** SQLite runs the container today;
  Postgres is an adapter, not a rewrite. The contract, and what a second adapter
  has to honour, is in [docs/storage.md](docs/storage.md).
- **The panel is a normal web app.** It runs locally -- from `npx` or from a
  container, the same server either way -- and is deployable later without being
  rewritten, which is nearly free to do today and expensive to retrofit.
  [docs/panel.md](docs/panel.md).
- **Distribution leads with `npx`, and Docker is the durable path.** The
  one-liner is the front door because a first run that needs Docker loses people
  who would have liked the product; the container is what a long-lived install
  should be. Neither is a fork of the other: `apps/cli` is a launcher over the
  same `startPanel`, so there is one server to reason about.
  [DECISIONS.md](DECISIONS.md#distribution).

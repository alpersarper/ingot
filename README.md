# Ingot

Design-kit distillation workbench. Capture UI components while browsing, distill
them into a coherent token-driven design kit, export it LLM-ready.

Ingot is not a one-click extractor -- those exist. The bet is **cross-site
distillation quality**: taking a pile of components captured from several places
and resolving them into one design system that actually holds together, with
every decision traceable and overridable.

## What is in this repository today

The deterministic distillation engine, proven end to end on fixture data, and
the workbench that stands on it: a local web app in Docker where you import
captures, generate a kit, review every decision the engine made, override the
ones you disagree with, and watch the preview, the docs and every export turn
together -- with an LLM assistant in the right column that proposes names, fills
gaps and spots duplicates, and can never write a token. The browser extension is
**not** here yet -- see
[docs/panel.md](docs/panel.md#deliberately-not-built-yet).

```
packages/engine/   the distillation core -- pure, no DOM, no I/O, no network
apps/server/       panel server: storage behind an interface, API, engine host
apps/panel/        the workbench UI -- React, Vite, Tailwind, shadcn conventions
fixtures/          four hand-authored capture sets standing in for real captures
examples/          generated tokens.json + design.md, committed as evidence
schemas/           normative JSON Schema for both formats
docs/              format, storage and panel documentation
scripts/skeleton.ts  fixtures -> examples
```

## Quick start

### The panel

```bash
docker compose up
```

Then open <http://localhost:4310>. The server prints a **pairing token** on first
start -- paste it into the panel's first-run screen. (It is also in
`pairing-token.txt` on the data volume; `docker compose logs panel` if you
scrolled past it.)

From there: **Paste a capture set** on the left, paste
[`fixtures/ghost-warm/set.json`](fixtures/ghost-warm/set.json), **Generate kit**
on the right. The middle column renders a sample screen entirely from the kit's
tokens, and switches to a browsable component-library documentation view drawn
by the same components. The right column is the review queue: every diagnostic
and every close call the engine made, with its evidence and the runner-up as a
one-click override -- and every token in the kit, with its provenance, editable
in place. The downloaded `design.md` is byte-for-byte the one `pnpm skeleton`
writes for the same captures, until you override something, and then it says
what you changed and what the engine had chosen.

One container, one port, one volume (`/data`: the database, screenshots and the
pairing token).

### The assistant (optional)

The right column's **Assistant** tab proposes token values, drafts the reason
behind an override, names the kit's palette and answers questions about it from
its own provenance. Everything it proposes arrives as a card in the review queue
beside the engine's own findings; you accept or dismiss it, and it can never
write a token itself. **Every other feature works without it.**

It needs an Anthropic API key, and there is one thing worth knowing before you
look for one:

> **A Claude subscription does not include API usage.** Claude Pro and Max pay
> for claude.ai. The API is billed separately, from prepaid credit on an
> [Anthropic Console](https://console.anthropic.com) account. Having one does
> not give you the other.

So: sign in at <https://console.anthropic.com> (the Console, not claude.ai), add
credit under **Billing**, create a key under **API keys**, and paste it into the
Assistant tab. One suggestion costs about **$0.03** at the default model
(`claude-sonnet-5`); **$5 of credit is ample** for working through a kit many
times over. The server also rate-limits assistant calls, so a mistake cannot
become a bill.

The key is stored server-side, is never returned to the browser, and is redacted
from every log and error message. What Ingot sends to Anthropic is written out
below.

### What leaves your machine

Nothing leaves this machine unless you use the assistant. When you do, exactly
one payload goes to the Anthropic API, built in
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

**Never sent:**

- **the API key** -- it is an HTTP header handled by the SDK, and it is not in
  this payload at any point;
- **the pairing token**, or any other server state -- no settings, no other
  groups, no other kits;
- **capture records** -- the raw captures carry full CSS declarations, DOM
  context and source URLs; the assistant is asked about the distillation of
  them, so the records themselves have no reason to travel;
- **screenshots** -- they never leave the data volume, and the assistant is not
  shown images at all.

Origins (`stripe.com`, `linear.app`) *are* included: they are already in every
`design.md` you export, and "eleven captures from one site and three from
another" is a large part of what makes a naming or merge suggestion sensible.
Anthropic's API terms apply to what is sent; run the panel without a key if that
is not a trade you want to make.

### Development

```bash
pnpm install
pnpm dev         # server on :4310, panel on :5173 with /api proxied
pnpm test        # unit, schema, determinism, storage, API and panel suites
pnpm skeleton    # regenerate examples/ from fixtures/
```

Requires Node 20+ and pnpm 10.

| Command | What it does |
| ------- | ------------ |
| `pnpm dev` | The server and the panel, outside Docker. |
| `pnpm build` | Build the panel, bundle the server. |
| `pnpm test` | The whole suite, across engine, server and panel. |
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
      +--> tokens.json    stack-agnostic tokens, every one carrying provenance
      |
      +--> design.md      Tailwind v4 + shadcn/ui spec, written for an LLM to implement against
      |
      +--> <component>.md one control, self-sufficient: its rules plus the tokens it needs
      |
      +--> docs.html      the browsable kit documentation, one file, opens from file://
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
candidate came from, which `design.md` states. There is no path from the
assistant to a token that does not pass through a human.

Read [`examples/linear-dark/design.md`](examples/linear-dark/design.md) for what
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
and [`docs/tokens.md`](docs/tokens.md). The panel that drives it:
[`docs/panel.md`](docs/panel.md); the storage seam behind it:
[`docs/storage.md`](docs/storage.md).

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
this `design.md`?* That bar applies to the **three coherent sets** --
`ghost-warm`, `linear-dark` and `stripe-light`. They are three deliberately
different subjects (warm editorial, dark dense, light commerce), so a kit that
only works for one style cannot pass by accident.

`messy-mixed` is **not** held to it. It is the smoke test for incoherent input:
its job is to degrade legibly and warn loudly -- accurate diagnostics, honest
provenance, no silent invention -- not to look good. Judging it on ship quality
measures the fixture, not the engine.

`test/snapshots.test.ts` encodes the split: the coherent sets must distil with
zero warning diagnostics, `messy-mixed` must produce some.

## Design constraints

- **`packages/engine` is portable.** No DOM, browser or extension APIs, no
  filesystem, no network, no clock, no randomness. That is what lets the same
  code run in the extension, in the panel and in CI.
  `packages/engine/test/purity.test.ts` enforces it by reading the engine's own
  source.
- **The token model is stack-agnostic.** Tailwind and shadcn specificity lives
  only in `packages/engine/src/export/design-md.ts`. More export targets will be
  siblings of that file, not changes to the token shape.
- **Determinism is a hard guarantee**, not a nice-to-have. See
  [`docs/tokens.md#determinism`](docs/tokens.md#determinism).
- **Dependencies stay small and boring.** The engine depends on
  [culori](https://culorijs.org/) and nothing else. The server adds hono,
  better-sqlite3 and the Anthropic SDK; the panel adds React, Vite and Tailwind.
  No ORM, no auth framework -- the pairing guard is a header check.
- **The assistant advises; it never decides.** The engine's deterministic core
  -- colour maths, contrast, scales, conflict determination -- is never the
  LLM's job. The LLM does the parts that are language, and everything it
  proposes is checked by the engine and then by a person.
  [docs/panel.md](docs/panel.md#the-assistant).
- **Storage sits behind an interface.** SQLite runs the container today;
  Postgres is an adapter, not a rewrite. The contract, and what a second adapter
  has to honour, is in [docs/storage.md](docs/storage.md).
- **The panel is a normal web app.** It runs locally in Docker now and is
  deployable later without being rewritten, which is nearly free to do today and
  expensive to retrofit. [docs/panel.md](docs/panel.md).

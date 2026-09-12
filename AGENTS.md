# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## What Ingot is

A design-kit distillation workbench: capture UI components while browsing, distill
them into one coherent token-driven design kit, export it LLM-ready. The product
bet is **cross-site distillation quality**, not one-click extraction. Read
[README.md](README.md) for scope and what is deliberately not built yet.
[DECISIONS.md](DECISIONS.md) is the decision register: the settled product,
scope, quality-bar and architecture rulings, and why they hold.

Two halves: `packages/engine` decides, and the panel (`apps/server` +
`apps/panel`) is where a human reviews those decisions -- and overrides them,
which is the experience rather than an escape hatch. The panel is an ordinary
web app that currently runs locally in Docker -- [docs/panel.md](docs/panel.md).
The LLM assistant is a third thing beside those two: it advises, and it is the
only part of the product that is allowed to be wrong on purpose.

## Commands

`pnpm install` (Node 20+, pnpm 10), then `pnpm test`, `pnpm typecheck`,
`pnpm skeleton`, `pnpm skeleton --check`, `pnpm dev`, `pnpm build`. See the
table in the README. `docker compose up` runs the whole panel on one port.

## Non-negotiables

These are enforced by tests; breaking one fails CI rather than showing up later.

- **`packages/engine` is portable and pure.** No DOM, browser or extension APIs,
  no filesystem, no network, no clock, no randomness. I/O belongs in
  `scripts/`. Enforced by `packages/engine/test/purity.test.ts`, which reads the
  engine's own source. Watch for accidental shadowing of host globals -- a
  parameter named `document` trips this check, correctly.
- **Determinism.** Same capture set in, byte-identical `tokens.json` and
  `design.md` out. No timestamps in output, explicit locale-independent
  comparators on every sort, one rounding helper for every emitted number.
  Rationale and the full rule list: [docs/tokens.md](docs/tokens.md#determinism).
  The assistant does not weaken this: it writes nothing, and an accepted
  suggestion is an ordinary override, so every export is byte-identical with the
  assistant present or absent until a proposal is accepted.
- **The token model stays stack-agnostic.** Tailwind and shadcn naming lives only
  in `packages/engine/src/export/`. New export targets are siblings of
  `design-md.ts`, never changes to `packages/engine/src/tokens/types.ts`.
- **An override is provenance, not an annotation.** `applyOverrides`
  (`packages/engine/src/tokens/overrides.ts`) is as pure and as deterministic as
  `distill`, and it lives in the engine because the panel previews an override
  and the server replays it on every read. It re-checks what the override
  invalidated (contrast pairs, derived control heights), and when fresh evidence
  disagrees with a standing override it **reports** the conflict and leaves the
  override in force -- neither side is silently clobbered.
  `tokenSlots(tokens)` is the contract between engine and panel: a path the
  panel offers but the engine cannot write is an edit that silently does nothing.
  Which of the three documents answers which question -- pristine for evidence,
  **baseline** (every *other* override replayed) for conflict, convergence and
  redundancy, effective for rendering and export -- is a type rather than a
  convention, in `packages/engine/src/tokens/documents.ts`. The baseline never
  leaves the engine, and neither does the choice: `applyOverrides` returns the
  effective document **with a report** (conflicts and the engine value each was
  judged against, retirements, convergences, refusals) and `planOverrideWrite`
  returns the row one write should store. Callers persist and state that report;
  a route or an export that works out a conflict, a retirement or an answered
  value of its own is the defect this seam exists to make impossible.
  Rules: [docs/tokens.md](docs/tokens.md#overrides).
- **One renderer, three surfaces.** The canonical components in
  `apps/panel/src/preview/components/` draw the live preview, the in-panel docs
  and the static docs export; the prose and token subsets all three show come
  from `packages/engine/src/export/component-doc.ts`, which also writes the
  per-component markdown. A second render path or a second copy of the prose is
  how a docs page starts documenting a button nobody ships.
- **Determinism survives the server path.** A `design.md` downloaded from the
  panel is byte-identical to the one `pnpm skeleton` writes from the same
  captures. Records are stored and replayed verbatim, capture order comes from
  group membership positions, and set metadata comes from the group. Enforced by
  `apps/server/test/kit-determinism.test.ts` against the committed `examples/`;
  if it fails, the bug is in the server, never in `examples/`. Overrides do not
  weaken it: a kit row stores the engine's own bytes and `effectiveKit()` replays
  the reviewer's values on read, short-circuiting to the stored strings when
  there are none.
- **Storage stays behind `apps/server/src/storage/store.ts`.** Async methods, no
  transaction handle across the seam, total ordering on every list. A Postgres
  adapter must be a new file under `storage/` plus one line in
  `apps/server/test/storage-contract.ts` -- the contract suite is written against
  the interface, so adding a `Store` method means adding its cases there in the
  same commit. Rationale: [docs/storage.md](docs/storage.md).
- **The two guards on the API are the pairing token and the CORS lock.** Every
  route except `/api/health` and `/api/pairing*` requires `x-ingot-token`, and
  the open list in `apps/server/src/routes/pairing.ts` is an allowlist rather
  than a matter of route registration order. The LLM API key goes in and never
  comes out: no endpoint returns it, and `apps/server/test/api.test.ts` asserts
  that on the response bodies.
- **The preview and the docs have no hardcoded values.** Every visual property in
  `canonical.css` and `docs.css` is a `var(--kit-*)` fed by `kit-css.ts` -- no
  colour, no length, no font size, not even as a fallback. A literal would put a
  value on screen that the exported `design.md` never mentions, which is the one
  thing that makes a preview lie, and it is invisible in review because the panel
  still looks fine. `apps/panel/test/canonical-css.test.ts` reads both
  stylesheets and enforces it. Values a real screen needs but no token names --
  a card's radius, the gap between sections, the size of a field label -- are
  *composed* in `kitComposition()` from steps the kit actually carries, which is
  what `design.md` tells a consumer to do; they never become literals in the CSS.
  The panel's own chrome uses a separate shadcn variable set, so a dark kit in a
  light panel renders as itself. The kit docs are deliberately set *in* the kit.
- **Every token carries provenance.** Contributing capture ids, every raw value
  observed, and a machine-readable dominant-choice record. The panel renders
  these as decision cards and overrides, so a token without one is a bug. The
  `strategy` distinguishes measured from computed from `sanctioned-default` --
  a value the engine supplied because nothing implied one -- from `user-override`,
  a value a human set. Keep that split intact: it is what lets a reader know
  which numbers to argue with. An override never rewrites `observed`; it carries
  the decision it replaced in `supersedes`.
- **The kit answers, or says it is guessing -- it never goes quiet.** Silence is
  what makes two consumers of one kit ship two different products, so a control
  with no evidence gets a stated default rather than no entry, and a state the
  palette cannot draw (see `color.state-collapsed`) says so out loud. The one
  thing the engine will not default is a brand decision: no captured red means
  no `destructive` and no destructive button.
- **The assistant advises; it never decides, and it has no write path.** The
  engine's deterministic core -- colour maths, contrast, scales, conflict
  determination -- is never the LLM's job; the LLM does the parts that are
  language. Every value it proposes goes through `checkProposals`
  (`apps/server/src/assistant/proposals.ts`), which runs the real
  `applyOverrides` over a throwaway copy, so a candidate the engine will not
  take never becomes a card. Accepting a card is `planOverrideWrite` plus
  `store.reviews.setOverride` -- the same two calls the Tokens editor makes --
  with `suggestedBy: 'assistant'`, which is a record of where the *candidate*
  came from and not a different kind of decision: the strategy stays
  `user-override` because a person chose it. A second route into a token, or a
  proposal shown without an engine check behind it, is the defect this seam
  exists to make impossible. `packages/engine` imports nothing of it, and
  `purity.test.ts` would fail if it did.
- **The provider is behind one narrow interface.** `assistant/llm.ts` takes
  messages plus a response schema and returns validated structured output;
  `assistant/anthropic.ts` is its only implementation and the only file in the
  repository that imports an LLM SDK. Capability code depends on the interface
  alone. `structuredClient` in the seam does the parsing and, crucially, the
  **redaction**: an implementation supplies only a transport, so redaction is a
  property of the seam rather than a promise the next provider has to remember.
  Prompt templates live in `assistant/prompts.ts`, in code, versioned, and the
  version travels with every proposal.
- **The API key goes in and never comes out, and that is tested by scanning.**
  No endpoint returns it; it is redacted -- with a visible `[redacted]` marker,
  including from truncated fragments -- from every log and error message,
  provider-SDK errors included. Assistant endpoints are rate-limited
  server-side, because they are the only ones where a copied pairing token costs
  money rather than privacy. Each property has a test in
  `apps/server/test/assistant.test.ts`; adding an assistant route means adding
  it to the response-surface scan and the unauthenticated-paths list there.
- **Contrast coverage is part of the guarantee, not just the maths.** Every pair
  the kit puts on screen is enforced and reported, derived hover/pressed/selected
  surfaces included, in two passes -- base roles first, then the shades that only
  exist afterwards. A derived shade yields to a foreground pinned at a gamut
  pole; a foreground re-enforced in pass two is re-checked against the union of
  its old and new backgrounds so an earlier guarantee cannot reopen. Adding a
  role means asking what it sits on. Full rules:
  [docs/tokens.md](docs/tokens.md#contrast-floor).

## Changing a heuristic

Distillation rules are tuned constantly; the workflow is fixed:

1. Change the rule, and update the prose rule description in
   [docs/tokens.md](docs/tokens.md) in the same commit -- `design.md` quotes some
   of them verbatim.
2. `pnpm skeleton` and commit the regenerated `examples/` alongside the code.
   `pnpm skeleton --check` fails CI if they disagree.
3. `pnpm vitest -u` to refresh `test/__snapshots__/`, then **read the snapshot
   diff**: it is deliberately a summary of decisions rather than whole documents,
   so the diff is the review surface for a tuning change.

Bumping `ENGINE_VERSION` in `packages/engine/src/version.ts` changes the bytes of
every example -- regenerate in the same commit.

## Fixture sets

`fixtures/ghost-warm`, `fixtures/linear-dark` and `fixtures/stripe-light` are the
coherent sets and are expected to distil with **zero warning diagnostics**;
`fixtures/messy-mixed` is deliberately incoherent and carries the interesting
failure paths (contrast adjustment, near-duplicate merging, off-scale snapping).
`test/snapshots.test.ts` asserts that split, so a change that makes a coherent
set start warning is a signal, not noise. Adding a set:
[docs/capture-record.md](docs/capture-record.md#adding-a-fixture-set).

**The quality bar is the three coherent sets.** "Would I ship a real page built
against only this `design.md`?" is asked of `ghost-warm`, `linear-dark` and
`stripe-light`, which are three deliberately different subjects so no single
style can carry the engine. `messy-mixed` is exempt by design: it is judged on
degrading legibly and warning loudly, never on ship quality. Full statement:
[README.md](README.md#the-quality-bar).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

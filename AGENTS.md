# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## What Ingot is

A design-kit distillation workbench: capture UI components while browsing, distill
them into one coherent token-driven design kit, export it LLM-ready. The product
bet is **cross-site distillation quality**, not one-click extraction. Read
[README.md](README.md) for scope and what is deliberately not built yet.

## Commands

`pnpm install` (Node 20+, pnpm 10), then `pnpm test`, `pnpm typecheck`,
`pnpm skeleton`, `pnpm skeleton --check`. See the table in the README.

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
- **The token model stays stack-agnostic.** Tailwind and shadcn naming lives only
  in `packages/engine/src/export/design-md.ts`. New export targets are siblings
  of that file, never changes to `packages/engine/src/tokens/types.ts`.
- **Every token carries provenance.** Contributing capture ids, every raw value
  observed, and a machine-readable dominant-choice record. The panel will render
  these as decisions and overrides, so a token without one is a bug. The
  `strategy` distinguishes measured from computed from `sanctioned-default` --
  a value the engine supplied because nothing implied one. Keep that three-way
  split intact: it is what lets a reader know which numbers to argue with.
- **The kit answers, or says it is guessing -- it never goes quiet.** Silence is
  what makes two consumers of one kit ship two different products, so a control
  with no evidence gets a stated default rather than no entry, and a state the
  palette cannot draw (see `color.state-collapsed`) says so out loud. The one
  thing the engine will not default is a brand decision: no captured red means
  no `destructive` and no destructive button.
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

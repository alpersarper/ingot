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
  these as decisions and overrides, so a token without one is a bug.

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

`fixtures/linear-dark` and `fixtures/stripe-light` are the coherent sets and are
expected to distil with **zero warning diagnostics**; `fixtures/messy-mixed` is
deliberately incoherent and carries the interesting failure paths (contrast
adjustment, near-duplicate merging, off-scale snapping). `test/snapshots.test.ts`
asserts that split, so a change that makes a coherent set start warning is a
signal, not noise. Adding a set: [docs/capture-record.md](docs/capture-record.md#adding-a-fixture-set).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

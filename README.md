# Ingot

Design-kit distillation workbench. Capture UI components while browsing, distill
them into a coherent token-driven design kit, export it LLM-ready.

Ingot is not a one-click extractor -- those exist. The bet is **cross-site
distillation quality**: taking a pile of components captured from several places
and resolving them into one design system that actually holds together, with
every decision traceable and overridable.

## What is in this repository today

This is the walking skeleton: the deterministic distillation engine, proven end
to end on fixture data. The browser extension, the local panel, the Docker setup
and any LLM integration are **not** here yet.

```
packages/engine/   the distillation core -- pure, no DOM, no I/O, no network
fixtures/          three hand-authored capture sets standing in for real captures
examples/          generated tokens.json + design.md, committed as evidence
schemas/           normative JSON Schema for both formats
docs/              format documentation
scripts/skeleton.ts  fixtures -> examples
```

## Quick start

```bash
pnpm install
pnpm test        # unit, schema, determinism and snapshot suites
pnpm skeleton    # regenerate examples/ from fixtures/
```

Requires Node 20+ and pnpm 10.

| Command | What it does |
| ------- | ------------ |
| `pnpm test` | The whole suite. |
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
```

Read [`examples/linear-dark/design.md`](examples/linear-dark/design.md) for what
comes out the far end, and
[`examples/messy-mixed/tokens.json`](examples/messy-mixed/tokens.json) for what
provenance looks like when the engine had to work for it.

### What the engine decides

- **Colour.** Converts to OKLCH, merges perceptual near-duplicates, assigns a
  small semantic role set (`background`, `surface`, `border`, `text`,
  `textMuted`, `primary`, ...), derives the interaction shades, and enforces a
  4.5:1 WCAG floor on every text/background pair -- adjusting lightness and
  recording exactly what it changed.
- **Spacing.** Picks one base unit from the evidence and snaps every observed
  length onto it, documenting the rule and flagging how much it had to rewrite.
- **Radius, shadows, typography.** Dominant-choice selection over the observed
  values, with missing steps derived rather than invented.

Every token records the captures that produced it, every raw value that was
observed, and a machine-readable dominant-choice record -- `"12 of 28 corners at
8px (runner-up 12px, 8)"` -- so the panel can render the decision and offer the
runner-up as a one-click override.

Full format documentation: [`docs/capture-record.md`](docs/capture-record.md)
and [`docs/tokens.md`](docs/tokens.md).

## The fixture sets

Hand-authored, no scraping. Each emulates a coherent real-world source style.

| Set | What it exercises |
| --- | ----------------- |
| [`linear-dark`](fixtures/linear-dark/set.json) | A coherent dark product UI. Dark-mode detection, borders doing all the separation, a single brand colour, one shadow extended into a scale. |
| [`stripe-light`](fixtures/stripe-light/set.json) | A coherent light product UI. A tinted panel surface, layered shadows, a monospace stack, and a red used only for errors becoming `destructive`. |
| [`messy-mixed`](fixtures/messy-mixed/set.json) | Ten components from five unrelated sites. Near-duplicate greys, a brand blue captured twice, off-scale padding, two serif faces fighting three sans stacks, and two colour pairs that fail WCAG before distillation. |

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
  [culori](https://culorijs.org/) and nothing else.

# The `DESIGN.md` export

Ingot exports two whole-kit documents, and they answer different questions.

| | `design-kit.md` | `DESIGN.md` |
| --- | --- | --- |
| Owner | Ingot | [google-labs-code/design.md](https://github.com/google-labs-code/design.md), Apache-2.0 |
| Reader | an LLM building against *this* kit | any agent that reads the open format |
| Carries | provenance, override history, contrast evidence, diagnostics, the Tailwind/shadcn theme block | the tokens, the prose sections the spec defines, and nothing the spec has no vocabulary for |
| Generator | `packages/engine/src/export/design-kit-md.ts` | `packages/engine/src/export/design-md-spec.ts` |
| Storage | stored on the kit row; the determinism guarantee is written against it | rendered on demand from the effective tokens |

Ingot's own document is deliberately the richer of the two and is **not**
narrowed to fit the spec. The ruling and its reasoning are in
[DECISIONS.md](../DECISIONS.md#hard-boundaries-v1-scope).

## Verifying conformance

Conformance is the specification's own linter's opinion, not ours.

```bash
pnpm skeleton                                   # regenerate examples/
pnpm exec design.md lint examples/linear-dark/DESIGN.md
```

`@google/design.md` is pinned in the root `devDependencies`, and
`test/design-md-spec.test.ts` runs it as a subprocess over all four committed
examples as part of `pnpm test`. The bar is **zero errors**. Surviving warnings
are asserted by rule and path, so a new *kind* of warning fails the suite rather
than quietly becoming the new normal.

The emitted schema version is `DESIGN_MD_SPEC_VERSION` in
`design-md-spec.ts`. It is the spec's value, not Ingot's: bump it only alongside
a run of the linter at the newer version.

## How the token model maps

| Ingot | `DESIGN.md` |
| --- | --- |
| `color.roles.*` | `colors.*`, kebab-cased (`selectedSurface` → `surface-selected`) |
| `typography.steps` | `typography.text-<step>` |
| a recipe's `typeStep` + `fontWeight` | `typography.text-<step>-<weight>`, when the two disagree |
| `radius.steps` | `rounded.*` — the names already match the spec's |
| `spacing.steps` | `spacing.*`, keyed by the step's own opaque name |
| `components.recipes[]` | `components.<name with dots → dashes>` |
| a recipe's `hoverSurface` | a `<component>-hover` variant key |
| `primaryActive`, for a `primary`-filled control | a `<component>-active` variant key |
| `components.states.selected` | `table-row-selected` |
| `components.states.disabled` | `control-disabled` |

Roughly half of Ingot's recipes are set in a weight their size step is not — a
button is the base step in medium, a table header the small step in semibold.
The spec's `typography` sub-token references a whole composite, so pointing a
button at `text-base` would ship it lighter than the kit specifies. The
combinations the recipes actually use become tokens of their own instead.

## What the spec cannot carry

The spec's component sub-tokens are a closed list — `backgroundColor`,
`textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width` —
and there is no token group for shadows or focus rings. Those values are stated
in the document's prose rather than dropped, or smuggled into a key a
conforming reader would ignore.

Two lint warnings survive every kit as a result, both on purpose:

- **`orphaned-tokens` on `colors.border`.** No component key can reference a
  border colour, so the linter is right that nothing does. The token stays
  because the kit has one; the Components section says which controls draw it.
- **`contrast-ratio` on `control-disabled`.** Ingot holds the disabled pair to
  `DISABLED_CONTRAST_FLOOR` rather than `CONTRAST_FLOOR`, because a disabled
  control that reads as ordinary body text is not disabled. WCAG 1.4.3 exempts
  inactive components from the minimum outright; the linter does not model the
  exemption. Emitting it anyway is the lesser evil — demoting the state to prose
  leaves a consuming agent with no machine-readable disabled colours, and the
  thing it reaches for next is an opacity ramp, which cannot be contrast-checked
  and measures 1:1 on a light kit.

`messy-mixed` carries one further contrast warning, and unlike those two it is a
real finding: its `primary` fill measures 4.4993:1 against `primary-foreground`
when the ratio is computed on the emitted hex, where the engine's own
enforcement lands it at exactly the 4.5 floor. Closing that half-thousandth gap
means moving the contrast floor itself, which re-renders every example — so it
is recorded here and in `test/design-md-spec.test.ts` rather than papered over.

## Shared prose

`errorSignalGuidance` (`export/error-signal.ts`) is the single owner of
everything any Ingot artifact says about drawing an error, and
`collapsedShadesSentence` (`color/roles.ts`) of what it says about states a
reader cannot tell apart. Both are written for `design-kit.md`: dotted recipe
names, section numbers, camelCase colour-role names. `inSpecNames` in
`design-md-spec.ts` translates all three into this document's naming on the way
out — the role renames come from `COLOR_TOKEN_NAMES`, the same map that names
the front-matter tokens, so the prose and the tokens cannot drift apart.
Forking the prose per target would be how the two documents start describing two
different kits to the same reader.

## Adding another export target

A new target is a sibling module in `packages/engine/src/export/`, never a
change to `tokens/types.ts`. If it targets an outside specification, its test
runs that specification's own validator rather than a snapshot of what the
generator happens to emit — see `test/design-md-spec.test.ts` for the shape.

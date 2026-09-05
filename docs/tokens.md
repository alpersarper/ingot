# Tokens document schema (version 1)

`tokens.json` is the distilled design system for one capture set. It is
**stack-agnostic**: nothing in it names Tailwind, shadcn or CSS variables. That
specificity lives entirely in the export layer
([`packages/engine/src/export/design-md.ts`](../packages/engine/src/export/design-md.ts)),
so adding an export target never means changing this shape.

- Normative machine-readable schema: [`schemas/tokens.schema.json`](../schemas/tokens.schema.json)
- TypeScript types: [`packages/engine/src/tokens/types.ts`](../packages/engine/src/tokens/types.ts)
- Worked examples: [`examples/*/tokens.json`](../examples)

## Determinism

`distill(set)` is a pure function. Same input, byte-identical output --
forever, on any machine.

Concretely:

- No filesystem, no network, no clock, no randomness. Enforced by
  `packages/engine/test/purity.test.ts`, which reads the engine's own source and
  fails on `node:*` imports, host globals, `Date.now`, `new Date` and
  `Math.random`.
- **No `generatedAt` field.** A timestamp would make every regeneration a diff
  and destroy the guarantee. `engine.version` identifies the producer instead.
- Every sort passes an explicit, locale-independent comparator ending in a total
  tie-breaker, so an even split resolves the same way everywhere.
- Every number that reaches the output is rounded through one helper, which also
  normalises `-0` to `0`.
- Object key order is fixed by construction, not by input order.

`test/determinism.test.ts` checks this three ways: repeated runs, reordered
input, and drift against the committed `examples/`.

## Provenance

**Every token carries provenance.** This is the point of the format: the panel
has to be able to show why a value won and offer the alternatives as one-click
overrides, so the record is machine-readable and the English `summary` is a
convenience on top of it.

```jsonc
"provenance": {
  "captureIds": ["linear-btn-primary", "linear-btn-secondary"],  // sorted; empty when derived
  "observed": [                                  // every distinct raw value, most frequent first
    { "value": "8px", "count": 12, "captureIds": ["linear-btn-primary", "..."] },
    { "value": "12px", "count": 8, "captureIds": ["linear-card-issue"] }
  ],
  "decision": {
    "strategy": "dominant-value",
    "chosen": "8px",
    "chosenCount": 12,
    "totalCount": 28,
    "confidence": 0.429,                         // chosenCount / totalCount, 3 dp
    "competitors": [{ "value": "12px", "count": 8 }, { "value": "6px", "count": 8 }],
    "summary": "12 of 28 corners at 8px (runner-up 12px, 8)"
  }
}
```

`count` is the number of individual style **declarations** carrying the value,
not the number of captures: one card contributes four corner radii.

### Strategies

| `strategy` | Meaning |
| ---------- | ------- |
| `dominant-value` | The most frequently observed raw value won outright. |
| `snapped-scale` | Observed values were snapped onto the base scale; this step is where they landed. `chosen` is the snapped value and is often not one anybody wrote. |
| `cluster-representative` | Perceptually near-duplicate values were merged; the representative stands for the cluster. |
| `role-assignment` | A colour cluster was given a semantic role by the role heuristics. `summary` names the rule that fired. |
| `derived` | Nothing suitable was observed; the value was computed. Carries a `derivation`. |

### Derivations

```jsonc
"derivation": {
  "method": "oklch-lightness-offset",            // stable algorithm identifier
  "from": ["color.roles.primary"],               // token paths this was computed from
  "detail": "primary lightness +0.04 (dark mode moves lighter on interaction), yielding #6976e0"
}
```

## Document shape

```jsonc
{
  "schemaVersion": 1,
  "engine": { "name": "ingot-engine", "version": "0.1.0" },
  "source": { /* set id, name, description, capture ids, origins, component-type counts */ },
  "color":      { "mode", "roles", "contrast", "palette" },
  "spacing":    { "baseUnit", "unit", "snappingRule", "fit", "steps" },
  "border":     { "unit", "width" },
  "radius":     { "unit", "steps" },
  "shadow":     { "steps" },
  "typography": { "families", "baseSize", "scaleRatio", "weights", "steps" },
  "diagnostics": [ /* things a human should look at */ ]
}
```

### `color`

`mode` is `light` or `dark`, decided from the lightness of the observed
**background** colours weighted by frequency. Foreground colours are excluded: a
dark page with a lot of white text is still a dark page.

`roles` is a deliberately small semantic set. `background`, `surface`,
`surfaceHover`, `border`, `text`, `textMuted`, `primary`, `primaryHover`,
`primaryActive` and `primaryForeground` are always present. `destructive` and
`destructiveForeground` appear only when the captures actually contain a red
signal colour -- inventing one would be inventing a design decision.

Every role value is given as `oklch(L C H)` plus an sRGB `hex` fallback and the
decomposed `lightness`/`chroma`/`hue`.

`palette` lists **every** colour cluster considered, including the ones no role
claimed (`"role": null`), with the near-duplicates each cluster absorbed in
`mergedFrom`. This is what lets the panel offer "use this colour instead".

#### How roles are assigned

1. Colours are read per channel (`background`, `foreground`, `border`) and
   clustered so perceptually identical values merge. Clustering is leader
   clustering in OKLab against a running centroid, radius `0.012` -- roughly the
   point where two flat swatches stop being separable side by side. Comparing
   against the centroid rather than any member stops a long ramp of
   near-neighbours from chaining into one cluster. A cluster is represented by
   the member that most often *filled* something: between `#0b76ef` on a button
   and `#0a74ec` on a link, the fill is the brand colour and the tint is the
   accident.
2. `background`: the most extreme low-chroma background colour -- darkest in a
   dark set, lightest in a light one. Frequency only breaks ties.
3. `surface`: the neutral background colour nearest the page background but at
   least 0.015 lightness away from it. *Nearest*, not *second most extreme*, so a
   stray dark panel on a light page cannot claim the role.
4. `text`: the most used neutral foreground clearing 7:1 against the background
   (relaxed to 4.5:1, then to any, if nothing qualifies). Frequency leads because
   body text is by definition what most of the page is set in; the contrast band
   is what stops a rare white label on a brand button from winning just for being
   furthest away.
5. `textMuted`: the most used neutral foreground between `text` and
   `background`, and at least 0.1 lightness from both. Without that separation a
   set with two near-identical dark greys would emit one as text and the other
   as "muted", which is not a distinction anyone can see.
6. `border`: the most used neutral border colour, read only from captures that
   actually draw a border.
7. `primary`: the saturated colour that fills a surface most often, then the one
   used most overall, then the most saturated.
8. `primaryForeground`: a colour observed on top of the primary colour, else
   whichever of black or white contrasts better.
9. `destructive`: a saturated colour in the red hue window, if one was observed.
10. Anything still missing is derived from what was claimed, and the interaction
    shades (`surfaceHover`, `primaryHover`, `primaryActive`) are always derived
    by moving OKLCH lightness toward the viewer -- lighter on dark, darker on
    light. Hover and pressed states are almost never in a static capture, and
    computing them consistently beats guessing from one stray observation.

Chroma at or below `0.05` counts as neutral, which admits a deliberately tinted
grey like `#1a1f36` (chroma 0.044) while excluding every real brand colour.

#### Contrast floor

The engine will not emit a text/background pair below **4.5:1** (WCAG 2.1 AA,
normal text). Guaranteed pairs: `text` and `textMuted` against both `background`
and `surface`, `primaryForeground` against `primary`, and
`destructiveForeground` against `destructive`.

When a pair fails, the foreground's OKLCH lightness walks away from the
background in 0.005 steps until the pair passes -- hue and chroma never move. If
the foreground reaches the gamut boundary without clearing the floor (white on a
mid-blue, for instance), the *background* moves instead, which preserves the
brand hue at the cost of a small lightness nudge. If neither works, the
adjustment records `"met": false` and a `color.contrast-unmet` warning is
raised rather than the failure being hidden.

Every change is recorded on the token as `contrastAdjustment` (before, after,
both ratios, the delta, and a prose reason), and `color.contrast` reports the
final ratio of every guaranteed pair.

### `spacing`

`baseUnit` is chosen from `[8, 4]`, largest first: the first candidate whose
**fit** -- the share of non-zero observed lengths that are already exact
multiples of it -- reaches `0.85` wins. Nothing smaller than 4px is considered,
because below that a "scale" stops constraining anything. If neither clears the
threshold the engine falls back to 4px and raises a `spacing.low-fit` warning
saying what fraction of the source spacing snapping rewrote.

`snappingRule` states the rule in prose so the exported spec can quote it
verbatim:

> Each observed padding, margin and gap length is snapped to the nearest
> multiple of the base unit; exact `.5` ties round up. A non-zero length shorter
> than half the base unit snaps up to one base unit rather than collapsing to 0,
> because a visible gap must stay visible. Steps are named by their multiplier,
> so step `"3"` is 3 x the base unit.

Snapping *is* the clustering: lengths that land on the same multiple are the same
step, and each step's `observed` lists the raw values it absorbed. Gaps in the
resulting sequence are filled (up to multiple 12) so the scale is contiguous;
filled steps are marked `derived` with method `scale-gap-fill`.

### `radius`

The three most frequently observed corner radii form the scale, with ties broken
toward the median so a three-way tie yields the middle value rather than an
arbitrary end. Size then names them `sm`/`md`/`lg`, so `md` always sits between
its neighbours even when it was not the single most common value. `none` is
always present; `full` appears only when a pill (>= 999px) was captured. Missing
neighbours are derived by halving and doubling `md`, and dropped values are
reported as a `radius.truncated` diagnostic.

### `shadow`

Shadows are parsed into layers and normalised to `rgb(R G B / A)` so equivalent
notations compare equal. `elevation` -- the sum of `|offsetY| + blur + spread`
across layers -- orders the steps. The three most frequently observed shadows are
kept, then ordered by elevation into `sm`/`md`/`lg`; missing neighbours are
scaled from `md`. `inset` shadows are excluded: an inner shadow is not a point on
an elevation scale. A set whose sources use no shadows gets only `none` and an
explanatory diagnostic -- no elevation scale is invented from nothing.

### `typography`

Sizes are **never snapped**. Unlike spacing, a 15px heading is a deliberate
typographic choice rather than a rounding error, and merging it would silently
rewrite the source's voice. The most used size becomes `base`; observed sizes
fill outward into `sm`/`xs` below and `lg`/`xl`/`2xl`/`3xl`/`4xl` above. Sizes
that do not fit are dropped with a diagnostic, and adjacent steps within 10% of
each other raise a `typography.adjacent-sizes` warning.

Line heights are converted to unitless ratios. Font families are split into
`sans` and an optional `mono` by name.

### `diagnostics`

Notes for the operator, sorted warnings-first then by code. `warning` means a
human should look before shipping; `info` records something the engine did that
is worth knowing. Codes are stable identifiers:

| Code | Level | Meaning |
| ---- | ----- | ------- |
| `color.contrast-adjusted` | info | A role's lightness moved to meet the floor. |
| `color.contrast-unmet` | warning | A pair still fails the floor after both escape hatches. |
| `color.unassigned` | info | Captured colours that no role claimed. |
| `spacing.low-fit` | warning | No base unit fit well; how much snapping rewrote. |
| `spacing.snapped` | info | Which lengths moved, largest moves first. |
| `radius.truncated` | info | Radii dropped to keep the scale at three steps. |
| `shadow.none-observed` | info | No shadows captured; no elevation scale derived. |
| `shadow.truncated` | info | Shadows dropped to keep the scale at three steps. |
| `shadow.unparsed` | warning | A shadow value could not be read (inset or unsupported). |
| `typography.adjacent-sizes` | warning | Two steps closer than 10%. |
| `typography.sizes-dropped` | info | Sizes beyond the scale's capacity. |
| `typography.single-size` | warning | One size observed; the scale was extended geometrically. |
| `typography.no-family` / `typography.no-sizes` | warning | Nothing captured; fell back to defaults. |

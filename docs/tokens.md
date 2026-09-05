# Tokens document schema (version 2)

`tokens.json` is the distilled design system for one capture set. It is
**stack-agnostic**: nothing in it names Tailwind, shadcn or CSS variables. That
specificity lives entirely in the export layer
([`packages/engine/src/export/design-md.ts`](../packages/engine/src/export/design-md.ts)),
so adding an export target never means changing this shape.

- Normative machine-readable schema: [`schemas/tokens.schema.json`](../schemas/tokens.schema.json)
- TypeScript types: [`packages/engine/src/tokens/types.ts`](../packages/engine/src/tokens/types.ts)
- Worked examples: [`examples/*/tokens.json`](../examples)

Version 2 (engine 0.2.0) added the `components` section, the three state colour
roles, and the `component`/`layout` banding on the spacing scale. Version 1
described colour, type, spacing, radius, shadow and border and stopped there,
which meant `design.md` could not say what a button was even in principle --
so every consumer invented its own control geometry, its own disabled state and
its own page rhythm.

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
| `derived` | Nothing suitable was observed; the value was computed from another token. Carries a `derivation`. |
| `sanctioned-default` | Nothing was observed **and** nothing else in the document implied the value, so the engine supplied one of its own. Carries a `derivation` and never any `captureIds`. Kept separate from `derived` because the two carry different authority: a derived value is a consequence of this kit, a default is the engine's house choice and is the first thing a reviewer should feel free to override. |

### Derivations

```jsonc
"derivation": {
  "method": "oklch-lightness-offset",            // stable algorithm identifier
  "from": ["color.roles.primary"],               // token paths this was computed from
  "detail": "primary hover state: primary lightness +0.04 (dark mode moves lighter on interaction), yielding #6976e0"
}
```

## Document shape

```jsonc
{
  "schemaVersion": 2,
  "engine": { "name": "ingot-engine", "version": "0.2.0" },
  "source": { /* set id, name, description, capture ids, origins, component-type counts */ },
  "color":      { "mode", "roles", "contrast", "palette" },
  "spacing":    { "baseUnit", "unit", "snappingRule", "layoutRule", "fit", "largestObservedMultiple", "steps" },
  "border":     { "unit", "width" },
  "radius":     { "unit", "steps" },
  "shadow":     { "steps" },
  "typography": { "families", "baseSize", "scaleRatio", "weights", "steps" },
  "components": { "states", "recipes" },
  "diagnostics": [ /* things a human should look at */ ]
}
```

### `color`

`mode` is `light` or `dark`, decided from the lightness of the observed
**background** colours weighted by frequency. Foreground colours are excluded: a
dark page with a lot of white text is still a dark page.

`roles` is a deliberately small semantic set. `background`, `surface`,
`surfaceHover`, `selectedSurface`, `border`, `text`, `textMuted`, `primary`,
`primaryHover`, `primaryActive`, `primaryForeground`, `disabledSurface` and
`disabledForeground` are always present. `destructive` and
`destructiveForeground` appear only when the captures actually contain a red
signal colour -- inventing one would be inventing a design decision.

`selectedSurface`, `disabledSurface` and `disabledForeground` are **real
colours, never an opacity ramp**. An opacity ramp cannot be contrast-checked,
and it is what a consumer reaches for when the kit is silent: `opacity: 0.5` on
a label over a 50% fill measures 1:1 on a light kit and the label disappears.

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
    and state shades are always derived, because hover, pressed, selected and
    disabled are almost never in a static capture and computing them
    consistently beats guessing from one stray observation:
    - `surfaceHover` (+/-0.03), `primaryHover` (+/-0.04), `primaryActive`
      (+/-0.08) and `disabledSurface` (+/-0.06) move OKLCH lightness toward the
      viewer -- lighter on dark, darker on light.
    - `selectedSurface` moves `surface` by 0.02 and carries the **primary hue**
      at chroma capped to the neutral threshold, so selection reads by hue where
      hover reads by lightness and the two stay distinguishable side by side.
    - `disabledForeground` interpolates `textMuted` 40% toward `disabledSurface`
      so the control reads inactive, and the contrast floor stops it going
      further.
    Derivation happens *after* contrast enforcement has settled the base roles,
    so a hover state never drifts away from the colour it is a state of.

Chroma at or below `0.05` counts as neutral, which admits a deliberately tinted
grey like `#1a1f36` (chroma 0.044) while excluding every real brand colour.

#### Contrast floor

The engine will not emit a text/background pair below **4.5:1** (WCAG 2.1 AA,
normal text). The guarantee is enforced in two passes, because half of the pairs
involve colours that do not exist until the first pass has finished.

**Pass one, over the roles the captures supplied:**

| Foreground | Backgrounds |
| ---------- | ----------- |
| `text` | `background`, `surface` |
| `textMuted` | `background`, `surface` |
| `primaryForeground` | `primary` |
| `destructive` | `background`, `surface` |
| `destructiveForeground` | `destructive` |

`destructive` is there as a *foreground*: the exported spec presents it as an
error-text colour as well as a fill, so it has to be legible on the surfaces
error text lands on. It is enforced before `destructiveForeground` so that pair
sees the settled value rather than the captured one.

**Pass two, over the derived interaction and state surfaces**, which are
computed only after pass one has settled their base roles:

| Foreground | Backgrounds | Floor | Which side moves |
| ---------- | ----------- | ----- | ---------------- |
| `primaryForeground` | `primaryHover`, `primaryActive` | 4.5 | the shade |
| `text` | `surfaceHover`, `selectedSurface` | 4.5 | the foreground |
| `textMuted` | `surfaceHover`, `selectedSurface` | 4.5 | the foreground |
| `disabledForeground` | `disabledSurface` | **3** | the foreground |

A derived shade is an offset of a role that already passed, and an offset is not
a guarantee. On a dark kit the hover lift moves a brand fill *toward* its white
label, so before pass two existed every interaction made the label worse:
linear-dark measured 3.99:1 on hover and 3.38:1 when pressed, under a heading
claiming 4.5:1.

A foreground moved in pass two is re-enforced against the **union** of its old
and new backgrounds, so closing a new gap can never reopen an old one, and the
`contrastAdjustment` records merge -- the record still names the captured value
as its origin and reports the whole journey in one reason.

The disabled pair is held to **3:1**, not 4.5:1. WCAG 2.1 exempts inactive
controls from 1.4.3, and a disabled label that clears the body-text floor stops
reading as disabled. 3:1 is WCAG's own non-text threshold and is far above the
1:1 an opacity ramp produces.

When a pair fails, the foreground's OKLCH lightness walks away from the
background in 0.005 steps until the pair passes -- hue and chroma never move. If
the foreground reaches the gamut boundary without clearing the floor (white on a
mid-blue, for instance), the *background* moves instead, which preserves the
brand hue at the cost of a small lightness nudge. If lightness runs out there
too, **chroma** takes over: it changes luminance without touching the lightness
coordinate, and hue, which is the brand, still never moves. If none of that
works, the adjustment records `"met": false` and a `color.contrast-unmet`
warning is raised rather than the failure being hidden.

Holding a shade at the floor can consume the whole offset it was derived with.
When that leaves a shade rendering identically to its base -- linear-dark's
`primaryHover` and `primaryActive` both land on the same hex, because a white
label on that indigo has no room to move -- a `color.state-collapsed` diagnostic
says so, and `design.md` tells the consumer to signal that state with something
other than the fill. The alternative was two tokens with one value under prose
claiming they differ.

Every change is recorded on the token as `contrastAdjustment` (before, after,
both ratios, the delta, and a prose reason), and `color.contrast` reports the
final ratio and the floor of every guaranteed pair. The decision `summary` names
the shipped value too: a role that won its slot as `#0b76ef` and was then
darkened to `#0373ec` says both, so provenance never hands the reader a hex the
rest of the document calls inaccessible.

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

#### The two bands

Every step carries a `band`, and `largestObservedMultiple` is the boundary.

- **`component`** -- at or below the largest observed length. A capture is one
  component, so this is as far as the evidence can ever reach: across all three
  fixture sets the largest observation is a card's own 24px padding.
- **`layout`** -- extrapolated past it, at `32`, `40`, `48` and `64px`. Both
  candidate base units divide all four exactly, so the layout band is the same
  multiplier series continued rather than a second scale. Layout steps carry no
  `captureIds` and are marked `derived` with method `layout-scale-extension`.

The layout band exists because the exported spec forbids off-scale values while
the component band tops out at component-internal padding. Without it, page
gutters, section rhythm and the gap between two cards all collapsed onto the same
24px, and every generated screen read as flat and cramped. `layoutRule` states
the split in prose so `design.md` can quote it verbatim, and the exported spec
tells the consumer which band to reach for where.

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
notations compare equal. The decision record counts support in those normalised
terms: `chosen` is the canonical css (like a snapped spacing value, often not a
string anybody wrote), every raw notation that normalises to it counts as
support rather than a competitor, and the raw strings stay in `observed`. `elevation` -- the sum of `|offsetY| + blur + spread`
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

### `components`

The section that turns a palette document into a design-system document. The
scales above say which values exist; this says how they compose, so two
independent consumers of one kit cannot ship two different control scales.

#### `recipes`

One entry per control, in a fixed order: `button.primary`, `button.secondary`,
`button.ghost`, `button.destructive` (only when the kit has a destructive
colour), `input`, `select`, `table.header`, `table.row`, `badge`.

Each carries `height`, `paddingY`, `paddingX`, `radius` (a step **name**, so the
value tracks `radius.steps`), `typeStep` (likewise, so size and line height stay
together), `fontWeight`, and a `colors` object of token paths into
`color.roles`. `height` is the border-box sum -- `paddingY x 2 + line box +
border x 2` -- and is recomputable from the recipe's own parts, so a consumer
that adds them up lands on the stated number.

Three sources of authority, distinguishable **per value** from the token's own
`provenance.decision.strategy`:

| Where it came from | Strategy | Example |
| ------------------ | -------- | ------- |
| measured in the captures | `snapped-scale` / `dominant-value` | button padding: captured buttons carry padding and font size |
| borrowed from another recipe | `derived`, method `same-geometry-as` | `select` takes the geometry of `input`; a table cell takes its padding, because a cell is a text container at the same optical density |
| supplied by the engine | `sanctioned-default`, method `component-default` | badge padding, table radius: nothing in a capture set describes either |

Padding is snapped onto the spacing scale with the same rule the scale itself
used, so a recipe can never name an off-scale length. `design.md` prints the mix
per recipe in a `From` column.

Where derivation is impossible the engine emits a stated default rather than
silence, because silence is what makes two consumers ship two products. The one
exception is `button.destructive`, which is omitted when the kit has no
destructive colour: geometry can be defaulted, a brand decision cannot.

#### `states`

`focusRing` carries the geometry every consumer was otherwise inventing --
`width` (twice the border width, floored at 2px) and `offset` (2px, a house
value) -- and names the colour role via `colorRole` rather than duplicating the
colour.

`disabled` and `selected` likewise reference `color.roles` by path. `disabled`
also reports the final measured `ratio` and the `floor` it was held to, so the
pair a consumer would otherwise have built from `opacity: 0.5` is a checked one.

### `diagnostics`

Notes for the operator, sorted warnings-first then by code. `warning` means a
human should look before shipping; `info` records something the engine did that
is worth knowing. Codes are stable identifiers:

| Code | Level | Meaning |
| ---- | ----- | ------- |
| `color.contrast-adjusted` | info | A role's lightness or chroma moved to meet its floor. |
| `color.contrast-unmet` | warning | A pair still fails its floor after every escape hatch. |
| `color.state-collapsed` | info | Holding a pair at its floor left a derived shade rendering identically to the role it came from. |
| `color.unassigned` | info | Captured colours that no role claimed. |
| `components.defaulted` | info | Controls nothing in the captures or the rest of the kit described; each carries a sanctioned default. |
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

# Capture record schema (version 1)

A **capture record** is what the browser extension emits for one captured UI
component. A **capture set** is a coherent group of them that get distilled
together into one design system.

- Normative machine-readable schema: [`schemas/capture-record.schema.json`](../schemas/capture-record.schema.json)
- TypeScript types: [`packages/engine/src/capture/types.ts`](../packages/engine/src/capture/types.ts)
- Runtime validator (better error messages, same rules): [`packages/engine/src/capture/validate.ts`](../packages/engine/src/capture/validate.ts)
- Worked examples: [`fixtures/*/set.json`](../fixtures)

`test/schema.test.ts` validates every fixture against the JSON Schema, and
`packages/engine/test/validate.test.ts` covers the runtime validator, so the two
descriptions cannot drift apart silently.

## Set

```jsonc
{
  "schemaVersion": 1,
  "id": "linear-dark",              // slug; must equal the fixture directory name
  "name": "Linear-like dark product UI",
  "description": "One or two sentences describing the source style.",
  "captures": [ /* one or more capture records */ ]
}
```

`id` becomes the output directory name under `examples/`. `name` and
`description` are reproduced verbatim at the top of the generated `design.md`,
so write them for the developer who will read the spec.

## Record

```jsonc
{
  "schemaVersion": 1,
  "id": "linear-btn-primary",       // unique within the set, stable across recaptures
  "componentType": "button",        // button | card | input | typography
  "sourceUrl": "https://linear.app/method",
  "capturedAt": "2026-02-11T09:14:22.000Z",
  "screenshot": null,               // reserved; see below
  "styles": { /* computed styles */ },
  "notes": "Primary CTA in the page header."   // optional, never read by the engine
}
```

### `id`

Provenance addresses captures by id: every token in the output lists the ids
that produced it. Ids must therefore be **stable across recaptures of the same
element**, so that re-capturing a component updates its contribution rather than
adding a second one. Lowercase slug, unique within the set.

### `componentType`

A coarse tag, not a component model. It exists so the engine can weight
observations by what kind of element they came from, and so the generated spec
can say what the kit was built out of. The four values are fixed; adding one is
a schema version bump.

### `capturedAt`

Recorded for the operator. The engine never reads it, which is deliberate: a
timestamp that reached the output would make every regeneration a diff. See
[`docs/tokens.md`](./tokens.md#determinism).

### `screenshot`

Reserved. Must be `null` when present. Screenshots are out of scope for the
engine, which never reads pixels; the field exists so that adding screenshot
capture later does not change the record shape.

## `styles`

Keys mirror CSSOM camelCase property names. Values mirror what
`getComputedStyle` returns: **resolved strings**, never `var()` references and
never relative units. Every property is optional -- a real capture carries only
what was relevant to the element, and a typography capture has no border.

| Group | Properties | Notes |
| ----- | ---------- | ----- |
| Colour | `color`, `backgroundColor`, `borderColor` | Any CSS colour syntax culori parses. Fully transparent values are read as "no colour" and contribute nothing -- `rgba(0, 0, 0, 0)` must not become evidence of a black background. |
| Type | `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing` | `fontSize` and `letterSpacing` in px. `fontWeight` numeric as a string (`"500"`); keywords are rejected. `lineHeight` may be px or a unitless ratio; `"normal"` is ignored because its resolved value depends on the font. |
| Spacing | `paddingTop/Right/Bottom/Left`, `marginTop/Right/Bottom/Left`, `gap` | px. Negative margins are dropped: they are layout escape hatches, not evidence of a scale. |
| Border | `borderTopWidth/RightWidth/BottomWidth/LeftWidth`, `borderStyle` | px. |
| Radius | `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomRightRadius`, `borderBottomLeftRadius` | px. A value at or above 999px is read as a pill. |
| Elevation | `boxShadow` | `"none"`, or comma-separated CSS shadow layers. `inset` shadows parse but are excluded from the elevation scale. |

Longhands rather than shorthands, because that is what `getComputedStyle`
actually returns and because per-side values are what the spacing distiller
needs.

### Border colours and phantom values

Browsers report `border-color` even when `border-width` is `0`, and the reported
value is usually the element's text colour. The engine only reads
`borderColor` from a capture that actually draws a border -- non-zero width and
a `borderStyle` other than `none`/`hidden`. When authoring a capture by hand,
either include the border widths or leave `borderColor` out.

## Adding a fixture set

1. `mkdir fixtures/<slug>` and write `set.json` with `id` equal to `<slug>`.
2. `pnpm skeleton` -- it discovers the directory and writes `examples/<slug>/`.
3. `pnpm test` -- the schema, determinism and snapshot suites pick it up
   automatically; run `pnpm vitest -u` once to record its snapshot.
4. Commit the fixture *and* the generated example together. `pnpm skeleton
   --check` fails if they disagree.

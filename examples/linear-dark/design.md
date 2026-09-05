# Linear-like dark product UI — design system

Distilled by ingot-engine 0.1.0 from 10 captured components across 1 origin.

A single dark product surface captured across two pages of one app: near-black page background, one indigo brand colour, tight 13px body type, and 1px borders doing all the separation work.

You are implementing UI against this system. Use only the values below. When a value you need is not here, compose it from the tokens that are — do not introduce a new one.

- Colour mode: **dark**
- Stack: Tailwind CSS v4 + shadcn/ui
- Spacing base unit: **4px**
- Border width: **1px**
- Type base size: **13px**, scale ratio 1.241

## 1. Theme variables

Paste this into your global stylesheet. Values are OKLCH, matching the shadcn/ui default theme format. The mode is `dark`; place it under `.dark` and keep the counterpart mode's values as they were.

```css
.dark {
  --background: oklch(0.1390 0.0029 246.26); /* #08090a — page background */
  --foreground: oklch(0.9784 0.0011 197.14); /* #f7f8f8 — default text on --background */
  --card: oklch(0.1950 0.0026 247.96); /* #141516 — panel/card background; also --popover */
  --card-foreground: oklch(0.9784 0.0011 197.14); /* #f7f8f8 — text on --card; also --popover-foreground */
  --primary: oklch(0.5674 0.1585 275.21); /* #5e6ad2 — brand fill: primary buttons, active states */
  --primary-foreground: oklch(1.0000 0.0000 0.00); /* #ffffff — text/icons on --primary */
  --secondary: oklch(0.1950 0.0026 247.96); /* #141516 — secondary button fill */
  --secondary-foreground: oklch(0.9784 0.0011 197.14); /* #f7f8f8 — text on --secondary */
  --muted: oklch(0.1950 0.0026 247.96); /* #141516 — muted block background */
  --muted-foreground: oklch(0.6488 0.0146 262.36); /* #8a8f98 — de-emphasised text, placeholders, captions */
  --accent: oklch(0.2250 0.0026 247.96); /* #1b1c1d — hover fill for rows, menu items, ghost buttons */
  --accent-foreground: oklch(0.9784 0.0011 197.14); /* #f7f8f8 — text on --accent */
  --border: oklch(0.2764 0.0079 264.44); /* #26282c — all 1px separators and control outlines */
  --input: oklch(0.2764 0.0079 264.44); /* #26282c — input outlines */
  --ring: oklch(0.5674 0.1585 275.21); /* #5e6ad2 — focus ring */
  --ingot-surface-hover: oklch(0.2250 0.0026 247.96); /* #1b1c1d — raw hover surface */
  --ingot-primary-hover: oklch(0.6074 0.1585 275.21); /* #6976e0 — primary hover fill */
  --ingot-primary-active: oklch(0.6474 0.1585 275.21); /* #7483ed — primary pressed fill */
  --radius: 8px;
}
```

Tailwind v4 theme mapping:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

## 2. Colour roles

Every colour in the UI must come from this table. There are no other colours in this system.

| Role                | Hex     | OKLCH                       | Use it for                                     |
| ------------------- | ------- | --------------------------- | ---------------------------------------------- |
| `background`        | #08090a | oklch(0.1390 0.0029 246.26) | page background                                |
| `surface`           | #141516 | oklch(0.1950 0.0026 247.96) | panel/card background; also --popover          |
| `surfaceHover`      | #1b1c1d | oklch(0.2250 0.0026 247.96) | hover fill for rows, menu items, ghost buttons |
| `border`            | #26282c | oklch(0.2764 0.0079 264.44) | all 1px separators and control outlines        |
| `text`              | #f7f8f8 | oklch(0.9784 0.0011 197.14) | default text on --background                   |
| `textMuted`         | #8a8f98 | oklch(0.6488 0.0146 262.36) | de-emphasised text, placeholders, captions     |
| `primary`           | #5e6ad2 | oklch(0.5674 0.1585 275.21) | brand fill: primary buttons, active states     |
| `primaryHover`      | #6976e0 | oklch(0.6074 0.1585 275.21) | primary hover fill                             |
| `primaryActive`     | #7483ed | oklch(0.6474 0.1585 275.21) | primary pressed fill                           |
| `primaryForeground` | #ffffff | oklch(1.0000 0.0000 0.00)   | text/icons on --primary                        |

### Colour rules

- Text on `background` or `surface` is `text`. De-emphasised text is `textMuted`. There is no third text colour.
- `primary` is a fill, not a text colour. Use `primaryForeground` for anything drawn on top of it.
- Hover on an interactive surface goes to `surfaceHover`; hover on a primary fill goes to `primaryHover`; the pressed state is `primaryActive`.
- Borders are 1px `border`. Do not use shadows in place of borders for separation, and do not use `text` at reduced opacity as a border.
- This system has no destructive colour. If you need one, add it explicitly rather than reaching for an arbitrary red.

### Contrast

Every pair below is guaranteed at or above **4.5:1** (WCAG 2.1 AA, normal text).

| Foreground          | Background   | Ratio   | Status |
| ------------------- | ------------ | ------- | ------ |
| `text`              | `background` | 18.73:1 | pass   |
| `text`              | `surface`    | 17.18:1 | pass   |
| `textMuted`         | `background` | 6.13:1  | pass   |
| `textMuted`         | `surface`    | 5.63:1  | pass   |
| `primaryForeground` | `primary`    | 4.7:1   | pass   |

## 3. Typography

- Body font stack: `"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, sans-serif`
- No monospace font is defined. Use the browser default `ui-monospace, monospace` for code.
- Base size: 13px. Adjacent steps differ by roughly 1.241x.

| Step   | font-size | line-height | font-weight | letter-spacing | Tailwind            |
| ------ | --------- | ----------- | ----------- | -------------- | ------------------- |
| `sm`   | 11px      | 1.455       | 500         | normal         | text-[11px]/[1.455] |
| `base` | 13px      | 1.538       | 400         | normal         | text-[13px]/[1.538] |
| `lg`   | 15px      | 1.6         | 400         | normal         | text-[15px]/[1.6]   |
| `xl`   | 21px      | 1.333       | 600         | -0.37px        | text-[21px]/[1.333] |

### Type rules

- Use only these 4 sizes. Do not interpolate between them.
- Every size carries the line height listed with it. Do not pair a size with a different line height.
- Weights in this system: 400 (regular), 500 (medium), 600 (semibold). Use no others.
- Body copy is `base` at weight 400.

## 4. Spacing

Base unit **4px**. 88.2% of the captured lengths were already exact multiples of it.

| Step | px   | Tailwind                  |
| ---- | ---- | ------------------------- |
| `0`  | 0px  | `p-0` / `gap-0`           |
| `1`  | 4px  | `p-[4px]` / `gap-[4px]`   |
| `2`  | 8px  | `p-[8px]` / `gap-[8px]`   |
| `3`  | 12px | `p-[12px]` / `gap-[12px]` |
| `4`  | 16px | `p-[16px]` / `gap-[16px]` |
| `5`  | 20px | `p-[20px]` / `gap-[20px]` |
| `6`  | 24px | `p-[24px]` / `gap-[24px]` |

### Spacing rules

- Every padding, margin and gap is a multiple of 4px drawn from the table above.
- Snapping rule applied during distillation: Each observed padding, margin and gap length is snapped to the nearest multiple of the base unit; exact .5 ties round up. A non-zero length shorter than half the base unit snaps up to one base unit rather than collapsing to 0, because a visible gap must stay visible. Steps are named by their multiplier, so step "3" is 3 x the base unit.
- Do not use arbitrary values such as `p-[13px]` or `mt-[7px]`. If a layout seems to need one, pick the nearer step.

## 5. Radius

| Step   | px   | Tailwind         | Use it for                                    |
| ------ | ---- | ---------------- | --------------------------------------------- |
| `none` | 0px  | `rounded-none`   | flush edges, table cells, full-bleed sections |
| `sm`   | 6px  | `rounded-[6px]`  | inputs, badges, small controls                |
| `md`   | 8px  | `rounded-[8px]`  | buttons and most controls                     |
| `lg`   | 12px | `rounded-[12px]` | cards, panels, modals                         |

- Default to `md` (8px). Nest smaller radii inside larger ones, never the reverse.
- Every border in this system is `1px solid var(--border)`. Do not vary border width.

## 6. Elevation

| Step   | box-shadow                             |
| ------ | -------------------------------------- |
| `none` | `none`                                 |
| `sm`   | `0px 0.5px 1px 0px rgb(0 0 0 / 0.224)` |
| `md`   | `0px 1px 2px 0px rgb(0 0 0 / 0.32)`    |
| `lg`   | `0px 2.5px 5px 0px rgb(0 0 0 / 0.368)` |

- `sm` is for resting controls, `md` for cards, `lg` for overlays and popovers. Do not stack shadows.

## 7. Do not

- Do not introduce a colour, size, spacing value, radius or shadow that is not in this document.
- Do not use Tailwind default palette utilities (`bg-slate-900`, `text-gray-500`, `border-zinc-200`). Use the theme variables.
- Do not use `text-white` or `text-black`. Use `text-foreground`, `text-muted-foreground` or `text-primary-foreground`.
- Do not use opacity to make text quieter. Use `textMuted` (#8a8f98), which is contrast-checked.
- Do not change the values of `primary` (#5e6ad2) or `background` (#08090a) per component.
- Do not add gradients, glows, or animated colour transitions. Nothing in the captured sources uses them.
- Do not restyle shadcn/ui primitives inline. Change the theme variables above instead.

## 8. Where this came from

| Origin             | Captures |
| ------------------ | -------- |
| https://linear.app | 10       |

Component types captured: button (3), typography (3), card (2), input (2).

Full provenance for every token — contributing capture ids, raw observed values, and the machine-readable dominant-choice record behind each decision — is in `tokens.json` next to this file.

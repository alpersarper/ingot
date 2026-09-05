# Stripe-like light product UI — design system

Distilled by ingot-engine 0.1.0 from 10 captured components across 2 origins.

A light commerce surface captured across a marketing page and a dashboard of one product: white page, a tinted panel colour, a saturated indigo brand, layered shadows for elevation, and a red used only for validation errors.

You are implementing UI against this system. Use only the values below. When a value you need is not here, compose it from the tokens that are — do not introduce a new one.

- Colour mode: **light**
- Stack: Tailwind CSS v4 + shadcn/ui
- Spacing base unit: **4px**
- Border width: **1px**
- Type base size: **14px**, scale ratio 1.326

## 1. Theme variables

Paste this into your global stylesheet. Values are OKLCH, matching the shadcn/ui default theme format. The mode is `light`; place it under `:root` and keep the counterpart mode's values as they were.

```css
:root {
  --background: oklch(1.0000 0.0000 0.00); /* #ffffff — page background */
  --foreground: oklch(0.2467 0.0444 273.42); /* #1a1f36 — default text on --background */
  --card: oklch(0.9807 0.0051 247.88); /* #f6f9fc — panel/card background; also --popover */
  --card-foreground: oklch(0.2467 0.0444 273.42); /* #1a1f36 — text on --card; also --popover-foreground */
  --primary: oklch(0.5784 0.2346 278.29); /* #635bff — brand fill: primary buttons, active states */
  --primary-foreground: oklch(1.0000 0.0000 0.00); /* #ffffff — text/icons on --primary */
  --secondary: oklch(0.9807 0.0051 247.88); /* #f6f9fc — secondary button fill */
  --secondary-foreground: oklch(0.2467 0.0444 273.42); /* #1a1f36 — text on --secondary */
  --muted: oklch(0.9807 0.0051 247.88); /* #f6f9fc — muted block background */
  --muted-foreground: oklch(0.5540 0.0320 263.30); /* #697386 — de-emphasised text, placeholders, captions */
  --accent: oklch(0.9507 0.0051 247.88); /* #eceff2 — hover fill for rows, menu items, ghost buttons */
  --accent-foreground: oklch(0.2467 0.0444 273.42); /* #1a1f36 — text on --accent */
  --border: oklch(0.9289 0.0097 252.81); /* #e3e8ee — all 1px separators and control outlines */
  --input: oklch(0.9289 0.0097 252.81); /* #e3e8ee — input outlines */
  --ring: oklch(0.5784 0.2346 278.29); /* #635bff — focus ring */
  --destructive: oklch(0.5802 0.2214 19.39); /* #df1b41 — destructive fill and destructive text */
  --destructive-foreground: oklch(1.0000 0.0000 0.00); /* #ffffff — text on --destructive */
  --ingot-surface-hover: oklch(0.9507 0.0051 247.88); /* #eceff2 — raw hover surface */
  --ingot-primary-hover: oklch(0.5384 0.2346 278.29); /* #594df1 — primary hover fill */
  --ingot-primary-active: oklch(0.4984 0.2346 278.29); /* #503fe3 — primary pressed fill */
  --radius: 6px;
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
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}
```

## 2. Colour roles

Every colour in the UI must come from this table. There are no other colours in this system.

| Role                    | Hex     | OKLCH                       | Use it for                                     |
| ----------------------- | ------- | --------------------------- | ---------------------------------------------- |
| `background`            | #ffffff | oklch(1.0000 0.0000 0.00)   | page background                                |
| `surface`               | #f6f9fc | oklch(0.9807 0.0051 247.88) | panel/card background; also --popover          |
| `surfaceHover`          | #eceff2 | oklch(0.9507 0.0051 247.88) | hover fill for rows, menu items, ghost buttons |
| `border`                | #e3e8ee | oklch(0.9289 0.0097 252.81) | all 1px separators and control outlines        |
| `text`                  | #1a1f36 | oklch(0.2467 0.0444 273.42) | default text on --background                   |
| `textMuted`             | #697386 | oklch(0.5540 0.0320 263.30) | de-emphasised text, placeholders, captions     |
| `primary`               | #635bff | oklch(0.5784 0.2346 278.29) | brand fill: primary buttons, active states     |
| `primaryHover`          | #594df1 | oklch(0.5384 0.2346 278.29) | primary hover fill                             |
| `primaryActive`         | #503fe3 | oklch(0.4984 0.2346 278.29) | primary pressed fill                           |
| `primaryForeground`     | #ffffff | oklch(1.0000 0.0000 0.00)   | text/icons on --primary                        |
| `destructive`           | #df1b41 | oklch(0.5802 0.2214 19.39)  | destructive fill and destructive text          |
| `destructiveForeground` | #ffffff | oklch(1.0000 0.0000 0.00)   | text on --destructive                          |

### Colour rules

- Text on `background` or `surface` is `text`. De-emphasised text is `textMuted`. There is no third text colour.
- `primary` is a fill, not a text colour. Use `primaryForeground` for anything drawn on top of it.
- Hover on an interactive surface goes to `surfaceHover`; hover on a primary fill goes to `primaryHover`; the pressed state is `primaryActive`.
- Borders are 1px `border`. Do not use shadows in place of borders for separation, and do not use `text` at reduced opacity as a border.
- `destructive` is reserved for irreversible actions and error states. Never use it for emphasis.

### Contrast

Every pair below is guaranteed at or above **4.5:1** (WCAG 2.1 AA, normal text).

| Foreground              | Background    | Ratio   | Status |
| ----------------------- | ------------- | ------- | ------ |
| `text`                  | `background`  | 16.24:1 | pass   |
| `text`                  | `surface`     | 15.37:1 | pass   |
| `textMuted`             | `background`  | 4.78:1  | pass   |
| `textMuted`             | `surface`     | 4.52:1  | pass   |
| `primaryForeground`     | `primary`     | 4.7:1   | pass   |
| `destructiveForeground` | `destructive` | 4.8:1   | pass   |

## 3. Typography

- Body font stack: `"Sohne Var", "Helvetica Neue", Helvetica, Arial, sans-serif`
- Monospace stack: `"Source Code Pro", Menlo, Consolas, monospace`
- Base size: 14px. Adjacent steps differ by roughly 1.326x.

| Step   | font-size | line-height | font-weight | letter-spacing | Tailwind            |
| ------ | --------- | ----------- | ----------- | -------------- | ------------------- |
| `sm`   | 12px      | 1.333       | 500         | normal         | text-[12px]/[1.333] |
| `base` | 14px      | 1.429       | 400         | normal         | text-[14px]/[1.429] |
| `lg`   | 16px      | 1.5         | 400         | normal         | text-[16px]/[1.5]   |
| `xl`   | 28px      | 1.286       | 600         | -0.2px         | text-[28px]/[1.286] |

### Type rules

- Use only these 4 sizes. Do not interpolate between them.
- Every size carries the line height listed with it. Do not pair a size with a different line height.
- Weights in this system: 400 (regular), 500 (medium), 600 (semibold). Use no others.
- Body copy is `base` at weight 400.

## 4. Spacing

Base unit **4px**. 100% of the captured lengths were already exact multiples of it.

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

| Step   | px  | Tailwind        | Use it for                                    |
| ------ | --- | --------------- | --------------------------------------------- |
| `none` | 0px | `rounded-none`  | flush edges, table cells, full-bleed sections |
| `sm`   | 4px | `rounded-[4px]` | inputs, badges, small controls                |
| `md`   | 6px | `rounded-[6px]` | buttons and most controls                     |
| `lg`   | 8px | `rounded-[8px]` | cards, panels, modals                         |

- Default to `md` (6px). Nest smaller radii inside larger ones, never the reverse.
- Every border in this system is `1px solid var(--border)`. Do not vary border width.

## 6. Elevation

| Step   | box-shadow                                                                 |
| ------ | -------------------------------------------------------------------------- |
| `none` | `none`                                                                     |
| `sm`   | `0px 1px 1px 0px rgb(0 0 0 / 0.03)`                                        |
| `md`   | `0px 1px 1px 0px rgb(0 0 0 / 0.08)`                                        |
| `lg`   | `0px 2px 5px -1px rgb(50 50 93 / 0.25), 0px 1px 3px -1px rgb(0 0 0 / 0.3)` |

- `sm` is for resting controls, `md` for cards, `lg` for overlays and popovers. Do not stack shadows.

## 7. Do not

- Do not introduce a colour, size, spacing value, radius or shadow that is not in this document.
- Do not use Tailwind default palette utilities (`bg-slate-900`, `text-gray-500`, `border-zinc-200`). Use the theme variables.
- Do not use `text-white` or `text-black`. Use `text-foreground`, `text-muted-foreground` or `text-primary-foreground`.
- Do not use opacity to make text quieter. Use `textMuted` (#697386), which is contrast-checked.
- Do not change the values of `primary` (#635bff) or `background` (#ffffff) per component.
- Do not add gradients, glows, or animated colour transitions. Nothing in the captured sources uses them.
- Do not restyle shadcn/ui primitives inline. Change the theme variables above instead.

## 8. Where this came from

| Origin                       | Captures |
| ---------------------------- | -------- |
| https://stripe.com           | 6        |
| https://dashboard.stripe.com | 4        |

Component types captured: typography (4), button (2), card (2), input (2).

Full provenance for every token — contributing capture ids, raw observed values, and the machine-readable dominant-choice record behind each decision — is in `tokens.json` next to this file.

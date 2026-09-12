# Stripe-like light product UI — design system

Distilled by ingot-engine 0.3.0 from 10 captured components across 2 origins.

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
  --muted-foreground: oklch(0.5240 0.0320 263.30); /* #606a7d — de-emphasised text, placeholders, captions */
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
  --ingot-selected-surface: oklch(0.9432 0.0200 278.29); /* #e9ebfa — selected row and active nav item fill */
  --ingot-disabled-surface: oklch(0.9207 0.0051 247.88); /* #e2e5e8 — disabled control fill */
  --ingot-disabled-foreground: oklch(0.6057 0.0320 263.30); /* #788296 — disabled label and icon colour */
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
| `selectedSurface`       | #e9ebfa | oklch(0.9432 0.0200 278.29) | selected row and active nav item fill          |
| `border`                | #e3e8ee | oklch(0.9289 0.0097 252.81) | all 1px separators and control outlines        |
| `text`                  | #1a1f36 | oklch(0.2467 0.0444 273.42) | default text on --background                   |
| `textMuted`             | #606a7d | oklch(0.5240 0.0320 263.30) | de-emphasised text, placeholders, captions     |
| `primary`               | #635bff | oklch(0.5784 0.2346 278.29) | brand fill: primary buttons, active states     |
| `primaryHover`          | #594df1 | oklch(0.5384 0.2346 278.29) | primary hover fill                             |
| `primaryActive`         | #503fe3 | oklch(0.4984 0.2346 278.29) | primary pressed fill                           |
| `primaryForeground`     | #ffffff | oklch(1.0000 0.0000 0.00)   | text/icons on --primary                        |
| `destructive`           | #df1b41 | oklch(0.5802 0.2214 19.39)  | destructive fill and destructive text          |
| `destructiveForeground` | #ffffff | oklch(1.0000 0.0000 0.00)   | text on --destructive                          |
| `disabledSurface`       | #e2e5e8 | oklch(0.9207 0.0051 247.88) | disabled control fill                          |
| `disabledForeground`    | #788296 | oklch(0.6057 0.0320 263.30) | disabled label and icon colour                 |

### Colour rules

- Text on `background` or `surface` is `text`. De-emphasised text is `textMuted`. There is no third text colour.
- `primary` is a fill, not a text colour. Use `primaryForeground` for anything drawn on top of it.
- Hover on an interactive surface goes to `surfaceHover`; hover on a primary fill goes to `primaryHover`; the pressed state is `primaryActive`.
- A selected row, tab or nav item is filled with `selectedSurface` (#e9ebfa) and keeps `text` on top. Selection reads by hue, hover reads by lightness; do not swap them.
- A disabled control is filled with `disabledSurface` (#e2e5e8) and labelled `disabledForeground` (#788296). Never build a disabled state out of `opacity`.
- Borders are 1px `border`. Do not use shadows in place of borders for separation, and do not use `text` at reduced opacity as a border.
- `destructive` is reserved for irreversible actions and error states. Never use it for emphasis. It is contrast-checked as a text colour as well as a fill, so error copy may be set in it.

### Contrast

This table is exhaustive: every pair the kit puts on screen is measured here, including the derived hover, pressed and selected surfaces. Text pairs are guaranteed at or above **4.5:1** (WCAG 2.1 AA, normal text). The disabled pair is held to **3:1** on purpose — WCAG 2.1 exempts inactive controls from 1.4.3, and a disabled label that clears the body-text floor stops reading as disabled.

| Foreground              | Background        | Ratio   | Floor | Status |
| ----------------------- | ----------------- | ------- | ----- | ------ |
| `text`                  | `background`      | 16.24:1 | 4.5:1 | pass   |
| `text`                  | `surface`         | 15.37:1 | 4.5:1 | pass   |
| `textMuted`             | `background`      | 5.45:1  | 4.5:1 | pass   |
| `textMuted`             | `surface`         | 5.16:1  | 4.5:1 | pass   |
| `primaryForeground`     | `primary`         | 4.7:1   | 4.5:1 | pass   |
| `destructive`           | `background`      | 4.8:1   | 4.5:1 | pass   |
| `destructive`           | `surface`         | 4.55:1  | 4.5:1 | pass   |
| `destructiveForeground` | `destructive`     | 4.8:1   | 4.5:1 | pass   |
| `primaryForeground`     | `primaryHover`    | 5.59:1  | 4.5:1 | pass   |
| `primaryForeground`     | `primaryActive`   | 6.64:1  | 4.5:1 | pass   |
| `text`                  | `surfaceHover`    | 14.07:1 | 4.5:1 | pass   |
| `text`                  | `selectedSurface` | 13.71:1 | 4.5:1 | pass   |
| `textMuted`             | `surfaceHover`    | 4.72:1  | 4.5:1 | pass   |
| `textMuted`             | `selectedSurface` | 4.6:1   | 4.5:1 | pass   |
| `disabledForeground`    | `disabledSurface` | 3.06:1  | 3:1   | pass   |

The following roles were moved away from the value they started at to reach their floor — a captured colour for an observed role, the offset the engine computed for a derived one. Use the adjusted values; the originals fail accessibility.

- `textMuted`: #697386 → #606a7d (4.03:1 → 4.6:1). raised contrast from 4.03:1 to 4.6:1 by moving OKLCH lightness -0.03.
- `disabledForeground`: #949fb3 → #788296 (2.11:1 → 3.06:1). raised contrast from 2.11:1 to 3.06:1 by moving OKLCH lightness -0.095.

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

The scale has two bands. **Component** steps sit at or below the largest observed length: a capture is one component, so the evidence stops at that component's own padding, and each step's provenance records whether it was observed or gap-filled. **Layout** steps continue the same multiplier series past the largest observation, because page rhythm has to come from somewhere and inventing it per screen is worse than stating it here.

| Step | px   | Band      | Tailwind                  |
| ---- | ---- | --------- | ------------------------- |
| `0`  | 0px  | component | `p-0` / `gap-0`           |
| `1`  | 4px  | component | `p-[4px]` / `gap-[4px]`   |
| `2`  | 8px  | component | `p-[8px]` / `gap-[8px]`   |
| `3`  | 12px | component | `p-[12px]` / `gap-[12px]` |
| `4`  | 16px | component | `p-[16px]` / `gap-[16px]` |
| `5`  | 20px | component | `p-[20px]` / `gap-[20px]` |
| `6`  | 24px | component | `p-[24px]` / `gap-[24px]` |
| `8`  | 32px | layout    | `p-[32px]` / `gap-[32px]` |
| `10` | 40px | layout    | `p-[40px]` / `gap-[40px]` |
| `12` | 48px | layout    | `p-[48px]` / `gap-[48px]` |
| `16` | 64px | layout    | `p-[64px]` / `gap-[64px]` |

### Spacing rules

- Every padding, margin and gap is a multiple of 4px drawn from the table above.
- Inside a control or a card, use the component steps (up to 24px). They stay within the range the sources actually use.
- Between cards, between sections and around the page, use the layout steps (32px, 40px, 48px, 64px). Do not pad a page with a component step: that is what makes a generated screen read as cramped.
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

## 7. Components

Each control below is fully specified. These are not defaults to adjust — a screen built with a 32px button and a screen built with a 40px button are two different products, and the whole point of this section is that both of you get the same one. Use these numbers.

| Component            | Height        | Padding (y, x) | Radius       | Type                | Weight | From                   |
| -------------------- | ------------- | -------------- | ------------ | ------------------- | ------ | ---------------------- |
| `card`               | — (container) | 16px, 16px     | `lg` (8px)   | `base` (14px/1.429) | 400    | captured               |
| `button.primary`     | 36px          | 8px, 16px      | `md` (6px)   | `base` (14px/1.429) | 500    | captured               |
| `button.secondary`   | 38px          | 8px, 16px      | `md` (6px)   | `base` (14px/1.429) | 500    | captured               |
| `button.ghost`       | 36px          | 8px, 16px      | `md` (6px)   | `base` (14px/1.429) | 500    | captured               |
| `button.destructive` | 36px          | 8px, 16px      | `md` (6px)   | `base` (14px/1.429) | 500    | like `button.primary`  |
| `input`              | 38px          | 8px, 12px      | `sm` (4px)   | `base` (14px/1.429) | 400    | captured               |
| `select`             | 38px          | 8px, 12px      | `sm` (4px)   | `base` (14px/1.429) | 400    | like `input`           |
| `table.header`       | 34px          | 8px, 12px      | `none` (0px) | `sm` (12px/1.333)   | 600    | like `input` + default |
| `table.row`          | 38px          | 8px, 12px      | `none` (0px) | `base` (14px/1.429) | 400    | like `input` + default |
| `badge`              | 26px          | 4px, 8px       | `sm` (4px)   | `sm` (12px/1.333)   | 600    | default                |

Colours for the same controls:

| Component            | Fill          | Text                    | Border   | Hover fill     | What it is for                                                |
| -------------------- | ------------- | ----------------------- | -------- | -------------- | ------------------------------------------------------------- |
| `card`               | `surface`     | `text`                  | `border` | —              | Panels, cards and any titled box that holds other components. |
| `button.primary`     | `primary`     | `primaryForeground`     | —        | `primaryHover` | The one call to action on a screen.                           |
| `button.secondary`   | `surface`     | `text`                  | `border` | `surfaceHover` | Every other action that is not destructive.                   |
| `button.ghost`       | —             | `text`                  | —        | `surfaceHover` | Toolbar and icon actions; transparent until hovered.          |
| `button.destructive` | `destructive` | `destructiveForeground` | —        | —              | Irreversible actions only. Never for emphasis.                |
| `input`              | `background`  | `text`                  | `border` | —              | Text fields and textareas.                                    |
| `select`             | `background`  | `text`                  | `border` | —              | Native and custom selects. A text field with a chevron.       |
| `table.header`       | `surface`     | `textMuted`             | `border` | —              | Column headings. One rule underneath, never a filled band.    |
| `table.row`          | `surface`     | `text`                  | `border` | `surfaceHover` | Data rows. Separated by a rule, highlighted on hover.         |
| `badge`              | `background`  | `text`                  | `border` | —              | Status pills inside tables and cards.                         |

### Component rules

- Height is the border-box height: `padding-y x 2 + line box + border x 2`. Set it explicitly rather than letting content decide, so a button with an icon and a button with a label are the same height.
- A control's radius is the step named above, not a px value of your own. Nest smaller radii inside larger ones.
- The type step carries its line height with it (see §3). Do not restyle a control's font size away from its step.
- `From` says where the geometry came from: `captured` was measured in the sources, `like x` was taken from another recipe, `default` is this engine's sanctioned value because nothing described that control. Per-value provenance is in `tokens.json` under `components.recipes`.
- `button.destructive` has no derived hover fill in this kit. Keep its fill constant on hover and use the focus ring for feedback rather than inventing a darker red.

### States

| State    | How to draw it                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| hover    | The recipe's hover fill above. On a primary fill that is `primaryHover` (#594df1).                                                    |
| pressed  | `primaryActive` (#503fe3) on a primary fill; otherwise keep the hover fill.                                                           |
| focus    | `2px solid var(--ring)` at `outline-offset: 2px`, on every focusable control. Never remove it.                                        |
| selected | Fill `selectedSurface` (#e9ebfa), text `text`.                                                                                        |
| disabled | Fill `disabledSurface` (#e2e5e8), text `disabledForeground` (#788296), measured at 3.06:1. Keep the border. Do **not** use `opacity`. |
| error    | Message and field border in `destructive` (#df1b41). Keep the message text at the base step; the colour carries the signal.           |

`opacity` is not a disabled state: on a light kit a 50% label over a 50% fill measures 1:1 and disappears. The two colours above are real, and they are checked (§2).

## 8. Do not

- Do not introduce a colour, size, spacing value, radius or shadow that is not in this document.
- Do not invent a control height or padding. §7 gives every control both.
- Do not use Tailwind default palette utilities (`bg-slate-900`, `text-gray-500`, `border-zinc-200`). Use the theme variables.
- Do not use `text-white` or `text-black`. Use `text-foreground`, `text-muted-foreground` or `text-primary-foreground`.
- Do not use opacity to make text quieter or a control inactive. Use `textMuted` (#606a7d) for quiet text and `disabledForeground` (#788296) on `disabledSurface` (#e2e5e8) for disabled controls. Both are contrast-checked; opacity cannot be.
- Do not change the values of `primary` (#635bff) or `background` (#ffffff) per component.
- Do not add gradients, glows, or animated colour transitions. Nothing in the captured sources uses them.
- Do not restyle shadcn/ui primitives inline. Change the theme variables above instead.

## 9. Where this came from

| Origin                       | Captures |
| ---------------------------- | -------- |
| https://stripe.com           | 6        |
| https://dashboard.stripe.com | 4        |

Component types captured: typography (4), button (2), card (2), input (2).

Full provenance for every token — contributing capture ids, raw observed values, and the machine-readable dominant-choice record behind each decision — is in `tokens.json` next to this file.

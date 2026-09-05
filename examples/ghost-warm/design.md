# Ghost-like warm editorial UI — design system

Distilled by ingot-engine 0.2.0 from 10 captured components across 2 origins.

A warm editorial publishing surface captured across a marketing page and the writer-facing admin of one product: near-black warm ink on an off-white paper background, sand-tinted panels, an evergreen brand fill, a reading type scale that is deliberately larger than the control type scale, and one red reserved for validation errors.

You are implementing UI against this system. Use only the values below. When a value you need is not here, compose it from the tokens that are — do not introduce a new one.

- Colour mode: **light**
- Stack: Tailwind CSS v4 + shadcn/ui
- Spacing base unit: **4px**
- Border width: **1px**
- Type base size: **15px**, scale ratio 1.211

## 1. Theme variables

Paste this into your global stylesheet. Values are OKLCH, matching the shadcn/ui default theme format. The mode is `light`; place it under `:root` and keep the counterpart mode's values as they were.

```css
:root {
  --background: oklch(0.9820 0.0041 91.45); /* #faf9f6 — page background */
  --foreground: oklch(0.2138 0.0042 84.59); /* #1a1917 — default text on --background */
  --card: oklch(0.9618 0.0086 84.57); /* #f5f2ec — panel/card background; also --popover */
  --card-foreground: oklch(0.2138 0.0042 84.59); /* #1a1917 — text on --card; also --popover-foreground */
  --primary: oklch(0.5157 0.1030 166.11); /* #0f7a5a — brand fill: primary buttons, active states */
  --primary-foreground: oklch(1.0000 0.0000 0.00); /* #ffffff — text/icons on --primary */
  --secondary: oklch(0.9618 0.0086 84.57); /* #f5f2ec — secondary button fill */
  --secondary-foreground: oklch(0.2138 0.0042 84.59); /* #1a1917 — text on --secondary */
  --muted: oklch(0.9618 0.0086 84.57); /* #f5f2ec — muted block background */
  --muted-foreground: oklch(0.5121 0.0152 82.38); /* #6b665d — de-emphasised text, placeholders, captions */
  --accent: oklch(0.9318 0.0086 84.57); /* #ebe8e2 — hover fill for rows, menu items, ghost buttons */
  --accent-foreground: oklch(0.2138 0.0042 84.59); /* #1a1917 — text on --accent */
  --border: oklch(0.9079 0.0145 84.58); /* #e5e0d6 — all 1px separators and control outlines */
  --input: oklch(0.9079 0.0145 84.58); /* #e5e0d6 — input outlines */
  --ring: oklch(0.5157 0.1030 166.11); /* #0f7a5a — focus ring */
  --destructive: oklch(0.5003 0.1821 29.51); /* #b42318 — destructive fill and destructive text */
  --destructive-foreground: oklch(1.0000 0.0000 0.00); /* #ffffff — text on --destructive */
  --ingot-surface-hover: oklch(0.9318 0.0086 84.57); /* #ebe8e2 — raw hover surface */
  --ingot-primary-hover: oklch(0.4757 0.1030 166.11); /* #006d50 — primary hover fill */
  --ingot-primary-active: oklch(0.4357 0.1030 166.11); /* #006146 — primary pressed fill */
  --ingot-selected-surface: oklch(0.9418 0.0500 166.11); /* #cdf7e4 — selected row and active nav item fill */
  --ingot-disabled-surface: oklch(0.9018 0.0086 84.57); /* #e1ded8 — disabled control fill */
  --ingot-disabled-foreground: oklch(0.5930 0.0152 82.38); /* #837d74 — disabled label and icon colour */
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
  --radius-lg: 12px;
}
```

## 2. Colour roles

Every colour in the UI must come from this table. There are no other colours in this system.

| Role                    | Hex     | OKLCH                       | Use it for                                     |
| ----------------------- | ------- | --------------------------- | ---------------------------------------------- |
| `background`            | #faf9f6 | oklch(0.9820 0.0041 91.45)  | page background                                |
| `surface`               | #f5f2ec | oklch(0.9618 0.0086 84.57)  | panel/card background; also --popover          |
| `surfaceHover`          | #ebe8e2 | oklch(0.9318 0.0086 84.57)  | hover fill for rows, menu items, ghost buttons |
| `selectedSurface`       | #cdf7e4 | oklch(0.9418 0.0500 166.11) | selected row and active nav item fill          |
| `border`                | #e5e0d6 | oklch(0.9079 0.0145 84.58)  | all 1px separators and control outlines        |
| `text`                  | #1a1917 | oklch(0.2138 0.0042 84.59)  | default text on --background                   |
| `textMuted`             | #6b665d | oklch(0.5121 0.0152 82.38)  | de-emphasised text, placeholders, captions     |
| `primary`               | #0f7a5a | oklch(0.5157 0.1030 166.11) | brand fill: primary buttons, active states     |
| `primaryHover`          | #006d50 | oklch(0.4757 0.1030 166.11) | primary hover fill                             |
| `primaryActive`         | #006146 | oklch(0.4357 0.1030 166.11) | primary pressed fill                           |
| `primaryForeground`     | #ffffff | oklch(1.0000 0.0000 0.00)   | text/icons on --primary                        |
| `destructive`           | #b42318 | oklch(0.5003 0.1821 29.51)  | destructive fill and destructive text          |
| `destructiveForeground` | #ffffff | oklch(1.0000 0.0000 0.00)   | text on --destructive                          |
| `disabledSurface`       | #e1ded8 | oklch(0.9018 0.0086 84.57)  | disabled control fill                          |
| `disabledForeground`    | #837d74 | oklch(0.5930 0.0152 82.38)  | disabled label and icon colour                 |

### Colour rules

- Text on `background` or `surface` is `text`. De-emphasised text is `textMuted`. There is no third text colour.
- `primary` is a fill, not a text colour. Use `primaryForeground` for anything drawn on top of it.
- Hover on an interactive surface goes to `surfaceHover`; hover on a primary fill goes to `primaryHover`; the pressed state is `primaryActive`.
- A selected row, tab or nav item is filled with `selectedSurface` (#cdf7e4) and keeps `text` on top. Selection reads by hue, hover reads by lightness; do not swap them.
- A disabled control is filled with `disabledSurface` (#e1ded8) and labelled `disabledForeground` (#837d74). Never build a disabled state out of `opacity`.
- Borders are 1px `border`. Do not use shadows in place of borders for separation, and do not use `text` at reduced opacity as a border.
- `destructive` is reserved for irreversible actions and error states. Never use it for emphasis. It is contrast-checked as a text colour as well as a fill, so error copy may be set in it.

### Contrast

This table is exhaustive: every pair the kit puts on screen is measured here, including the derived hover, pressed and selected surfaces. Text pairs are guaranteed at or above **4.5:1** (WCAG 2.1 AA, normal text). The disabled pair is held to **3:1** on purpose — WCAG 2.1 exempts inactive controls from 1.4.3, and a disabled label that clears the body-text floor stops reading as disabled.

| Foreground              | Background        | Ratio   | Floor | Status |
| ----------------------- | ----------------- | ------- | ----- | ------ |
| `text`                  | `background`      | 16.69:1 | 4.5:1 | pass   |
| `text`                  | `surface`         | 15.72:1 | 4.5:1 | pass   |
| `textMuted`             | `background`      | 5.41:1  | 4.5:1 | pass   |
| `textMuted`             | `surface`         | 5.1:1   | 4.5:1 | pass   |
| `primaryForeground`     | `primary`         | 5.31:1  | 4.5:1 | pass   |
| `destructive`           | `background`      | 6.24:1  | 4.5:1 | pass   |
| `destructive`           | `surface`         | 5.88:1  | 4.5:1 | pass   |
| `destructiveForeground` | `destructive`     | 6.57:1  | 4.5:1 | pass   |
| `primaryForeground`     | `primaryHover`    | 6.36:1  | 4.5:1 | pass   |
| `primaryForeground`     | `primaryActive`   | 7.5:1   | 4.5:1 | pass   |
| `text`                  | `surfaceHover`    | 14.37:1 | 4.5:1 | pass   |
| `text`                  | `selectedSurface` | 15.08:1 | 4.5:1 | pass   |
| `textMuted`             | `surfaceHover`    | 4.66:1  | 4.5:1 | pass   |
| `textMuted`             | `selectedSurface` | 4.89:1  | 4.5:1 | pass   |
| `disabledForeground`    | `disabledSurface` | 3.04:1  | 3:1   | pass   |

The following roles were moved away from the value they started at to reach their floor — a captured colour for an observed role, the offset the engine computed for a derived one. Use the adjusted values; the originals fail accessibility.

- `disabledForeground`: #99948a → #837d74 (2.25:1 → 3.04:1). raised contrast from 2.25:1 to 3.04:1 by moving OKLCH lightness -0.075.

## 3. Typography

- Body font stack: `"Untitled Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`
- Monospace stack: `"JetBrains Mono", Menlo, Consolas, monospace`
- Base size: 15px. Adjacent steps differ by roughly 1.211x.

| Step   | font-size | line-height | font-weight | letter-spacing | Tailwind            |
| ------ | --------- | ----------- | ----------- | -------------- | ------------------- |
| `sm`   | 13px      | 1.538       | 500         | normal         | text-[13px]/[1.538] |
| `base` | 15px      | 1.333       | 400         | normal         | text-[15px]/[1.333] |
| `lg`   | 17px      | 1.588       | 400         | normal         | text-[17px]/[1.588] |
| `xl`   | 20px      | 1.4         | 600         | -0.2px         | text-[20px]/[1.4]   |
| `2xl`  | 28px      | 1.214       | 600         | -0.4px         | text-[28px]/[1.214] |

### Type rules

- Use only these 5 sizes. Do not interpolate between them.
- Every size carries the line height listed with it. Do not pair a size with a different line height.
- Weights in this system: 400 (regular), 500 (medium), 600 (semibold). Use no others.
- Body copy is `base` at weight 400.

## 4. Spacing

Base unit **4px**. 89.5% of the captured lengths were already exact multiples of it.

The scale has two bands. **Component** steps are measured: a capture is one component, so the evidence stops at that component's own padding. **Layout** steps continue the same multiplier series past the largest observation, because page rhythm has to come from somewhere and inventing it per screen is worse than stating it here.

| Step | px   | Band      | Tailwind                  |
| ---- | ---- | --------- | ------------------------- |
| `0`  | 0px  | component | `p-0` / `gap-0`           |
| `1`  | 4px  | component | `p-[4px]` / `gap-[4px]`   |
| `2`  | 8px  | component | `p-[8px]` / `gap-[8px]`   |
| `3`  | 12px | component | `p-[12px]` / `gap-[12px]` |
| `4`  | 16px | component | `p-[16px]` / `gap-[16px]` |
| `5`  | 20px | component | `p-[20px]` / `gap-[20px]` |
| `6`  | 24px | component | `p-[24px]` / `gap-[24px]` |
| `7`  | 28px | component | `p-[28px]` / `gap-[28px]` |
| `8`  | 32px | component | `p-[32px]` / `gap-[32px]` |
| `9`  | 36px | component | `p-[36px]` / `gap-[36px]` |
| `10` | 40px | component | `p-[40px]` / `gap-[40px]` |
| `12` | 48px | layout    | `p-[48px]` / `gap-[48px]` |
| `16` | 64px | layout    | `p-[64px]` / `gap-[64px]` |

### Spacing rules

- Every padding, margin and gap is a multiple of 4px drawn from the table above.
- Inside a control or a card, use the component steps (up to 40px). They are what the sources actually do.
- Between cards, between sections and around the page, use the layout steps (48px, 64px). Do not pad a page with a component step: that is what makes a generated screen read as cramped.
- Snapping rule applied during distillation: Each observed padding, margin and gap length is snapped to the nearest multiple of the base unit; exact .5 ties round up. A non-zero length shorter than half the base unit snaps up to one base unit rather than collapsing to 0, because a visible gap must stay visible. Steps are named by their multiplier, so step "3" is 3 x the base unit.
- Do not use arbitrary values such as `p-[13px]` or `mt-[7px]`. If a layout seems to need one, pick the nearer step.

## 5. Radius

| Step   | px   | Tailwind         | Use it for                                    |
| ------ | ---- | ---------------- | --------------------------------------------- |
| `none` | 0px  | `rounded-none`   | flush edges, table cells, full-bleed sections |
| `sm`   | 4px  | `rounded-[4px]`  | inputs, badges, small controls                |
| `md`   | 6px  | `rounded-[6px]`  | buttons and most controls                     |
| `lg`   | 12px | `rounded-[12px]` | cards, panels, modals                         |

- Default to `md` (6px). Nest smaller radii inside larger ones, never the reverse.
- Every border in this system is `1px solid var(--border)`. Do not vary border width.

## 6. Elevation

| Step   | box-shadow                                                                          |
| ------ | ----------------------------------------------------------------------------------- |
| `none` | `none`                                                                              |
| `sm`   | `0px 1px 2px 0px rgb(28 25 23 / 0.05)`                                              |
| `md`   | `0px 4px 12px -2px rgb(28 25 23 / 0.1), 0px 2px 4px -2px rgb(28 25 23 / 0.06)`      |
| `lg`   | `0px 10px 30px -5px rgb(28 25 23 / 0.115), 0px 5px 10px -5px rgb(28 25 23 / 0.069)` |

- `sm` is for resting controls, `md` for cards, `lg` for overlays and popovers. Do not stack shadows.

## 7. Components

Each control below is fully specified. These are not defaults to adjust — a screen built with a 32px button and a screen built with a 40px button are two different products, and the whole point of this section is that both of you get the same one. Use these numbers.

| Component            | Height | Padding (y, x) | Radius       | Type                | Weight | From                   |
| -------------------- | ------ | -------------- | ------------ | ------------------- | ------ | ---------------------- |
| `button.primary`     | 36px   | 8px, 16px      | `md` (6px)   | `base` (15px/1.333) | 500    | captured               |
| `button.secondary`   | 38px   | 8px, 16px      | `md` (6px)   | `base` (15px/1.333) | 500    | captured               |
| `button.ghost`       | 36px   | 8px, 16px      | `md` (6px)   | `base` (15px/1.333) | 500    | captured               |
| `button.destructive` | 36px   | 8px, 16px      | `md` (6px)   | `base` (15px/1.333) | 500    | like `button.primary`  |
| `input`              | 38px   | 8px, 12px      | `md` (6px)   | `base` (15px/1.333) | 400    | captured               |
| `select`             | 38px   | 8px, 12px      | `md` (6px)   | `base` (15px/1.333) | 400    | like `input`           |
| `table.header`       | 38px   | 8px, 12px      | `none` (0px) | `sm` (13px/1.538)   | 600    | like `input` + default |
| `table.row`          | 38px   | 8px, 12px      | `none` (0px) | `base` (15px/1.333) | 400    | like `input` + default |
| `badge`              | 30px   | 4px, 8px       | `sm` (4px)   | `sm` (13px/1.538)   | 600    | default                |

Colours for the same controls:

| Component            | Fill           | Text                    | Border   | Hover fill     | What it is for                                             |
| -------------------- | -------------- | ----------------------- | -------- | -------------- | ---------------------------------------------------------- |
| `button.primary`     | `primary`      | `primaryForeground`     | —        | `primaryHover` | The one call to action on a screen.                        |
| `button.secondary`   | `surface`      | `text`                  | `border` | `surfaceHover` | Every other action that is not destructive.                |
| `button.ghost`       | —              | `text`                  | —        | `surfaceHover` | Toolbar and icon actions; transparent until hovered.       |
| `button.destructive` | `destructive`  | `destructiveForeground` | —        | —              | Irreversible actions only. Never for emphasis.             |
| `input`              | `background`   | `text`                  | `border` | —              | Text fields and textareas.                                 |
| `select`             | `background`   | `text`                  | `border` | —              | Native and custom selects. A text field with a chevron.    |
| `table.header`       | `surface`      | `textMuted`             | `border` | —              | Column headings. One rule underneath, never a filled band. |
| `table.row`          | `surface`      | `text`                  | `border` | `surfaceHover` | Data rows. Separated by a rule, highlighted on hover.      |
| `badge`              | `surfaceHover` | `text`                  | `border` | —              | Status pills inside tables and cards.                      |

### Component rules

- Height is the border-box height: `padding-y x 2 + line box + border x 2`. Set it explicitly rather than letting content decide, so a button with an icon and a button with a label are the same height.
- A control's radius is the step named above, not a px value of your own. Nest smaller radii inside larger ones.
- The type step carries its line height with it (see §3). Do not restyle a control's font size away from its step.
- `From` says where the geometry came from: `captured` was measured in the sources, `like x` was taken from another recipe, `default` is this engine's sanctioned value because nothing described that control. Per-value provenance is in `tokens.json` under `components.recipes`.
- `button.destructive` has no derived hover fill in this kit. Keep its fill constant on hover and use the focus ring for feedback rather than inventing a darker red.

### States

| State    | How to draw it                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| hover    | The recipe's hover fill above. On a primary fill that is `primaryHover` (#006d50).                                                    |
| pressed  | `primaryActive` (#006146) on a primary fill; otherwise keep the hover fill.                                                           |
| focus    | `2px solid var(--ring)` at `outline-offset: 2px`, on every focusable control. Never remove it.                                        |
| selected | Fill `selectedSurface` (#cdf7e4), text `text`.                                                                                        |
| disabled | Fill `disabledSurface` (#e1ded8), text `disabledForeground` (#837d74), measured at 3.04:1. Keep the border. Do **not** use `opacity`. |

`opacity` is not a disabled state: on a light kit a 50% label over a 50% fill measures 1:1 and disappears. The two colours above are real, and they are checked (§2).

## 8. Do not

- Do not introduce a colour, size, spacing value, radius or shadow that is not in this document.
- Do not invent a control height or padding. §7 gives every control both.
- Do not use Tailwind default palette utilities (`bg-slate-900`, `text-gray-500`, `border-zinc-200`). Use the theme variables.
- Do not use `text-white` or `text-black`. Use `text-foreground`, `text-muted-foreground` or `text-primary-foreground`.
- Do not use opacity to make text quieter or a control inactive. Use `textMuted` (#6b665d) for quiet text and `disabledForeground` (#837d74) on `disabledSurface` (#e1ded8) for disabled controls. Both are contrast-checked; opacity cannot be.
- Do not change the values of `primary` (#0f7a5a) or `background` (#faf9f6) per component.
- Do not add gradients, glows, or animated colour transitions. Nothing in the captured sources uses them.
- Do not restyle shadcn/ui primitives inline. Change the theme variables above instead.

## 9. Where this came from

| Origin                | Captures |
| --------------------- | -------- |
| https://demo.ghost.io | 5        |
| https://ghost.org     | 5        |

Component types captured: typography (4), button (2), card (2), input (2).

Full provenance for every token — contributing capture ids, raw observed values, and the machine-readable dominant-choice record behind each decision — is in `tokens.json` next to this file.

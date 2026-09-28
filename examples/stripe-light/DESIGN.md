---
version: alpha
name: "Stripe-like light product UI"
description: "A light commerce surface captured across a marketing page and a dashboard of one product: white page, a tinted panel colour, a saturated indigo brand, layered shadows for elevation, and a red used only for validation errors."
colors:
  background: "#ffffff"
  surface: "#f6f9fc"
  surface-hover: "#eceff2"
  surface-selected: "#e9ebfa"
  border: "#e3e8ee"
  text: "#1a1f36"
  text-muted: "#606a7d"
  primary: "#635bff"
  primary-hover: "#594df1"
  primary-active: "#503fe3"
  primary-foreground: "#ffffff"
  destructive: "#df1b41"
  destructive-foreground: "#ffffff"
  disabled-surface: "#e2e5e8"
  disabled-foreground: "#788296"
typography:
  text-sm:
    fontFamily: "\"Sohne Var\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.333
  text-base:
    fontFamily: "\"Sohne Var\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.429
  text-lg:
    fontFamily: "\"Sohne Var\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  text-xl:
    fontFamily: "\"Sohne Var\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.286
    letterSpacing: -0.2px
  text-sm-semibold:
    fontFamily: "\"Sohne Var\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.333
  text-base-medium:
    fontFamily: "\"Sohne Var\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.429
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
spacing:
  "0": 0px
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "8": 32px
  "10": 40px
  "12": 48px
  "16": 64px
components:
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.text-base}"
    rounded: "{rounded.lg}"
    padding: 16px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.text-base-medium}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 36px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-foreground}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.text-base-medium}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 38px
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
  button-ghost:
    textColor: "{colors.text}"
    typography: "{typography.text-base-medium}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 36px
  button-ghost-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    typography: "{typography.text-base-medium}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 36px
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.text-base}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
    height: 38px
  select:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.text-base}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
    height: 38px
  table-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.text-sm-semibold}"
    rounded: "{rounded.none}"
    padding: 8px 12px
    height: 34px
  table-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.text-base}"
    rounded: "{rounded.none}"
    padding: 8px 12px
    height: 38px
  table-row-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
  badge:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.text-sm-semibold}"
    rounded: "{rounded.sm}"
    padding: 4px 8px
    height: 26px
  control-disabled:
    backgroundColor: "{colors.disabled-surface}"
    textColor: "{colors.disabled-foreground}"
  table-row-selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.text}"
---

# Stripe-like light product UI

## Overview

A light commerce surface captured across a marketing page and a dashboard of one product: white page, a tinted panel colour, a saturated indigo brand, layered shadows for elevation, and a red used only for validation errors.

Distilled by ingot-engine 0.4.0 from 10 captured components across 2 origins. Every value below was measured from those captures or derived from a value that was; where nothing in the evidence implied a value, the token's own record in `tokens.json` says so.

This is a **light** system. Build against the tokens in the front matter and nothing else: when you need a value that is not here, compose it from the scales that are rather than introducing a new one. A kit with one more colour in it is a different kit.

## Colors

15 roles, and there are no other colours in this system. Roles rather than a numbered ramp: each name says what the colour is *for*, and two of them with the same hex is a fact about this kit rather than a mistake.

- **`background` (#ffffff):** the page behind everything.
- **`surface` (#f6f9fc):** cards, panels, popovers and anything raised off the page.
- **`surface-hover` (#eceff2):** an interactive surface under the pointer.
- **`surface-selected` (#e9ebfa):** a selected row, tab or nav item.
- **`border` (#e3e8ee):** every separator and control outline.
- **`text` (#1a1f36):** default body and heading text.
- **`text-muted` (#606a7d):** captions, placeholders and metadata.
- **`primary` (#635bff):** the brand fill: primary buttons and active states.
- **`primary-hover` (#594df1):** a primary fill under the pointer.
- **`primary-active` (#503fe3):** a primary fill being pressed.
- **`primary-foreground` (#ffffff):** text and icons drawn on a primary fill.
- **`destructive` (#df1b41):** irreversible actions and error states.
- **`destructive-foreground` (#ffffff):** text and icons drawn on a destructive fill.
- **`disabled-surface` (#e2e5e8):** the fill of a control that cannot be used.
- **`disabled-foreground` (#788296):** the label of a control that cannot be used.

`destructive` is reserved for irreversible actions and error states. Never use it for emphasis. It is contrast-checked as a text colour as well as a fill, so error copy may be set in it.

## Typography

One family, `"Sohne Var", "Helvetica Neue", Helvetica, Arial, sans-serif`, at a base size of 14px and a scale ratio of 1.326.

The `text-*` tokens are the size scale, each at the weight the captures set that size in. The `text-*-<weight>` tokens exist because controls do not always take their scale's weight — a button is the base step set in medium, a table header the small step set in semibold — and a component that referenced the plain step would render lighter than this kit specifies.

Weights in use: **regular** (400), **medium** (500), **semibold** (600). Do not introduce a weight that is not on this list.

## Layout

Every length in this system is a multiple of a **4px** base unit. Each observed padding, margin and gap length is snapped to the nearest multiple of the base unit; exact .5 ties round up. A non-zero length shorter than half the base unit snaps up to one base unit rather than collapsing to 0, because a visible gap must stay visible. Steps are named by their multiplier, so step "3" is 3 x the base unit.

Steps up to the largest observed length are component steps: a capture is one component, so that is as far as the evidence reaches. The same multiplier series is then continued past it into layout steps at 32px, 40px, 48px, 64px, which are extrapolated rather than observed. Use component steps for padding and gaps inside a control, and layout steps for page gutters, section rhythm and the space between cards.

Steps at or below 6 multiples of the base unit are *component* spacing — padding and gaps the captures actually reported. Anything above it is *layout* spacing, extrapolated to give page-level rhythm somewhere on-scale to live: 100% of the raw observations were already exact multiples of the base unit, which is the evidence that the scale fits.

## Elevation & Depth

Elevation is drawn with shadows, ordered by how far off the page they read. The spec has no token group for shadows, so these are the canonical values and they are stated here in full:

- **`sm`:** `box-shadow: 0px 1px 1px 0px rgb(0 0 0 / 0.03)`
- **`md`:** `box-shadow: 0px 1px 1px 0px rgb(0 0 0 / 0.08)`
- **`lg`:** `box-shadow: 0px 2px 5px -1px rgb(50 50 93 / 0.25), 0px 1px 3px -1px rgb(0 0 0 / 0.3)`

Use one of these exactly. Do not interpolate between two steps.

## Shapes

Corners come from the `rounded` scale: `none` at 0px, `sm` at 4px, `md` at 6px, `lg` at 8px. Every control names one of these steps; none of them carries a radius of its own.

Every border in this system is **1px** and drawn in `border`. Width is not a variable here — a heavier line is not how this kit signals anything.

## Components

10 controls, each fully specified in the front matter, with its hover and pressed fills as `*-hover` and `*-active` variant keys beside it.

What follows is what the front matter cannot carry. The spec's component sub-tokens are a closed list — `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width` — so **which colour outlines a control has no key of its own**, and is stated below instead. Every border in this kit is `border` at 1px; the list says which controls draw one.

- **`card`** — Panels, cards and any titled box that holds other components. Outlined in `border` at 1px.
- **`button-primary`** — The one call to action on a screen. Draws no border.
- **`button-secondary`** — Every other action that is not destructive. Outlined in `border` at 1px.
- **`button-ghost`** — Toolbar and icon actions; transparent until hovered. Draws no border.
- **`button-destructive`** — Irreversible actions only. Never for emphasis. Draws no border.
- **`input`** — Text fields and textareas. Outlined in `border` at 1px.
- **`select`** — Native and custom selects. A text field with a chevron. Outlined in `border` at 1px.
- **`table-header`** — Column headings. One rule underneath, never a filled band. Outlined in `border` at 1px.
- **`table-row`** — Data rows. Separated by a rule, highlighted on hover. Outlined in `border` at 1px.
- **`badge`** — Status pills inside tables and cards. Outlined in `border` at 1px.

### States

- **Focus.** A 2px ring in `primary`, offset 2px from the control. Every interactive element gets it, and it is the one state signal that never depends on a fill.
- **Hover and pressed.** The `*-hover` component variants in the front matter. A control with no hover variant has no hover fill in this kit; use the ring.
- **Selected.** A selected row, tab or nav item is filled with `surface-selected` and keeps `text` on top. Selection reads by hue and hover reads by lightness; do not swap them.
- **Disabled.** The `control-disabled` component: fill `disabled-surface`, label `disabled-foreground`, for every control rather than one of them. The pair measures **3.06:1**, held to a floor of 3:1 rather than the 4.5:1 this kit holds every other pair to — a disabled control that reads as ordinary body text is not disabled, and WCAG 1.4.3 exempts inactive components from the minimum for that reason. A conformance checker that does not model the exemption will flag this one pair; that is the intended reading and not a defect to fix. Never build the state out of `opacity` instead: an opacity ramp cannot be contrast-checked, and it measures 1:1 on a light kit.
- **Error.** Message and field border in `destructive` (#df1b41). Keep the message text at the base step; the colour carries the signal.

## Do's and Don'ts

- Do take every colour from the `colors` map. There are no other colours in this system.
- Do compose a value the tokens do not name — a card's inner gap, a field label's size — from the scales above. Don't introduce a new token for it.
- Do keep every length a multiple of the 4px base unit.
- Do reference a component's `typography` token rather than restating its size and weight. The two drift.
- Don't use `primary` as a text colour. It is a fill, and `primary-foreground` is what goes on top of it.
- Don't signal a disabled state with `opacity`. Use the two disabled colours above.
- `button-destructive` has no derived hover fill in this kit. Keep its fill constant on hover and use the focus ring for feedback rather than inventing a darker red.
- Don't add a weight, a radius or a shadow step that is not listed above. The absence of one is a decision this kit made.

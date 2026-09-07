/**
 * `design.md` generator, targeting Tailwind CSS v4 + shadcn/ui.
 *
 * This is the only layer in the engine that knows Tailwind or shadcn exists.
 * The token model above it is stack-agnostic; adding a second target means
 * adding a sibling module here, never touching `tokens/types.ts`.
 *
 * The reader is an LLM being asked to write code against this kit, so the
 * output is written for one: concrete values, imperative rules, explicit
 * prohibitions, no rationale it cannot act on and no marketing prose.
 */
import { byString } from '../util/sort'
import { finish, plural, table } from './markdown'
import { overriddenSlots } from '../tokens/overrides'
import { SHADE_RELATIONS } from '../color/roles'
import { round } from '../util/num'
import type {
  ColorRoleName,
  ColorToken,
  ComponentRecipe,
  RadiusStepName,
  ShadowStepName,
  TokensDocument,
} from '../tokens/types'

/**
 * Role -> shadcn CSS variable. Roles with no shadcn counterpart get an
 * `--ingot-*` variable so nothing is silently dropped.
 */
const SHADCN_VARIABLES: ReadonlyArray<[ColorRoleName, string, string]> = [
  ['background', '--background', 'page background'],
  ['text', '--foreground', 'default text on --background'],
  ['surface', '--card', 'panel/card background; also --popover'],
  ['text', '--card-foreground', 'text on --card; also --popover-foreground'],
  ['primary', '--primary', 'brand fill: primary buttons, active states'],
  ['primaryForeground', '--primary-foreground', 'text/icons on --primary'],
  ['surface', '--secondary', 'secondary button fill'],
  ['text', '--secondary-foreground', 'text on --secondary'],
  ['surface', '--muted', 'muted block background'],
  ['textMuted', '--muted-foreground', 'de-emphasised text, placeholders, captions'],
  ['surfaceHover', '--accent', 'hover fill for rows, menu items, ghost buttons'],
  ['text', '--accent-foreground', 'text on --accent'],
  ['border', '--border', 'all 1px separators and control outlines'],
  ['border', '--input', 'input outlines'],
  ['primary', '--ring', 'focus ring'],
  ['destructive', '--destructive', 'destructive fill and destructive text'],
  ['destructiveForeground', '--destructive-foreground', 'text on --destructive'],
  ['surfaceHover', '--ingot-surface-hover', 'raw hover surface'],
  ['primaryHover', '--ingot-primary-hover', 'primary hover fill'],
  ['primaryActive', '--ingot-primary-active', 'primary pressed fill'],
  ['selectedSurface', '--ingot-selected-surface', 'selected row and active nav item fill'],
  ['disabledSurface', '--ingot-disabled-surface', 'disabled control fill'],
  ['disabledForeground', '--ingot-disabled-foreground', 'disabled label and icon colour'],
]

const RADIUS_ORDER: RadiusStepName[] = ['none', 'sm', 'md', 'lg', 'full']
const SHADOW_ORDER: ShadowStepName[] = ['none', 'sm', 'md', 'lg']

/**
 * Render the whole-library design specification for a tokens document.
 *
 * Deterministic: the output depends only on `tokens`, with no clock, no
 * environment and no randomness.
 */
export function renderDesignMarkdown(tokens: TokensDocument): string {
  const { color, spacing, border, radius, shadow, typography, components, source } = tokens
  const out: string[] = []
  const push = (...lines: string[]): void => {
    out.push(...lines)
  }

  const role = (name: ColorRoleName): ColorToken | undefined => color.roles[name]
  const hexOf = (name: ColorRoleName): string => role(name)?.value.hex ?? 'n/a'

  // Values a human replaced in the panel. They are as binding as the distilled
  // ones -- more so, since somebody looked at them -- but a reader is entitled
  // to know which numbers came from the captures and which came from a person.
  const overridden = overriddenSlots(tokens)
  const overriddenPaths = new Set(overridden.map((slot) => slot.path))
  /** Appended to a cell whose value a person set, so the table is self-labelling. */
  const mark = (path: string): string => (overriddenPaths.has(path) ? ' *(user override)*' : '')

  // --- header ---------------------------------------------------------------
  push(
    `# ${source.name} — design system`,
    '',
    `Distilled by ${tokens.engine.name} ${tokens.engine.version} from ${plural(source.captureCount, 'captured component')} across ${plural(source.origins.length, 'origin')}.`,
    '',
    `${source.description}`,
    '',
    'You are implementing UI against this system. Use only the values below. When a value you need is not here, compose it from the tokens that are — do not introduce a new one.',
    '',
    `- Colour mode: **${color.mode}**`,
    `- Stack: Tailwind CSS v4 + shadcn/ui`,
    `- Spacing base unit: **${spacing.baseUnit}px**`,
    `- Border width: **${border.width.value}px**`,
    `- Type base size: **${typography.baseSize}px**, scale ratio ${typography.scaleRatio}`,
    '',
  )

  if (overridden.length > 0) {
    push(
      `> **${plural(overridden.length, 'value')} in this document ${overridden.length === 1 ? 'was' : 'were'} set by hand, not distilled.** They are as binding as the rest — a person reviewed the evidence and disagreed with it — and every one is listed with the engine's own answer in §10. Where a value below is marked *(user override)*, that is what it means.`,
      '',
    )
  }

  // --- theme block ----------------------------------------------------------
  push(
    '## 1. Theme variables',
    '',
    `Paste this into your global stylesheet. Values are OKLCH, matching the shadcn/ui default theme format. The mode is \`${color.mode}\`; place it under \`${color.mode === 'dark' ? '.dark' : ':root'}\` and keep the counterpart mode's values as they were.`,
    '',
    '```css',
    color.mode === 'dark' ? '.dark {' : ':root {',
  )
  for (const [roleName, variable, purpose] of SHADCN_VARIABLES) {
    const token = role(roleName)
    if (!token) continue
    push(`  ${variable}: ${token.value.oklch}; /* ${token.value.hex} — ${purpose} */`)
  }
  const mdRadius = radius.steps.md
  if (mdRadius) push(`  --radius: ${mdRadius.value}px;`)
  push('}', '```', '')

  push(
    'Tailwind v4 theme mapping:',
    '',
    '```css',
    '@theme inline {',
    '  --color-background: var(--background);',
    '  --color-foreground: var(--foreground);',
    '  --color-card: var(--card);',
    '  --color-card-foreground: var(--card-foreground);',
    '  --color-primary: var(--primary);',
    '  --color-primary-foreground: var(--primary-foreground);',
    '  --color-muted: var(--muted);',
    '  --color-muted-foreground: var(--muted-foreground);',
    '  --color-accent: var(--accent);',
    '  --color-accent-foreground: var(--accent-foreground);',
    '  --color-border: var(--border);',
    '  --color-input: var(--input);',
    '  --color-ring: var(--ring);',
  )
  if (role('destructive')) {
    push('  --color-destructive: var(--destructive);', '  --color-destructive-foreground: var(--destructive-foreground);')
  }
  push(
    `  --radius-sm: ${radius.steps.sm?.value ?? 2}px;`,
    `  --radius-md: ${radius.steps.md?.value ?? 6}px;`,
    `  --radius-lg: ${radius.steps.lg?.value ?? 12}px;`,
    '}',
    '```',
    '',
  )

  // --- colour roles ---------------------------------------------------------
  push(
    '## 2. Colour roles',
    '',
    'Every colour in the UI must come from this table. There are no other colours in this system.',
    '',
  )
  push(
    ...table(
      ['Role', 'Hex', 'OKLCH', 'Use it for'],
      Object.keys(color.roles)
        .filter((key): key is ColorRoleName => color.roles[key as ColorRoleName] !== undefined)
        .map((name) => {
          const token = color.roles[name] as ColorToken
          const purpose =
            SHADCN_VARIABLES.find(([roleName]) => roleName === name)?.[2] ?? 'supporting role'
          return [
            `\`${name}\``,
            token.value.hex,
            token.value.oklch,
            `${purpose}${mark(`color.roles.${name}`)}`,
          ]
        }),
    ),
    '',
  )

  // Which shade/base pairings are supposed to differ is one list, owned by the
  // colour layer. Reading it and comparing the document's own hexes keeps this a
  // pure function of the tokens document, and keeps the diagnostic's sentence a
  // convenience rather than a parsing contract.
  const collapsedStates = SHADE_RELATIONS.filter(
    ([shade, base]) => role(shade) !== undefined && role(base) !== undefined && hexOf(shade) === hexOf(base),
  )

  push(
    '### Colour rules',
    '',
    `- Text on \`background\` or \`surface\` is \`text\`. De-emphasised text is \`textMuted\`. There is no third text colour.`,
    `- \`primary\` is a fill, not a text colour. Use \`primaryForeground\` for anything drawn on top of it.`,
    `- Hover on an interactive surface goes to \`surfaceHover\`; hover on a primary fill goes to \`primaryHover\`; the pressed state is \`primaryActive\`.`,
    `- A selected row, tab or nav item is filled with \`selectedSurface\` (${hexOf('selectedSurface')}) and keeps \`text\` on top. Selection reads by hue, hover reads by lightness; do not swap them.`,
    `- A disabled control is filled with \`disabledSurface\` (${hexOf('disabledSurface')}) and labelled \`disabledForeground\` (${hexOf('disabledForeground')}). Never build a disabled state out of \`opacity\`.`,
    `- Borders are ${border.width.value}px \`border\`. Do not use shadows in place of borders for separation, and do not use \`text\` at reduced opacity as a border.`,
    role('destructive')
      ? `- \`destructive\` is reserved for irreversible actions and error states. Never use it for emphasis. It is contrast-checked as a text colour as well as a fill, so error copy may be set in it.`
      : `- This system has no destructive colour. If you need one, add it explicitly rather than reaching for an arbitrary red.`,
    '',
  )

  if (collapsedStates.length > 0) {
    push(
      `> **These states render identically:** ${collapsedStates.map(([shade, base]) => `\`${shade}\` and \`${base}\``).join(', ')}. Holding the label at the contrast floor consumed the whole offset, so the fill cannot carry the distinction on this palette. Signal the state with the focus ring, a border, or a transform — not with the fill.`,
      '',
    )
  }

  const failing = color.contrast.filter((pair) => !pair.passes)
  const disabledFloor = components.states.disabled.floor
  push(
    '### Contrast',
    '',
    'This table is exhaustive: every pair the kit puts on screen is measured here, including the derived hover, pressed and selected surfaces. Text pairs are guaranteed at or above **4.5:1** (WCAG 2.1 AA, normal text). The disabled pair is held to ' +
      `**${disabledFloor}:1** on purpose — WCAG 2.1 exempts inactive controls from 1.4.3, and a disabled label that clears the body-text floor stops reading as disabled.`,
    '',
    ...table(
      ['Foreground', 'Background', 'Ratio', 'Floor', 'Status'],
      color.contrast.map((pair) => [
        `\`${pair.foreground.replace('color.roles.', '')}\``,
        `\`${pair.background.replace('color.roles.', '')}\``,
        `${pair.ratio}:1`,
        `${pair.floor}:1`,
        pair.passes ? 'pass' : 'FAILS',
      ]),
    ),
    '',
  )

  const adjusted = Object.entries(color.roles).filter(
    ([, token]) => (token as ColorToken).contrastAdjustment !== undefined,
  )
  if (adjusted.length > 0) {
    push(
      'The following roles were moved away from the value they started at to reach their floor — a captured colour for an observed role, the offset the engine computed for a derived one. Use the adjusted values; the originals fail accessibility.',
      '',
    )
    for (const [name, token] of adjusted) {
      const adjustment = (token as ColorToken).contrastAdjustment
      if (!adjustment) continue
      push(
        `- \`${name}\`: ${adjustment.from.hex} → ${adjustment.to.hex} (${adjustment.ratioBefore}:1 → ${adjustment.ratioAfter}:1). ${adjustment.reason}.`,
      )
    }
    push('')
  }
  if (failing.length > 0) {
    push(
      `> **Unresolved:** ${failing.length} pair(s) still fall below the floor and could not be fixed by lightness alone. Do not use them for body text.`,
      '',
    )
  }

  // --- typography -----------------------------------------------------------
  push(
    '## 3. Typography',
    '',
    `- Body font stack: \`${typography.families.sans.value}\``,
    typography.families.mono ? `- Monospace stack: \`${typography.families.mono.value}\`` : '- No monospace font is defined. Use the browser default `ui-monospace, monospace` for code.',
    `- Base size: ${typography.baseSize}px. Adjacent steps differ by roughly ${typography.scaleRatio}x.`,
    '',
    ...table(
      ['Step', 'font-size', 'line-height', 'font-weight', 'letter-spacing', 'Tailwind'],
      typography.steps.map((step) => [
        `\`${step.value.name}\``,
        `${step.value.fontSize}px`,
        `${step.value.lineHeight}`,
        `${step.value.fontWeight}`,
        step.value.letterSpacing !== undefined ? `${step.value.letterSpacing}px` : 'normal',
        `text-[${step.value.fontSize}px]/[${step.value.lineHeight}]`,
      ]),
    ),
    '',
    '### Type rules',
    '',
    `- Use only these ${typography.steps.length} sizes. Do not interpolate between them.`,
    `- Every size carries the line height listed with it. Do not pair a size with a different line height.`,
    `- Weights in this system: ${typography.weights.map((weight) => `${weight.value.value} (${weight.value.name})`).join(', ')}. Use no others.`,
    `- Body copy is \`base\` at weight ${typography.steps.find((step) => step.value.name === 'base')?.value.fontWeight ?? 400}.`,
    '',
  )

  // --- spacing --------------------------------------------------------------
  const layoutSteps = spacing.steps.filter((step) => step.value.band === 'layout')
  const componentSteps = spacing.steps.filter((step) => step.value.band === 'component')
  push(
    '## 4. Spacing',
    '',
    `Base unit **${spacing.baseUnit}px**. ${round(spacing.fit * 100, 1)}% of the captured lengths were already exact multiples of it.`,
    '',
    'The scale has two bands. **Component** steps sit at or below the largest observed length: a capture is one component, so the evidence stops at that component\'s own padding, and each step\'s provenance records whether it was observed or gap-filled. **Layout** steps continue the same multiplier series past the largest observation, because page rhythm has to come from somewhere and inventing it per screen is worse than stating it here.',
    '',
    ...table(
      ['Step', 'px', 'Band', 'Tailwind'],
      spacing.steps.map((step) => [
        `\`${step.value.name}\``,
        `${step.value.px}px`,
        step.value.band,
        step.value.px === 0 ? '`p-0` / `gap-0`' : `\`p-[${step.value.px}px]\` / \`gap-[${step.value.px}px]\``,
      ]),
    ),
    '',
    '### Spacing rules',
    '',
    `- Every padding, margin and gap is a multiple of ${spacing.baseUnit}px drawn from the table above.`,
    componentSteps.length > 0
      ? `- Inside a control or a card, use the component steps (up to ${componentSteps[componentSteps.length - 1]?.value.px ?? 0}px). They stay within the range the sources actually use.`
      : '- No component steps were observed; every step in this table is extrapolated.',
    layoutSteps.length > 0
      ? `- Between cards, between sections and around the page, use the layout steps (${layoutSteps.map((step) => `${step.value.px}px`).join(', ')}). Do not pad a page with a component step: that is what makes a generated screen read as cramped.`
      : '- The captures already reach layout range, so no extrapolated steps were needed.',
    `- Snapping rule applied during distillation: ${spacing.snappingRule}`,
    `- Do not use arbitrary values such as \`p-[13px]\` or \`mt-[7px]\`. If a layout seems to need one, pick the nearer step.`,
    '',
  )

  // --- radius ---------------------------------------------------------------
  push(
    '## 5. Radius',
    '',
    ...table(
      ['Step', 'px', 'Tailwind', 'Use it for'],
      RADIUS_ORDER.filter((name) => radius.steps[name] !== undefined).map((name) => {
        const token = radius.steps[name]
        const px = token?.value ?? 0
        const usage =
          name === 'none'
            ? 'flush edges, table cells, full-bleed sections'
            : name === 'sm'
              ? 'inputs, badges, small controls'
              : name === 'md'
                ? 'buttons and most controls'
                : name === 'lg'
                  ? 'cards, panels, modals'
                  : 'pills and avatars'
        const utility = name === 'full' ? '`rounded-full`' : px === 0 ? '`rounded-none`' : `\`rounded-[${px}px]\``
        return [`\`${name}\``, `${px}px`, utility, usage]
      }),
    ),
    '',
    `- Default to \`md\` (${radius.steps.md?.value ?? 6}px). Nest smaller radii inside larger ones, never the reverse.`,
    `- Every border in this system is \`${border.width.value}px solid var(--border)\`. Do not vary border width.`,
    '',
  )

  // --- shadows --------------------------------------------------------------
  push('## 6. Elevation', '')
  const shadowSteps = SHADOW_ORDER.filter((name) => shadow.steps[name] !== undefined)
  if (shadowSteps.length <= 1) {
    push(
      'This system uses no shadows. Separate surfaces with `border` and `surface`, not elevation.',
      '',
    )
  } else {
    push(
      ...table(
        ['Step', 'box-shadow'],
        shadowSteps.map((name) => [`\`${name}\``, `\`${shadow.steps[name]?.value.css ?? 'none'}\``]),
      ),
      '',
      '- `sm` is for resting controls, `md` for cards, `lg` for overlays and popovers. Do not stack shadows.',
      '',
    )
  }


  // --- components -----------------------------------------------------------
  // The section the kit did not have. Everything above says which values exist;
  // this says what a button is. Without it two consumers of one kit ship two
  // different products, because both have to invent the same numbers alone.
  const shortRole = (path: string | null): string =>
    path === null ? '—' : `\`${path.replace('color.roles.', '')}\``

  /**
   * Where a recipe's geometry came from. Every kind that contributed is named,
   * so "half measured, half defaulted" never reads as "measured".
   */
  const recipeSource = (recipe: ComponentRecipe): string => {
    const decisions = [
      recipe.height,
      recipe.paddingY,
      recipe.paddingX,
      recipe.radius,
      recipe.typeStep,
      recipe.fontWeight,
    ].map((token) => token.provenance.decision)
    const kinds: string[] = []
    if (decisions.some((decision) => decision.strategy === 'user-override')) kinds.push('user override')
    if (decisions.some((decision) => decision.strategy !== 'derived' && decision.strategy !== 'sanctioned-default')) {
      kinds.push('captured')
    }
    const borrowed = decisions.find((decision) => decision.derivation?.method === 'same-geometry-as')
    if (borrowed) {
      const from = (borrowed.derivation?.from[0] ?? '').replace('components.recipes.', '').replace(/\.[^.]+$/, '')
      kinds.push(`like \`${from}\``)
    }
    if (decisions.some((decision) => decision.strategy === 'sanctioned-default')) kinds.push('default')
    return kinds.length > 0 ? kinds.join(' + ') : 'derived'
  }

  const stepFontSize = (name: string): string => {
    const step = typography.steps.find((entry) => entry.value.name === name)
    return step ? `${step.value.fontSize}px/${step.value.lineHeight}` : name
  }

  push(
    '## 7. Components',
    '',
    'Each control below is fully specified. These are not defaults to adjust — a screen built with a 32px button and a screen built with a 40px button are two different products, and the whole point of this section is that both of you get the same one. Use these numbers.',
    '',
    ...table(
      ['Component', 'Height', 'Padding (y, x)', 'Radius', 'Type', 'Weight', 'From'],
      components.recipes.map((recipe) => [
        `\`${recipe.name}\``,
        `${recipe.height.value}px`,
        `${recipe.paddingY.value}px, ${recipe.paddingX.value}px`,
        `\`${recipe.radius.value}\` (${radius.steps[recipe.radius.value]?.value ?? 0}px)`,
        `\`${recipe.typeStep.value}\` (${stepFontSize(recipe.typeStep.value)})`,
        `${recipe.fontWeight.value}`,
        recipeSource(recipe),
      ]),
    ),
    '',
    'Colours for the same controls:',
    '',
    ...table(
      ['Component', 'Fill', 'Text', 'Border', 'Hover fill', 'What it is for'],
      components.recipes.map((recipe) => [
        `\`${recipe.name}\``,
        shortRole(recipe.colors.surface),
        shortRole(recipe.colors.foreground),
        shortRole(recipe.colors.border),
        shortRole(recipe.colors.hoverSurface),
        recipe.purpose,
      ]),
    ),
    '',
    '### Component rules',
    '',
    `- Height is the border-box height: \`padding-y x 2 + line box + border x 2\`. Set it explicitly rather than letting content decide, so a button with an icon and a button with a label are the same height.`,
    `- A control's radius is the step named above, not a px value of your own. Nest smaller radii inside larger ones.`,
    `- The type step carries its line height with it (see §3). Do not restyle a control's font size away from its step.`,
    `- \`From\` says where the geometry came from: \`captured\` was measured in the sources, \`like x\` was taken from another recipe, \`default\` is this engine's sanctioned value because nothing described that control. Per-value provenance is in \`tokens.json\` under \`components.recipes\`.`,
    role('destructive')
      ? `- \`button.destructive\` has no derived hover fill in this kit. Keep its fill constant on hover and use the focus ring for feedback rather than inventing a darker red.`
      : `- There is no destructive button in this kit, because there is no destructive colour (see §2). Do not add one from outside the system.`,
    '',
    '### States',
    '',
    ...table(
      ['State', 'How to draw it'],
      [
        [
          'hover',
          `The recipe's hover fill above. On a primary fill that is \`primaryHover\` (${hexOf('primaryHover')}).`,
        ],
        ['pressed', `\`primaryActive\` (${hexOf('primaryActive')}) on a primary fill; otherwise keep the hover fill.`],
        [
          'focus',
          `\`${components.states.focusRing.width.value}px solid var(--ring)\` at \`outline-offset: ${components.states.focusRing.offset.value}px\`, on every focusable control. Never remove it.`,
        ],
        [
          'selected',
          `Fill \`selectedSurface\` (${hexOf('selectedSurface')}), text \`text\`.`,
        ],
        [
          'disabled',
          `Fill \`disabledSurface\` (${hexOf('disabledSurface')}), text \`disabledForeground\` (${hexOf('disabledForeground')}), measured at ${components.states.disabled.ratio}:1. Keep the border. Do **not** use \`opacity\`.`,
        ],
      ],
    ),
    '',
    `\`opacity\` is not a disabled state: on a light kit a 50% label over a 50% fill measures 1:1 and disappears. The two colours above are real, and they are checked (§2).`,
    '',
  )

  // --- do-not rules ---------------------------------------------------------
  push(
    '## 8. Do not',
    '',
    '- Do not introduce a colour, size, spacing value, radius or shadow that is not in this document.',
    '- Do not invent a control height or padding. §7 gives every control both.',
    '- Do not use Tailwind default palette utilities (`bg-slate-900`, `text-gray-500`, `border-zinc-200`). Use the theme variables.',
    '- Do not use `text-white` or `text-black`. Use `text-foreground`, `text-muted-foreground` or `text-primary-foreground`.',
    `- Do not use opacity to make text quieter or a control inactive. Use \`textMuted\` (${hexOf('textMuted')}) for quiet text and \`disabledForeground\` (${hexOf('disabledForeground')}) on \`disabledSurface\` (${hexOf('disabledSurface')}) for disabled controls. Both are contrast-checked; opacity cannot be.`,
    `- Do not change the values of \`primary\` (${hexOf('primary')}) or \`background\` (${hexOf('background')}) per component.`,
    '- Do not add gradients, glows, or animated colour transitions. Nothing in the captured sources uses them.',
    '- Do not restyle shadcn/ui primitives inline. Change the theme variables above instead.',
    '',
  )

  // --- provenance appendix --------------------------------------------------
  // Only winner-take-all slots belong here. A scale step that "won" 8 of 28
  // corners did not beat a rival for its slot -- it *is* its slot -- so listing
  // it as a close call would train the reader to ignore this section.
  const contested = [
    ...Object.entries(color.roles).map(([name, token]) => ({
      path: `color.roles.${name}`,
      decision: (token as ColorToken).provenance.decision,
    })),
    { path: 'typography.families.sans', decision: typography.families.sans.provenance.decision },
    ...(typography.families.mono
      ? [{ path: 'typography.families.mono', decision: typography.families.mono.provenance.decision }]
      : []),
    { path: 'border.width', decision: border.width.provenance.decision },
  ]
    .filter(
      (entry) =>
        entry.decision.strategy !== 'derived' &&
        entry.decision.competitors.length > 0 &&
        entry.decision.confidence < 0.6,
    )
    .sort((a, b) => byString(a.path, b.path))

  push('## 9. Where this came from', '')
  push(
    ...table(
      ['Origin', 'Captures'],
      source.origins.map((entry) => [entry.origin, String(entry.captureCount)]),
    ),
    '',
    `Component types captured: ${source.componentTypes.map((entry) => `${entry.type} (${entry.count})`).join(', ')}.`,
    '',
  )

  if (contested.length > 0) {
    push(
      'These tokens beat a close rival. Check them against the sources before relying on them:',
      '',
      ...contested.map((entry) => `- \`${entry.path}\`: ${entry.decision.summary}`),
      '',
    )
  }

  const warnings = tokens.diagnostics.filter((diagnostic) => diagnostic.level === 'warning')
  if (warnings.length > 0) {
    push('Warnings raised during distillation:', '', ...warnings.map((diagnostic) => `- **${diagnostic.code}**: ${diagnostic.message}`), '')
  }

  push(
    'Full provenance for every token — contributing capture ids, raw observed values, and the machine-readable dominant-choice record behind each decision — is in `tokens.json` next to this file.',
    '',
  )

  // --- user overrides -------------------------------------------------------
  // Emitted only when there are any, so a kit nobody has reviewed does not
  // carry an empty section explaining a thing that did not happen.
  if (overridden.length > 0) {
    push(
      '## 10. User overrides',
      '',
      `${plural(overridden.length, 'value')} below ${overridden.length === 1 ? 'was' : 'were'} set by hand in the Ingot panel. Treat them exactly as you treat the distilled values: they are the system. The engine's own answer is given beside each one so you can see what was disagreed with, and the evidence behind that answer is untouched in \`tokens.json\` — an override changes the answer, never the evidence.`,
      '',
      ...table(
        ['Token', 'Value', 'The engine chose', 'Reason given'],
        overridden.map((slot) => {
          const decision = slot.provenance.decision
          return [
            `\`${slot.path}\``,
            slot.value,
            decision.supersedes?.chosen ?? '—',
            decision.note ?? '—',
          ]
        }),
      ),
      '',
      'When a later distillation disagrees with an override, the disagreement is raised as an `override.conflict` warning above rather than resolved silently: the override keeps the value, and a human decides whether the new evidence changes their mind.',
      '',
    )
  }

  return finish(out)
}

/**
 * The component documentation model: one description, three surfaces.
 *
 * The captain's call was that the kit docs are not a second engine -- the
 * canonical component renderer that draws the live preview also draws the
 * in-panel docs and the static export. That settles the *rendering*. This file
 * settles the other half: the prose and the token subset each component needs,
 * so the panel's docs view, the static export and the per-component markdown
 * all say the same thing about a button because they read the same object.
 *
 * Everything here is derived from the tokens document. No sentence in this file
 * describes a value the kit does not carry, and a value the reviewer overrode
 * arrives labelled as overridden, because {@link originOf} reads the same
 * provenance the panel does.
 */
import { byString } from '../util/sort'
import { originOf, tokenSlots } from '../tokens/overrides'
import type { TokenOrigin } from '../tokens/overrides'
import type { Provenance } from '../provenance'
import type {
  ColorRoleName,
  ComponentRecipe,
  ComponentRecipeName,
  TokensDocument,
} from '../tokens/types'

/** One value the component is built from, with where it came from. */
export interface DocTokenRow {
  /** What the value is, in the component's own language: `"height"`, `"radius"`. */
  label: string
  /** Dotted token path, so a reader can find it in `tokens.json`. */
  path: string
  /** The value in decision notation. */
  value: string
  /** A second reading when the value names a step: `"md"` resolves to `"6px"`. */
  resolved?: string
  origin: TokenOrigin
  provenance: Provenance
}

/** One colour the component paints with. */
export interface DocColorRow {
  /** The component's word for the colour: `"fill"`, `"label"`, `"hover fill"`. */
  label: string
  /** The role name, or `null` when the component deliberately has none. */
  role: ColorRoleName | null
  hex: string | null
  /**
   * Where the colour came from, or `null` for a deliberate absence.
   *
   * Colours carry an origin for the same reason the geometry does: a hand-set
   * brand colour has to say so on the page that documents the button drawn in
   * it, not only in the token table it never appears in.
   */
  origin: TokenOrigin | null
}

/** One thing the component can look like, for the renderer to draw. */
export interface DocVariant {
  /** Stable id the renderer switches on. */
  id: string
  label: string
  /** The recipe this variant is drawn from, when it has one. */
  recipe?: ComponentRecipeName
  /** One line on when to use it. */
  note: string
}

/** Everything three surfaces need to say about one component. */
export interface ComponentDoc {
  /** Stable slug: `"button"`, `"input"`, ... Used in URLs and file names. */
  id: ComponentDocId
  title: string
  /** One paragraph: what this component is in this kit. */
  summary: string
  variants: DocVariant[]
  /** Interaction states this component actually has, in draw order. */
  states: string[]
  tokens: DocTokenRow[]
  colors: DocColorRow[]
  /** Imperative rules a consumer must follow. */
  usage: string[]
  /** Prohibitions, phrased so an LLM can check itself against them. */
  doNot: string[]
}

/** The docs a kit can show, in navigation order. */
export const COMPONENT_DOC_IDS = [
  'button',
  'input',
  'select',
  'card',
  'badge',
  'table',
  'typography',
] as const

export type ComponentDocId = (typeof COMPONENT_DOC_IDS)[number]

/** Every component doc this kit supports, in navigation order. */
export function componentDocs(tokens: TokensDocument): ComponentDoc[] {
  return COMPONENT_DOC_IDS.map((id) => componentDoc(tokens, id))
}

/** One component doc. Throws on an unknown id, which is a programming error. */
export function componentDoc(tokens: TokensDocument, id: ComponentDocId): ComponentDoc {
  const ctx = context(tokens)
  switch (id) {
    case 'button':
      return buttonDoc(ctx)
    case 'input':
      return fieldDoc(ctx, 'input', 'Input', 'input')
    case 'select':
      return fieldDoc(ctx, 'select', 'Select', 'select')
    case 'card':
      return cardDoc(ctx)
    case 'badge':
      return badgeDoc(ctx)
    case 'table':
      return tableDoc(ctx)
    case 'typography':
      return typographyDoc(ctx)
  }
}

/* --------------------------------------------------------------- context -- */

interface Context {
  tokens: TokensDocument
  /** Slot lookup by path, so origin and provenance are read once. */
  slot: (path: string) => { value: string; origin: TokenOrigin; provenance: Provenance } | undefined
  recipe: (name: ComponentRecipeName) => ComponentRecipe | undefined
  hex: (role: ColorRoleName | null) => string | null
  /** One colour row, with the role's own origin attached. */
  color: (label: string, role: ColorRoleName | null) => DocColorRow
  radiusPx: (step: string) => string
  typePx: (step: string) => string
}

function context(tokens: TokensDocument): Context {
  const slots = new Map(
    tokenSlots(tokens).map((slot) => [
      slot.path,
      { value: slot.value, origin: originOf(slot), provenance: slot.provenance },
    ]),
  )
  return {
    tokens,
    slot: (path) => slots.get(path),
    recipe: (name) => tokens.components.recipes.find((entry) => entry.name === name),
    hex: (role) => (role === null ? null : (tokens.color.roles[role]?.value.hex ?? null)),
    color: (label, role) => ({
      label,
      role,
      hex: role === null ? null : (tokens.color.roles[role]?.value.hex ?? null),
      origin: role === null ? null : (slots.get(`color.roles.${role}`)?.origin ?? null),
    }),
    radiusPx: (step) => {
      const value = tokens.radius.steps[step as keyof typeof tokens.radius.steps]
      return value === undefined ? '—' : `${value.value}px`
    },
    typePx: (step) => {
      const found = tokens.typography.steps.find((entry) => entry.value.name === step)
      return found === undefined ? '—' : `${found.value.fontSize}px/${found.value.lineHeight}`
    },
  }
}

/** The six geometry rows of one recipe, prefixed when a doc shows several. */
function recipeRows(ctx: Context, name: ComponentRecipeName, prefix = ''): DocTokenRow[] {
  const recipe = ctx.recipe(name)
  if (recipe === undefined) return []
  const base = `components.recipes.${name}`
  const rows: Array<[string, string, string | undefined]> = [
    ['height', 'height', undefined],
    ['padding-y', 'paddingY', undefined],
    ['padding-x', 'paddingX', undefined],
    ['radius', 'radius', ctx.radiusPx(recipe.radius.value)],
    ['type step', 'typeStep', ctx.typePx(recipe.typeStep.value)],
    ['font-weight', 'fontWeight', undefined],
  ]
  return rows.flatMap(([label, field, resolved]) => {
    const slot = ctx.slot(`${base}.${field}`)
    if (slot === undefined) return []
    const row: DocTokenRow = {
      label: prefix === '' ? label : `${prefix} ${label}`,
      path: `${base}.${field}`,
      value: slot.value,
      origin: slot.origin,
      provenance: slot.provenance,
    }
    if (resolved !== undefined) row.resolved = resolved
    return [row]
  })
}

function recipeColors(ctx: Context, name: ComponentRecipeName, prefix = ''): DocColorRow[] {
  const recipe = ctx.recipe(name)
  if (recipe === undefined) return []
  const label = (word: string): string => (prefix === '' ? word : `${prefix} ${word}`)
  const roleOf = (path: string | null): ColorRoleName | null =>
    path === null ? null : (path.replace('color.roles.', '') as ColorRoleName)
  const hover = hoverSurfaceOf(recipe)
  return [
    ctx.color(label('fill'), roleOf(recipe.colors.surface)),
    ctx.color(label('label'), roleOf(recipe.colors.foreground)),
    ctx.color(label('border'), roleOf(recipe.colors.border)),
    ctx.color(label(hover.distinct ? 'hover fill' : 'hover fill (unchanged)'), roleOf(hover.path)),
  ]
}

/**
 * The surface a recipe paints on hover.
 *
 * A recipe with no derived hover shade -- `button.destructive` in every kit
 * whose palette has one, because the engine will not invent a darker red --
 * keeps the fill it already has. Resolving that to `transparent` would document
 * a control that vanishes under the pointer, so the rule lives here, once, and
 * the preview, the docs view and the per-component markdown all read it rather
 * than each deciding for themselves.
 */
export function hoverSurfaceOf(recipe: ComponentRecipe): { path: string | null; distinct: boolean } {
  return recipe.colors.hoverSurface === null
    ? { path: recipe.colors.surface, distinct: false }
    : { path: recipe.colors.hoverSurface, distinct: true }
}


/**
 * The scale steps a component's recipes point at, as rows of their own.
 *
 * A recipe names a step (`radius: md`) rather than a number, so the number can
 * move underneath it. Listing the step itself is what lets this page say "md is
 * 10px, and a person set that" instead of quietly resolving to 10px under a
 * label that still reads "measured".
 */
function referencedScaleRows(ctx: Context, names: readonly ComponentRecipeName[]): DocTokenRow[] {
  const paths: string[] = []
  const add = (path: string): void => {
    if (!paths.includes(path)) paths.push(path)
  }
  for (const name of names) {
    const recipe = ctx.recipe(name)
    if (recipe === undefined) continue
    add(`radius.steps.${recipe.radius.value}`)
    add(`typography.steps.${recipe.typeStep.value}.fontSize`)
    add(`typography.steps.${recipe.typeStep.value}.lineHeight`)
  }
  add('border.width')

  return paths.flatMap((path) => {
    const slot = ctx.slot(path)
    if (slot === undefined) return []
    return [
      {
        label: scaleLabel(path),
        path,
        value: slot.value,
        origin: slot.origin,
        provenance: slot.provenance,
      },
    ]
  })
}

function scaleLabel(path: string): string {
  if (path === 'border.width') return 'border width'
  if (path.startsWith('radius.steps.')) return `radius step ${path.slice('radius.steps.'.length)}`
  const rest = path.slice('typography.steps.'.length)
  const [step, field] = rest.split('.')
  return `type step ${step} ${field === 'fontSize' ? 'size' : 'line height'}`
}

/** The three state rows every interactive control shares. */
function stateRows(ctx: Context): DocTokenRow[] {
  const rows: DocTokenRow[] = []
  for (const [label, path] of [
    ['focus ring width', 'components.states.focusRing.width'],
    ['focus ring offset', 'components.states.focusRing.offset'],
  ] as const) {
    const slot = ctx.slot(path)
    if (slot !== undefined) {
      rows.push({ label, path, value: slot.value, origin: slot.origin, provenance: slot.provenance })
    }
  }
  return rows
}

function stateColors(ctx: Context): DocColorRow[] {
  const states = ctx.tokens.components.states
  const role = (path: string): ColorRoleName => path.replace('color.roles.', '') as ColorRoleName
  return [
    ctx.color('disabled fill', role(states.disabled.surface)),
    ctx.color('disabled label', role(states.disabled.foreground)),
    ctx.color('focus ring', role(states.focusRing.colorRole)),
  ]
}

const CONTROL_STATES = ['default', 'hover', 'active', 'focus', 'disabled']

/* ------------------------------------------------------------- the docs -- */

function buttonDoc(ctx: Context): ComponentDoc {
  const { tokens } = ctx
  const hasDestructive = ctx.recipe('button.destructive') !== undefined
  const variants: DocVariant[] = [
    { id: 'primary', label: 'Primary', recipe: 'button.primary', note: 'The one call to action on a screen.' },
    {
      id: 'secondary',
      label: 'Secondary',
      recipe: 'button.secondary',
      note: 'Every other action that is not destructive.',
    },
    { id: 'ghost', label: 'Ghost', recipe: 'button.ghost', note: 'Toolbar and icon actions; transparent until hovered.' },
  ]
  if (hasDestructive) {
    variants.push({
      id: 'destructive',
      label: 'Destructive',
      recipe: 'button.destructive',
      note: 'Irreversible actions only. Never for emphasis.',
    })
  }

  const names: ComponentRecipeName[] = variants.map((variant) => variant.recipe as ComponentRecipeName)

  // Variants the engine derived no hover shade for. A reader given this file
  // alone has to be told, or they will invent one.
  const constantOnHover = names.filter((name) => {
    const recipe = ctx.recipe(name)
    return recipe !== undefined && !hoverSurfaceOf(recipe).distinct
  })

  return {
    id: 'button',
    title: 'Button',
    summary: hasDestructive
      ? `Four variants, each with its own measured geometry. Height is the border-box height, set explicitly so a button with an icon and a button with a label line up.`
      : `Three variants, each with its own measured geometry. This kit has no destructive colour, so it has no destructive button — adding one would mean bringing a red in from outside the system.`,
    variants,
    states: CONTROL_STATES,
    tokens: [
      ...names.flatMap((name) => recipeRows(ctx, name, name.replace('button.', ''))),
      ...referencedScaleRows(ctx, names),
      ...stateRows(ctx),
    ],
    colors: [...names.flatMap((name) => recipeColors(ctx, name, name.replace('button.', ''))), ...stateColors(ctx)],
    usage: [
      'Set the height explicitly. It is the border-box height and it already accounts for padding, line box and border.',
      `Pressed is \`primaryActive\` (${ctx.hex('primaryActive') ?? 'n/a'}) on a primary fill; every other variant keeps its hover fill while pressed.`,
      `Focus is a ${tokens.components.states.focusRing.width.value}px ring at ${tokens.components.states.focusRing.offset.value}px offset, on every variant, and it is never removed.`,
      `Disabled is ${ctx.hex('disabledForeground') ?? 'n/a'} on ${ctx.hex('disabledSurface') ?? 'n/a'} — two real colours measured at ${tokens.components.states.disabled.ratio}:1, held to a ${tokens.components.states.disabled.floor}:1 floor.`,
      'Only one primary button is on screen at a time. Two primaries means neither is one.',
      ...(constantOnHover.length === 0
        ? []
        : [
            `${constantOnHover.map((name) => `\`${name}\``).join(', ')} ${constantOnHover.length === 1 ? 'has' : 'have'} no derived hover fill in this kit. Keep the fill constant on hover and use the focus ring for feedback rather than inventing a darker shade.`,
          ]),
    ],
    doNot: [
      'Do not build the disabled state out of `opacity`. On a light kit a 50% label over a 50% fill measures 1:1 and disappears.',
      'Do not invent a size variant. This kit describes one height per variant; a "small" button is a value nothing in the sources supports.',
      hasDestructive
        ? 'Do not use the destructive variant for emphasis. It marks irreversible actions and nothing else.'
        : 'Do not add a destructive button by reaching for an arbitrary red. Capture one, or override `color.roles.destructive` in the panel so the kit owns the decision.',
      'Do not restyle a button inline. Change the token and every button turns with it.',
    ],
  }
}

function fieldDoc(ctx: Context, id: 'input' | 'select', title: string, recipe: ComponentRecipeName): ComponentDoc {
  const { tokens } = ctx
  return {
    id,
    title,
    summary:
      id === 'input'
        ? 'A text field: label above, control, help text or an error message below. The label and the help text are type steps, not invented sizes.'
        : 'A select is an input with a chevron. It shares the field geometry so a form row lines up whichever control it holds.',
    variants: [
      { id: 'default', label: 'Default', recipe, note: 'Resting state, with a label and help text.' },
      { id: 'error', label: 'Error', recipe, note: 'Invalid value: the message replaces the help text.' },
      { id: 'disabled', label: 'Disabled', recipe, note: 'Not editable. Real colours, never opacity.' },
    ],
    states: ['default', 'hover', 'focus', 'disabled', 'error'],
    tokens: [...recipeRows(ctx, recipe), ...referencedScaleRows(ctx, [recipe]), ...stateRows(ctx)],
    colors: [
      ...recipeColors(ctx, recipe),
      ...stateColors(ctx),
      ctx.color('help text', 'textMuted'),
      ...(tokens.color.roles.destructive === undefined ? [] : [ctx.color('error text', 'destructive')]),
    ],
    usage: [
      'The label sits above the control and is `text`, not `textMuted` — a label is not a hint.',
      `Help text is \`textMuted\` (${ctx.hex('textMuted') ?? 'n/a'}) at the smallest type step this kit has.`,
      tokens.color.roles.destructive === undefined
        ? 'This kit has no destructive colour, so an error message is set in `text` and carried by the message itself. Do not introduce a red for it.'
        : `An error message is set in \`destructive\` (${ctx.hex('destructive')}), which is contrast-checked as a text colour against both \`background\` and \`surface\`.`,
      'On focus the border goes to `primary` and the ring is drawn outside it. Both, not one.',
    ],
    doNot: [
      'Do not put the label inside the control as a placeholder. A placeholder disappears the moment someone types.',
      'Do not change the control height between a field with an error and one without. The message goes below; the box does not move.',
      'Do not use a border colour other than `border`, `primary` on focus, or the error colour above.',
    ],
  }
}

function cardDoc(ctx: Context): ComponentDoc {
  const { tokens } = ctx
  const rows: DocTokenRow[] = []
  const push = (label: string, path: string, resolved?: string): void => {
    const slot = ctx.slot(path)
    if (slot === undefined) return
    const row: DocTokenRow = {
      label,
      path,
      value: slot.value,
      origin: slot.origin,
      provenance: slot.provenance,
    }
    if (resolved !== undefined) row.resolved = resolved
    rows.push(row)
  }
  const largestRadius = (['lg', 'md', 'sm', 'none'] as const).find(
    (step) => tokens.radius.steps[step] !== undefined,
  )
  const padStep = [...tokens.spacing.steps]
    .filter((step) => step.value.band === 'component')
    .sort((a, b) => b.value.px - a.value.px)[0]

  if (largestRadius !== undefined) push('radius', `radius.steps.${largestRadius}`)
  if (padStep !== undefined) push('padding', `spacing.steps.${padStep.value.name}`)
  push('border width', 'border.width')
  if (tokens.shadow.steps.sm !== undefined) push('shadow', 'shadow.steps.sm')

  return {
    id: 'card',
    title: 'Card',
    summary:
      'A card is a surface, a border and a radius. The engine emits no card recipe, because no capture measures "a card" — so this one is composed from the scales, and the table below says which steps it uses rather than pretending they were measured.',
    variants: [
      { id: 'default', label: 'Card', note: 'A titled panel with body copy.' },
      { id: 'actions', label: 'With actions', note: 'Buttons in a row at the foot of the card.' },
    ],
    states: ['default'],
    tokens: rows,
    colors: [
      ctx.color('fill', 'surface'),
      ctx.color('text', 'text'),
      ctx.color('body copy', 'textMuted'),
      ctx.color('border', 'border'),
    ],
    usage: [
      `A card is \`surface\` (${ctx.hex('surface') ?? 'n/a'}) on \`background\` (${ctx.hex('background') ?? 'n/a'}), separated by a ${tokens.border.width.value}px \`border\`.`,
      'Nest smaller radii inside the card, never larger ones. The card is the outer box.',
      'Pad a card with a component step and separate cards with a layout step. Using one number for both is what makes a page read flat.',
    ],
    doNot: [
      'Do not use a shadow in place of the border for separation.',
      'Do not give a card its own background colour. There is one surface colour in this system.',
      'Do not nest a card inside a card. Use a rule and a heading.',
    ],
  }
}

function badgeDoc(ctx: Context): ComponentDoc {
  return {
    id: 'badge',
    title: 'Badge',
    summary:
      'Status pills inside tables and cards. This kit has no status palette — there is no success, warning or info colour — so a badge carries its meaning in its text and its neutrality, and only a genuinely destructive status reaches for the destructive colour.',
    variants: [
      { id: 'default', label: 'Default', recipe: 'badge', note: 'Every ordinary status.' },
      ...(ctx.tokens.color.roles.destructive === undefined
        ? []
        : [
            {
              id: 'destructive',
              label: 'Destructive',
              recipe: 'badge' as ComponentRecipeName,
              note: 'Failed, rejected, expired. Nothing else.',
            },
          ]),
    ],
    states: ['default'],
    tokens: [...recipeRows(ctx, 'badge'), ...referencedScaleRows(ctx, ['badge'])],
    colors: recipeColors(ctx, 'badge'),
    usage: [
      'A badge is a label, not a control. It is never clickable and never focusable.',
      'Keep the text one or two words. A badge that wraps is a sentence in the wrong shape.',
    ],
    doNot: [
      'Do not invent a colour per status. This kit has no status palette; distinguish statuses by their words.',
      'Do not use the destructive colour for a neutral status such as "pending".',
    ],
  }
}

function tableDoc(ctx: Context): ComponentDoc {
  const { tokens } = ctx
  return {
    id: 'table',
    title: 'Table',
    summary:
      'A header row of column names, data rows separated by a rule, and a hover fill that makes the row under the pointer obvious without moving anything.',
    variants: [
      { id: 'header', label: 'Header', recipe: 'table.header', note: 'Column headings. One rule underneath, never a filled band.' },
      { id: 'row', label: 'Row', recipe: 'table.row', note: 'Data rows, highlighted on hover.' },
    ],
    states: ['default', 'hover', 'selected'],
    tokens: [
      ...recipeRows(ctx, 'table.header', 'header'),
      ...recipeRows(ctx, 'table.row', 'row'),
      ...referencedScaleRows(ctx, ['table.header', 'table.row']),
    ],
    colors: [
      ...recipeColors(ctx, 'table.header', 'header'),
      ...recipeColors(ctx, 'table.row', 'row'),
      ctx.color('selected fill', 'selectedSurface'),
    ],
    usage: [
      `Hover fills a row with \`surfaceHover\` (${ctx.hex('surfaceHover') ?? 'n/a'}); selection fills it with \`selectedSurface\` (${ctx.hex('selectedSurface') ?? 'n/a'}). Selection reads by hue, hover by lightness — do not swap them.`,
      `Both \`text\` and \`textMuted\` are contrast-checked against the hover and selected fills, so a muted cell stays legible in a hovered row.`,
      `Separate rows with a ${tokens.border.width.value}px \`border\` rule, not with alternating fills.`,
    ],
    doNot: [
      'Do not fill the header band. One rule underneath is the whole treatment.',
      'Do not zebra-stripe rows. This system separates with rules.',
      'Do not shrink the row type below the step named above to fit more rows.',
    ],
  }
}

function typographyDoc(ctx: Context): ComponentDoc {
  const { tokens } = ctx
  const rows: DocTokenRow[] = []
  for (const step of tokens.typography.steps) {
    for (const field of ['fontSize', 'lineHeight', 'fontWeight'] as const) {
      const path = `typography.steps.${step.value.name}.${field}`
      const slot = ctx.slot(path)
      if (slot === undefined) continue
      rows.push({
        label: `${step.value.name} ${field === 'fontSize' ? 'size' : field === 'lineHeight' ? 'line height' : 'weight'}`,
        path,
        value: slot.value,
        origin: slot.origin,
        provenance: slot.provenance,
      })
    }
  }
  const sans = ctx.slot('typography.families.sans')
  if (sans !== undefined) {
    rows.unshift({
      label: 'sans stack',
      path: 'typography.families.sans',
      value: sans.value,
      origin: sans.origin,
      provenance: sans.provenance,
    })
  }
  const mono = ctx.slot('typography.families.mono')
  if (mono !== undefined) {
    rows.push({
      label: 'mono stack',
      path: 'typography.families.mono',
      value: mono.value,
      origin: mono.origin,
      provenance: mono.provenance,
    })
  }

  return {
    id: 'typography',
    title: 'Typography',
    summary: `${tokens.typography.steps.length} sizes, each carrying its own line height and weight. Adjacent steps differ by roughly ${tokens.typography.scaleRatio}x; body copy is the \`base\` step at ${tokens.typography.baseSize}px.`,
    variants: tokens.typography.steps.map((step) => ({
      id: step.value.name,
      label: step.value.name,
      note: `${step.value.fontSize}px / ${step.value.lineHeight} / ${step.value.fontWeight}`,
    })),
    states: [],
    tokens: rows,
    colors: [ctx.color('text', 'text'), ctx.color('muted text', 'textMuted')],
    usage: [
      `Use only these ${tokens.typography.steps.length} sizes. Do not interpolate between them.`,
      'Every size carries the line height listed with it. Do not pair a size with a different line height.',
      `Weights in this system: ${tokens.typography.weights.map((weight) => `${weight.value.value} (${weight.value.name})`).join(', ')}.`,
    ],
    doNot: [
      'Do not add a size to fill a gap in the ladder. Pick the nearer step.',
      'Do not use `text-white` or `text-black`. There are exactly two text colours in this system.',
      'Do not use opacity to make text quieter. `textMuted` is the quiet text colour and it is contrast-checked.',
    ],
  }
}

/**
 * Colour roles a doc actually references, sorted, for the embedded token
 * subset in a per-component markdown file.
 */
export function docRoles(doc: ComponentDoc): ColorRoleName[] {
  const roles = new Set<ColorRoleName>()
  for (const row of doc.colors) if (row.role !== null) roles.add(row.role)
  return [...roles].sort(byString)
}
